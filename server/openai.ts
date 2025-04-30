import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import OpenAI from 'openai'
import { Observable, from } from 'rxjs'

import pkg from '../package.json'
import { TimeoutError, asyncMap, withTimeout } from './lib/promise-extras'
import { LargeLanguageProvider, connectServerToClient } from './llm'
import { e } from './logging'

const d = debug('b:llm')

interface ToolResultWithEstimate {
  tool_call_id: string
  role: 'tool'
  content: string
  tokenEstimate: number
}

// Reserve tokens for model responses
const RESPONSE_TOKEN_RESERVE = 4000
const MAX_ITERATIONS = 10 // Safety limit for iterations

// Timeout configuration (in milliseconds)
const TOOL_EXECUTION_TIMEOUT = 3 * 60 * 1000

export const OPENAI_EVAL_MODEL = 'gpt-4-turbo'

/**
 * Utility function to convert image buffers to content blocks for different LLM providers
 * @param imageBuffers Array of image buffers to convert
 * @param textPrompt Optional text prompt to include
 * @param format Target format ('openai' or 'anthropic')
 * @returns Array of content blocks in the appropriate format
 */
export function convertImageBuffersToContentBlocks(
  imageBuffers: ArrayBufferLike[],
  textPrompt?: string,
  format: 'openai' | 'anthropic' = 'anthropic'
): Array<any> {
  const contentBlocks: Array<any> = []

  // Add text content if provided
  if (textPrompt) {
    contentBlocks.push({
      type: 'text',
      text: textPrompt,
    })
  }

  // Convert images based on the target format
  if (format === 'openai') {
    for (const imageBuffer of imageBuffers) {
      contentBlocks.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString('base64')}`,
        },
      })
    }
  } else {
    // Anthropic format
    for (const imageBuffer of imageBuffers) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg', // Assuming JPEG format
          data: Buffer.from(imageBuffer).toString('base64'),
        },
      })
    }
  }

  return contentBlocks
}

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

  public constructor(opts: {
    apiKey: string
    model: string
    baseURL?: string
    maxTokens?: number
  }) {
    const { apiKey, baseURL, model, maxTokens } = opts
    this.model = model ?? 'gpt-4-turbo'
    this.maxTokens =
      maxTokens ??
      OpenAILargeLanguageProvider.MODEL_TOKEN_LIMITS[this.model] ??
      OpenAILargeLanguageProvider.MODEL_TOKEN_LIMITS.default

    d('Using OpenAI with %s', baseURL)
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL ?? 'https://api.openai.com/v1',
    })
  }

  async getModelList(): Promise<string[]> {
    const models = await this.client.models.list()
    return models.data.map((model) => model.id)
  }

  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[],
    images?: ArrayBufferLike[]
  ): Observable<MessageParam> {
    return from(
      this._executePromptWithTools(
        prompt,
        toolServers,
        previousMessages,
        images
      )
    )
  }

  async *_executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[],
    images?: ArrayBufferLike[]
  ) {
    // Create a client for each tool server and connect them
    const clientServerPairs = toolServers.map((mcpServer, index) => {
      const client = new Client({
        name: `${pkg.name}-openai-client-${index}`, // Unique client name
        version: pkg.version,
      })
      connectServerToClient(client, mcpServer.server)
      return { server: mcpServer, client, index }
    })

    // Aggregate tools from all clients and map tool names to clients
    const openaiTools: Array<OpenAI.ChatCompletionTool> = []
    const toolClientMap = new Map<string, Client>()

    if (clientServerPairs.length > 0) {
      const toolLists = await Promise.all(
        clientServerPairs.map(async ({ client }) => {
          try {
            return await client.listTools()
          } catch (err) {
            e('Error listing tools for an OpenAI client:', err)
            return { tools: [] } // Return empty list on error
          }
        })
      )

      clientServerPairs.forEach(({ client }, index) => {
        const tools = toolLists[index].tools
        tools.forEach((tool) => {
          const openAITool: OpenAI.ChatCompletionTool = {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description || '',
              parameters: tool.inputSchema as any,
            },
          }
          openaiTools.push(openAITool)
          toolClientMap.set(tool.name, client)
        })
      })
      d(
        'Aggregated %d OpenAI tools from %d clients',
        openaiTools.length,
        clientServerPairs.length
      )
    }

    // Convert previous Anthropic messages to OpenAI format
    const msgs: Array<OpenAI.ChatCompletionMessageParam> = []

    if (previousMessages) {
      for (const msg of previousMessages) {
        msgs.push(convertAnthropicMessageToOpenAI(msg))
      }
    }

    // Add the current prompt as a user message if it's not empty
    if (prompt.trim()) {
      let content: any = prompt

      // Add images if provided
      if (images && images.length > 0) {
        content = convertImageBuffersToContentBlocks(images, prompt, 'openai')
        d('Added %d images to the prompt', images.length)
      }

      msgs.push({
        role: 'user',
        content,
      })

      // Convert to Anthropic format for the interface
      const userMessage: MessageParam = {
        role: 'user',
        content: prompt,
      }

      // Add images to the Anthropic format message if present
      if (images && images.length > 0) {
        userMessage.content = convertImageBuffersToContentBlocks(
          images,
          prompt,
          'anthropic'
        )
      }

      yield userMessage
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

      // Apply timeout to the OpenAI API call
      let response
      try {
        d('Calling OpenAI model %s', this.model)
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
          e('Error in OpenAI API call:', err)
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

      // Estimate token usage for tool calls - approximate
      const estimatedToolCallTokens = toolCalls.reduce((sum, call) => {
        const inputSize = JSON.stringify(call.function.arguments).length / 4
        return sum + 20 + inputSize // Rough estimate per call
      }, 0)
      usedTokens += estimatedToolCallTokens

      // Execute tool calls in parallel with timeouts, using the correct client
      const toolResultsMap = await asyncMap(
        toolCalls,
        async (toolCall) => {
          // Find the specific client for this tool
          const client = toolClientMap.get(toolCall.function.name)
          if (!client) {
            e(
              `Error: Could not find client for OpenAI tool '${toolCall.function.name}'`
            )
            const errorMsg = `System error: Tool '${toolCall.function.name}' not found.`
            return {
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: errorMsg,
              tokenEstimate: errorMsg.length / 4 + 10, // Estimate tokens for the error message
            }
          }

          d('Calling OpenAI tool: %s', toolCall.function.name)
          try {
            // Apply timeout to each tool call using the correct client
            const toolResp = await withTimeout(
              client.callTool({
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments),
              }),
              TOOL_EXECUTION_TIMEOUT,
              `Tool execution '${toolCall.function.name}' timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            )

            const resultContent = JSON.stringify(toolResp.content)
            return {
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: resultContent ?? [],
              // Return token estimation for accounting
              tokenEstimate:
                (resultContent ? resultContent.length / 4 : 0) + 10,
            }
          } catch (err) {
            // Handle both timeout errors and other execution errors
            let errorMsg = ''
            if (err instanceof TimeoutError) {
              e(`Tool execution timed out: ${toolCall.function.name}`)
              errorMsg = `Tool '${toolCall.function.name}' execution timed out after ${TOOL_EXECUTION_TIMEOUT}ms`
            } else {
              e(`Error executing tool ${toolCall.function.name}:`, err)
              errorMsg = `Error executing tool '${toolCall.function.name}': ${err instanceof Error ? err.message : String(err)}`
            }

            return {
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: errorMsg,
              tokenEstimate: errorMsg.length / 4 + 10,
            }
          }
        },
        10 // Allow up to 10 concurrent tool executions
      )

      // Convert Map results to array and update token usage
      let totalToolTokens = 0
      toolResultsMap.forEach((result) => {
        msgs.push({
          tool_call_id: result.tool_call_id,
          role: result.role,
          content: result.content,
        })
        totalToolTokens += result.tokenEstimate
      })

      usedTokens += totalToolTokens
      d(
        'Completed %d parallel OpenAI tool calls, estimated %d tokens',
        toolCalls.length,
        totalToolTokens
      )

      // Yield the tool results message in Anthropic format
      const toolResultsMessage: MessageParam = {
        role: 'user', // Anthropic expects tool results in a user message
        content: Array.from(toolResultsMap.values()).map(
          (result: ToolResultWithEstimate) => ({
            type: 'tool_result',
            tool_use_id: result.tool_call_id,
            content: result.content, // Keep content as string for Anthropic
          })
        ),
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

export function convertOpenAIMessageToAnthropic(
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
  } else if (Array.isArray(message.content)) {
    // This could be a message with images
    const content: any[] = []

    // Process each content item
    for (const item of message.content) {
      if (typeof item === 'object' && item.type === 'text') {
        // Text content
        content.push({
          type: 'text',
          text: item.text,
        })
      } else if (typeof item === 'object' && item.type === 'image_url') {
        // Image content - convert from OpenAI format to Anthropic format
        // Extract base64 data from data URL if present
        if (item.image_url.url.startsWith('data:image/')) {
          const base64Data = item.image_url.url.split(',')[1]
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type:
                item.image_url.url.split(';')[0].split(':')[1] || 'image/jpeg',
              data: base64Data,
            },
          })
        }
      }
    }

    if (content.length > 0) {
      return {
        role: message.role,
        content,
      }
    }
  }

  // Regular message without tool calls or special content
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

