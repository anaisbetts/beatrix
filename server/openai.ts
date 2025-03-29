import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import { TimeoutError, asyncMap, withTimeout } from './lib/promise-extras'
import debug from 'debug'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { connectServersToClient, LargeLanguageProvider } from './llm'
import { from, Observable } from 'rxjs'
import OpenAI from 'openai'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

const d = debug('ha:llm')

// Reserve tokens for model responses
const RESPONSE_TOKEN_RESERVE = 4000
const MAX_ITERATIONS = 10 // Safety limit for iterations

// Timeout configuration (in milliseconds)
const TOOL_EXECUTION_TIMEOUT = 60 * 1000

export const OPENAI_EVAL_MODEL = 'gpt-4-turbo'

export class OpenAILargeLanguageProvider implements LargeLanguageProvider {
  static OPENAI_API_TIMEOUT = 100 * 1000

  // Model token limits and defaults
  static MODEL_TOKEN_LIMITS: Record<string, number> = {
    'gpt-4-turbo': 128000,
    'gpt-4o': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16385,
    default: 16000,
  }

  private maxTokens: number
  private model: string
  private client: OpenAI

  public constructor(
    apiKey?: string,
    baseURL?: string,
    model?: string,
    maxTokens?: number
  ) {
    this.model = model ?? 'gpt-4-turbo'
    this.maxTokens =
      maxTokens ??
      OpenAILargeLanguageProvider.MODEL_TOKEN_LIMITS[this.model] ??
      OpenAILargeLanguageProvider.MODEL_TOKEN_LIMITS.default

    this.client = new OpenAI({
      apiKey: apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: baseURL ?? process.env.OPENAI_BASE_URL,
    })
  }

  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[]
  ): Observable<MessageParam> {
    return from(this._executePromptWithTools(prompt, toolServers))
  }

  async *_executePromptWithTools(prompt: string, toolServers: McpServer[]) {
    const client = new Client({
      name: pkg.name,
      version: pkg.version,
    })

    connectServersToClient(
      client,
      toolServers.map((x) => x.server)
    )

    let openaiTools: Array<OpenAI.ChatCompletionTool> = []
    if (toolServers.length > 0) {
      const toolList = await client.listTools()

      openaiTools = toolList.tools.map((tool) => {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema as any,
          },
        }
      })
    }

    const msgs: Array<OpenAI.ChatCompletionMessageParam> = [
      {
        role: 'user',
        content: prompt,
      },
    ]

    // Convert OpenAI message to Anthropic format to match interface
    const userMessage: MessageParam = {
      role: 'user',
      content: prompt,
    }
    yield userMessage

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

      // Apply timeout to the OpenAI API call
      let response
      try {
        response = await withTimeout(
          this.client.chat.completions.create({
            model: this.model,
            messages: msgs,
            tools: openaiTools.length > 0 ? openaiTools : undefined,
            tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
            max_tokens: Math.floor(responseTokens),
            temperature: 0.7,
            top_p: 0.9,
          }),
          OpenAILargeLanguageProvider.OPENAI_API_TIMEOUT,
          `OpenAI API call timed out after ${OpenAILargeLanguageProvider.OPENAI_API_TIMEOUT}ms`
        )
      } catch (err) {
        if (err instanceof TimeoutError) {
          d('OpenAI API call timed out: %s', err.message)
          // Add a message about the timeout and continue to next iteration
          const timeoutMessage: MessageParam = {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `I apologize, but the AI service took too long to respond. Let's continue with what we have so far.`,
              },
            ],
          }
          yield timeoutMessage
          continue
        } else {
          // For other errors, log and rethrow
          d('Error in OpenAI API call: %o', err)
          throw err
        }
      }

      // Track token usage from response
      if (response.usage) {
        usedTokens +=
          response.usage.prompt_tokens + response.usage.completion_tokens
        d(
          'Token usage for this request: %d prompt, %d completion, %d total',
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          response.usage.prompt_tokens + response.usage.completion_tokens
        )
      }

      const assistantMessage = response.choices[0].message
      msgs.push(assistantMessage)

      // Convert to Anthropic format for the interface
      const anthropicMessage = convertOpenAIMessageToAnthropic(assistantMessage)
      yield anthropicMessage

      // Check if there are no tool calls, then we're done
      if (
        !assistantMessage.tool_calls ||
        assistantMessage.tool_calls.length === 0
      ) {
        break
      }

      const toolCalls = assistantMessage.tool_calls
      d('Processing %d tool calls in parallel', toolCalls.length)

      // Estimate token usage for tool calls - this is approximate
      const estimatedToolCallTokens = toolCalls.reduce((sum, call) => {
        // Rough estimate: 10 tokens per tool name + overhead + input size
        const inputSize = JSON.stringify(call.function.arguments).length / 4 // ~4 chars per token
        return sum + 20 + inputSize
      }, 0)
      usedTokens += estimatedToolCallTokens

      // Execute tool calls in parallel with timeouts
      const toolResultsMap = await asyncMap(
        toolCalls,
        async (toolCall) => {
          d('Calling tool: %s', toolCall.function.name)
          try {
            // Apply timeout to each tool call
            const toolResp = await withTimeout(
              client.callTool({
                name: toolCall.function.name,
                arguments:
                  typeof toolCall.function.arguments === 'string'
                    ? (JSON.parse(toolCall.function.arguments) as Record<
                        string,
                        any
                      >)
                    : (toolCall.function.arguments as Record<string, any>),
              }),
              TOOL_EXECUTION_TIMEOUT,
              `Tool execution '${toolCall.function.name}' timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            )

            const resultContent = toolResp.content as string
            return {
              toolCall,
              result: resultContent ?? '',
              // Return token estimation for accounting
              tokenEstimate: resultContent ? resultContent.length / 4 + 10 : 10,
            }
          } catch (err) {
            // Handle both timeout errors and other execution errors
            let errorMsg = ''
            if (err instanceof TimeoutError) {
              d('Tool execution timed out: %s', toolCall.function.name)
              errorMsg = `Tool '${toolCall.function.name}' execution timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            } else {
              d('Error executing tool %s: %o', toolCall.function.name, err)
              errorMsg = `Error executing tool ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`
            }

            return {
              toolCall,
              result: errorMsg,
              tokenEstimate: errorMsg.length / 4 + 10,
            }
          }
        },
        10 // Allow up to 10 concurrent tool executions
      )

      // Add tool results to messages
      let totalToolTokens = 0

      // For OpenAI, we need to add each tool result as a separate message
      toolResultsMap.forEach((result) => {
        msgs.push({
          role: 'tool',
          tool_call_id: result.toolCall.id,
          content: result.result,
        })

        totalToolTokens += result.tokenEstimate
      })

      usedTokens += totalToolTokens
      d(
        'Completed %d parallel tool calls, estimated %d tokens',
        toolCalls.length,
        totalToolTokens
      )

      // Create an Anthropic-compatible message from the tool results
      const toolResults = Array.from(toolResultsMap).map(([, result]) => ({
        type: 'tool_result' as const,
        tool_use_id: result.toolCall.id,
        content: result.result,
      }))

      const toolResultsMessage: MessageParam = {
        role: 'user',
        content: toolResults,
      }
      yield toolResultsMessage

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

// Helper function to convert OpenAI message format to Anthropic format
function convertOpenAIMessageToAnthropic(
  message: OpenAI.ChatCompletionMessage
): MessageParam {
  if (message.tool_calls && message.tool_calls.length > 0) {
    // Message with tool calls
    const content: any[] = []

    // Add text content if present
    if (message.content) {
      content.push({
        type: 'text',
        text: message.content,
      })
    }

    // Add tool use blocks
    message.tool_calls.forEach((toolCall) => {
      if (toolCall.type === 'function') {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: toolCall.function.arguments,
        })
      }
    })

    return {
      role: 'assistant',
      content,
    }
  } else {
    // Regular message without tool calls
    return {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: message.content || '',
        },
      ],
    }
  }
}
