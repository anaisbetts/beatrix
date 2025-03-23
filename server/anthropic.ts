import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { asyncMap, withTimeout, TimeoutError } from './lib/promise-extras'
import debug from 'debug'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { connectServersToClient, LargeLanguageProvider } from './llm'

const d = debug('ha:llm')

// Reserve tokens for model responses
const RESPONSE_TOKEN_RESERVE = 4000
const MAX_ITERATIONS = 10 // Safety limit for iterations

// Timeout configuration (in milliseconds)
const TOOL_EXECUTION_TIMEOUT = 60 * 1000

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
    model?: string,
    maxTokens?: number
  ) {
    this.model = model ?? 'claude-3-7-sonnet-20250219'
    this.maxTokens =
      maxTokens ??
      AnthropicLargeLanguageProvider.MODEL_TOKEN_LIMITS[this.model] ??
      AnthropicLargeLanguageProvider.MODEL_TOKEN_LIMITS.default
  }

  async executePromptWithTools(
    prompt: string,
    toolServers: McpServer[]
  ): Promise<MessageParam[]> {
    const anthropic = new Anthropic({ apiKey: this.apiKey })

    const client = new Client({
      name: pkg.name,
      version: pkg.version,
    })

    connectServersToClient(
      client,
      toolServers.map((x) => x.server)
    )
    const toolList = await client.listTools()

    const anthropicTools = toolList.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.inputSchema,
      }
    })

    const msgs: MessageParam[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]

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
            tool_choice: { type: 'auto' },
          }),
          AnthropicLargeLanguageProvider.ANTHROPIC_API_TIMEOUT,
          `Anthropic API call timed out after ${AnthropicLargeLanguageProvider.ANTHROPIC_API_TIMEOUT}ms`
        )
      } catch (err) {
        if (err instanceof TimeoutError) {
          d('Anthropic API call timed out: %s', err.message)
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
          continue
        } else {
          // For other errors, log and rethrow
          d('Error in Anthropic API call: %o', err)
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
          try {
            // Apply timeout to each tool call
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
              d('Tool execution timed out: %s', toolCall.name)
              errorMsg = `Tool '${toolCall.name}' execution timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            } else {
              d('Error executing tool %s: %o', toolCall.name, err)
              errorMsg = `Error executing tool ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`
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
      'Conversation complete. Used %d/%d tokens (%.1f%%)',
      usedTokens,
      tokenBudget,
      (usedTokens / tokenBudget) * 100
    )
    return msgs
  }
}