export function convertAnthropicMessageToOpenAI(
  message: MessageParam
): OpenAI.ChatCompletionMessageParam {
  if (message.role === 'user' || message.role === 'assistant') {
    // For simple text messages
    if (typeof message.content === 'string') {
      return {
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      }
    }

    // For content blocks
    if (Array.isArray(message.content)) {
      // Check for images
      const imageBlocks = message.content.filter(
        (block) => block.type === 'image'
      )

      if (imageBlocks.length > 0) {
        // Message with images
        const contentItems: any[] = []

        // Add text blocks
        const textBlocks = message.content.filter(
          (block) => block.type === 'text'
        )
        textBlocks.forEach((block) => {
          contentItems.push({
            type: 'text',
            text: block.text,
          })
        })

        // Add image blocks - convert from Anthropic format to OpenAI format
        imageBlocks.forEach((block) => {
          if (block.type === 'image' && block.source.type === 'base64') {
            contentItems.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type || 'image/jpeg'};base64,${block.source.data}`,
              },
            })
          }
        })

        return {
          role: message.role === 'user' ? 'user' : 'assistant',
          content: contentItems,
        }
      }

      // Check for tool results
      const toolResults = message.content.filter(
        (block) => block.type === 'tool_result'
      )

      if (toolResults.length > 0) {
        return {
          role: 'tool' as const,
          tool_call_id: toolResults[0].tool_use_id,
          content:
            typeof toolResults[0].content === 'string'
              ? toolResults[0].content
              : JSON.stringify(toolResults[0].content),
        }
      }

      // Check for tool uses
      const toolUses = message.content.filter(
        (block) => block.type === 'tool_use'
      )
      if (toolUses.length > 0 && message.role === 'assistant') {
        const textBlocks = message.content.filter(
          (block) => block.type === 'text'
        )
        const textContent =
          textBlocks.length > 0
            ? textBlocks.map((block) => block.text).join('\n')
            : ''

        return {
          role: 'assistant',
          content: textContent,
          tool_calls: toolUses.map((block) => ({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments:
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input),
            },
          })),
        }
      }

      // For normal text content blocks
      const textBlocks = message.content.filter(
        (block) => block.type === 'text'
      )
      if (textBlocks.length > 0) {
        return {
          role: message.role === 'user' ? 'user' : 'assistant',
          content: textBlocks.map((block) => block.text).join('\n'),
        }
      }
    }
  }

  // Fallback for any other message type
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
  }
}
