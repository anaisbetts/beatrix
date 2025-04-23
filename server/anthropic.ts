import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { Observable, from } from 'rxjs'

import pkg from '../package.json'
import { TimeoutError, asyncMap, withTimeout } from './lib/promise-extras'
import { LargeLanguageProvider, connectServerToClient } from './llm'
import { e } from './logging'

const d = debug('b:llm')

// Reserve tokens for model responses
const RESPONSE_TOKEN_RESERVE = 4000
const MAX_ITERATIONS = 10 // Safety limit for iterations

const TOOL_EXECUTION_TIMEOUT = 3 * 60 * 1000

export const ANTHROPIC_EVAL_MODEL = 'claude-3-7-sonnet-20250219'

export class AnthropicLargeLanguageProvider implements LargeLanguageProvider {
  static ANTHROPIC_API_TIMEOUT = 100 * 1000

  // Model token limits and defaults
  static MODEL_TOKEN_LIMITS: Record<string, number> = {
    'claude-3-5-sonnet-20240620': 200000,
    'claude-3-7-sonnet-20250219': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-haiku-20240307': 200000,
    'claude-3-sonnet-20240229': 200000,
    default: 150000,
  }

  private maxTokens: number
  private model: string
  public constructor(
    private apiKey: string,
    model: string,
    maxTokens?: number
  ) {
    this.model = model ?? 'claude-3-7-sonnet-20250219'
    this.maxTokens =
      maxTokens ??
      AnthropicLargeLanguageProvider.MODEL_TOKEN_LIMITS[this.model] ??
      AnthropicLargeLanguageProvider.MODEL_TOKEN_LIMITS.default
  }

