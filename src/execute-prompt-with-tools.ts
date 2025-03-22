import { Connection as HAConnection } from 'home-assistant-js-websocket'
import { createNotifyServer } from './servers/notify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { asyncMap, withTimeout, TimeoutError } from './promise-extras'
import debug from 'debug'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Ollama, Message, Tool } from 'ollama'
import { createHomeAssistantServer } from './servers/home-assistant'
import { LargeLanguageProvider } from './llm'

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

export class OllamaLargeLanguageProvider implements LargeLanguageProvider {
  // Timeout configuration (in milliseconds)
  static OLLAMA_API_TIMEOUT = 5 * 60 * 1000

  private ollama: Ollama
  private model: string
  constructor(endpoint: string, model?: string) {
    this.model = model ?? 'qwen2.5:14b'
    this.ollama = new Ollama({ host: endpoint })
  }

  async executePromptWithTools(
    prompt: string,
    toolServers: McpServer[]
  ): Promise<MessageParam[]> {
    const modelName = this.model

    const client = new Client({
      name: pkg.name,
      version: pkg.version,
    })

    connectServersToClient(
      client,
      toolServers.map((x) => x.server)
    )
    const toolList = await client.listTools()

    // Format tools for Ollama's format
    const ollamaTools: Tool[] = toolList.tools.map((tool) => {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema as any,
        },
      }
    })

    // Track conversation and tool use to avoid infinite loops
    let iterationCount = 0

    const msgs: Message[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]

    // We're gonna keep looping until there are no more tool calls to satisfy
    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++

      // Apply timeout to the Anthropic API call
      let response
      try {
        response = await withTimeout(
          this.ollama.chat({
            model: modelName,
            messages: msgs,
            tools: ollamaTools,
            stream: false,
          }),
          OllamaLargeLanguageProvider.OLLAMA_API_TIMEOUT,
          `Ollama API call timed out after ${OllamaLargeLanguageProvider.OLLAMA_API_TIMEOUT}ms`
        )
      } catch (err) {
        if (err instanceof TimeoutError) {
          d('Ollama API call timed out: %s', err.message)
          // Add a system message about the timeout and continue to next iteration
          msgs.push({
            role: 'assistant',
            content: `I apologize, but the AI service took too long to respond. Let's continue with what we have so far.`,
          })

          continue
        } else {
          // For other errors, log and rethrow
          d('Error in Ollama API call: %o', err)
          throw err
        }
      }

      msgs.push(response.message)

      if (
        !response.message.tool_calls ||
        response.message.tool_calls.length < 1
      ) {
        break
      }

      const toolCalls = response.message.tool_calls

      d('Processing %d tool calls', toolCalls.length)
      for (const toolCall of toolCalls) {
        // Apply timeout to each tool call
        const toolResp = await withTimeout(
          client.callTool({
            name: toolCall.function.name,
            arguments: toolCall.function.arguments as Record<string, any>,
          }),
          TOOL_EXECUTION_TIMEOUT,
          `Tool execution '${toolCall.function.name}' timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
        )

        msgs.push({
          role: 'tool',
          content: JSON.stringify(toolResp.content),
        })
      }
    }

    return convertOllamaMessageToAnthropic(msgs)
  }
}

export function createBuiltinServers(
  connection: HAConnection,
  llm: LargeLanguageProvider,
  opts?: { testMode?: boolean }
) {
  const { testMode } = opts ?? {}

  return [
    createNotifyServer(connection, { testMode: testMode ?? false }),
    createHomeAssistantServer(connection, llm, { testMode: testMode ?? false }),
  ]
}

export function connectServersToClient(client: Client, servers: Server[]) {
  servers.forEach((server) => {
    const [cli, srv] = InMemoryTransport.createLinkedPair()
    void client.connect(cli)
    void server.connect(srv)
  })
}

function convertOllamaMessageToAnthropic(
  msgs: Message[]
): Anthropic.Messages.MessageParam[] {
  return msgs.map((msg) => {
    if (msg.role === 'tool') {
      // Tool messages in Ollama -> tool_result content blocks in Anthropic
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'unknown', // Ollama doesn't track tool_use_id in responses
            content: msg.content,
          },
        ],
      }
    } else if (
      msg.role === 'assistant' &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      // Convert assistant messages with tool calls to Anthropic format
      const contentBlocks: ContentBlockParam[] = []

      // Add any regular text content
      if (msg.content) {
        contentBlocks.push({
          type: 'text',
          text: msg.content,
        })
      }

      // Add tool_use blocks for each tool call
      msg.tool_calls.forEach((toolCall) => {
        contentBlocks.push({
          type: 'tool_use',
          id: `tool_${Date.now()}`, // Generate an ID if none exists
          name: toolCall.function.name,
          input: toolCall.function.arguments,
        })
      })

      return {
        role: 'assistant',
        content: contentBlocks,
      }
    } else {
      // User messages and regular assistant messages
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content
          ? [
              {
                type: 'text',
                text: msg.content,
              },
            ]
          : [],
      }
    }
  })
}