  async getModelList(): Promise<string[]> {
    const anthropic = new Anthropic({ apiKey: this.apiKey })
    const response = await anthropic.models.list()
    return response.data.map((model) => model.id)
  }

  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[]
  ): Observable<MessageParam> {
    return from(
      this._executePromptWithTools(prompt, toolServers, previousMessages)
    )
  }

  async *_executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[]
  ) {
    const anthropic = new Anthropic({ apiKey: this.apiKey })

    // Create a client for each tool server and connect them
    const clientServerPairs = toolServers.map((mcpServer, index) => {
      const client = new Client({
        name: `${pkg.name}-client-${index}`, // Unique client name based on index
        version: pkg.version,
      })

      connectServerToClient(client, mcpServer.server)
      return { server: mcpServer, client, index } // Pass index along
    })

    // Aggregate tools from all clients and map tool names to clients
    const anthropicTools: Anthropic.Tool[] = []
    const toolClientMap = new Map<string, Client>()

    if (clientServerPairs.length > 0) {
      const toolLists = await Promise.all(
        clientServerPairs.map(async ({ client }) => {
          try {
            return await client.listTools()
          } catch (err) {
            e('Error listing tools for a client:', err)
            return { tools: [] } // Return empty list on error
          }
        })
      )

      clientServerPairs.forEach(({ client }, index) => {
        const tools = toolLists[index].tools
        tools.forEach((tool) => {
          anthropicTools.push({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema,
          })
          toolClientMap.set(tool.name, client)
        })
      })
      d(
        'Aggregated %d tools from %d clients',
        anthropicTools.length,
        clientServerPairs.length
      )
    }

    const msgs: MessageParam[] = previousMessages ? [...previousMessages] : []

    // Add the current prompt as a user message if it's not empty
    if (prompt.trim()) {
      msgs.push({
        role: 'user',
        content: prompt,
      })
      yield msgs[msgs.length - 1]
    }

    // Calculate available token budget for the model
    let tokenBudget = this.maxTokens
    let usedTokens = 0

    // Track conversation and tool use to avoid infinite loops
    let iterationCount = 0

    // We're gonna keep looping until there are no more tool calls to satisfy
    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++

      // Calculate response token limit for this iteration
      const responseTokens = Math.min(
        RESPONSE_TOKEN_RESERVE,
        (tokenBudget - usedTokens) / 2
      )

      // Check if we have enough tokens left for a meaningful response
      if (responseTokens < 1000) {
        d(
          'Token budget too low for meaningful response. Used: %d/%d',
          usedTokens,
          tokenBudget
        )
        break
      }

      d(
        'Prompting iteration %d: %d tokens used, %d tokens remaining',
        iterationCount,
        usedTokens,
        tokenBudget - usedTokens
      )

      // Apply timeout to the Anthropic API call
      let response
      try {
        response = await withTimeout(
          anthropic.messages.create({
            model: this.model,
            max_tokens: responseTokens,
            messages: msgs,
            tools: anthropicTools,
            tool_choice: toolServers?.length > 0 ? { type: 'auto' } : undefined,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            system:
              'You are a helpful assistant that helps users with home automation tasks using Home Assistant.',
          }),
          AnthropicLargeLanguageProvider.ANTHROPIC_API_TIMEOUT,
          `Anthropic API call timed out after ${AnthropicLargeLanguageProvider.ANTHROPIC_API_TIMEOUT}ms`
        )
      } catch (err) {
        if (err instanceof TimeoutError) {
          e('Anthropic API call timed out:', err.message)
          // Add a system message about the timeout and continue to next iteration
          msgs.push({
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `I apologize, but the AI service took too long to respond. Let's continue with what we have so far.`,
              },
            ],
          })
          yield msgs[msgs.length - 1]

          continue
        } else {
          // For other errors, log and rethrow
          e('Error in Anthropic API call:', err)
          throw err
        }
      }

      // Track token usage from response
      if (response.usage) {
        usedTokens += response.usage.input_tokens + response.usage.output_tokens
        d(
          'Token usage for this request: %d input, %d output, %d total',
          response.usage.input_tokens,
          response.usage.output_tokens,
          response.usage.input_tokens + response.usage.output_tokens
        )
      }

      msgs.push({
        role: response.role,
        content: response.content,
      })
      yield msgs[msgs.length - 1]

      if (!response.content.find((msg) => msg.type === 'tool_use')) {
        break
      }

      const toolCalls = response.content.filter(
        (msg) => msg.type === 'tool_use'
      )
      d('Processing %d tool calls in parallel', toolCalls.length)

      // Estimate token usage for tool calls - this is approximate
      // We add a fixed overhead per tool call plus the estimated content size
      const estimatedToolCallTokens = toolCalls.reduce((sum, call) => {
        // Rough estimate: 10 tokens per tool name + overhead + input size
        const inputSize = JSON.stringify(call.input).length / 4 // ~4 chars per token
        return sum + 20 + inputSize
      }, 0)
      usedTokens += estimatedToolCallTokens

      // Execute tool calls in parallel with timeouts
      const toolResultsMap = await asyncMap(
        toolCalls,
        async (toolCall) => {
          d('Calling tool: %s', toolCall.name)

          const client = toolClientMap.get(toolCall.name)
          if (!client) {
            e(`Error: Could not find client for tool '${toolCall.name}'`)
            const errorMsg = `System error: Tool '${toolCall.name}' not found.`
            return {
              type: 'tool_result' as const,
              tool_use_id: toolCall.id,
              content: errorMsg,
              tokenEstimate: errorMsg.length / 4 + 10,
            }
          }

          try {
            // Apply timeout to each tool call using the correct client
            const toolResp = await withTimeout(
              client.callTool({
                name: toolCall.name,
                arguments: toolCall.input as Record<string, any>,
              }),
              TOOL_EXECUTION_TIMEOUT,
              `Tool execution '${toolCall.name}' timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            )

            const resultContent = toolResp.content as string
            return {
              type: 'tool_result' as const,
              tool_use_id: toolCall.id,
              content: resultContent ?? [],
              // Return token estimation for accounting
              tokenEstimate: resultContent ? resultContent.length / 4 + 10 : 10,
            }
          } catch (err) {
            // Handle both timeout errors and other execution errors
            let errorMsg = ''
            if (err instanceof TimeoutError) {
              e(`Tool execution timed out: ${toolCall.name}`)
              errorMsg = `Tool '${toolCall.name}' execution timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            } else {
              e(`Error executing tool ${toolCall.name}:`, err)
              errorMsg = `Error executing tool '${toolCall.name}': ${err instanceof Error ? err.message : String(err)}`
            }

            return {
              type: 'tool_result' as const,
              tool_use_id: toolCall.id,
              content: errorMsg,
              tokenEstimate: errorMsg.length / 4 + 10,
            }
          }
        },
        10 // Allow up to 10 concurrent tool executions
      )

      // Convert Map to array and update token usage
      const toolResults: ContentBlockParam[] = []
      let totalToolTokens = 0

      toolResultsMap.forEach((result) => {
        toolResults.push({
          type: result.type,
          tool_use_id: result.tool_use_id,
          content: result.content,
        })

        totalToolTokens += result.tokenEstimate
      })

      usedTokens += totalToolTokens
      d(
        'Completed %d parallel tool calls, estimated %d tokens',
        toolCalls.length,
        totalToolTokens
      )

      msgs.push({ role: 'user', content: toolResults })
      yield msgs[msgs.length - 1]

      // Check if we're approaching token limit
      if (usedTokens > tokenBudget * 0.9) {
        d(
          'Approaching token budget limit: %d/%d used (90%)',
          usedTokens,
          tokenBudget
        )
        break
      }
    }

    d(
      'Conversation complete. Used %d/%d tokens (%d)',
      usedTokens,
      tokenBudget,
      (usedTokens / tokenBudget) * 100
    )
  }
}
