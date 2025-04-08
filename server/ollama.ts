import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { Message, Ollama, Tool } from 'ollama'
import { Observable, from, map } from 'rxjs'

import pkg from '../package.json'
import { TimeoutError, withTimeout } from './lib/promise-extras'
import { LargeLanguageProvider } from './llm'
import { e } from './logging'

const d = debug('b:llm')

// Reserve tokens for model responses
const MAX_ITERATIONS = 10 // Safety limit for iterations

// Timeout configuration (in milliseconds)
const TOOL_EXECUTION_TIMEOUT = 60 * 1000

export class OllamaLargeLanguageProvider implements LargeLanguageProvider {
  // Timeout configuration (in milliseconds)
  static OLLAMA_API_TIMEOUT = 5 * 60 * 1000

  private ollama: Ollama
  private model: string
  constructor(endpoint: string, model?: string) {
    this.model = model ?? 'qwen2.5:14b'
    this.ollama = new Ollama({ host: endpoint })
  }

  async getModelList(): Promise<string[]> {
    const response = await this.ollama.list()
    return response.models.map((model) => model.name)
  }

  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[]
  ): Observable<MessageParam> {
    return from(
      this._executePromptWithTools(prompt, toolServers, previousMessages)
    ).pipe(map((m) => convertOllamaMessageToAnthropic(m)))
  }

  async *_executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[]
  ) {
    const modelName = this.model

    const client = new Client({
      name: pkg.name,
      version: pkg.version,
    })

    connectServersToClient(
      client,
      toolServers.map((x) => x.server)
    )

    let ollamaTools: Tool[] = []
    if (toolServers.length > 0) {
      const toolList = await client.listTools()

      // Format tools for Ollama's format
      ollamaTools = toolList.tools.map((tool) => {
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

    // Track conversation and tool use to avoid infinite loops
    let iterationCount = 0

    // Convert previous Anthropic messages to Ollama format
    const msgs: Message[] = []

    if (previousMessages) {
      for (const msg of previousMessages) {
        msgs.push(convertAnthropicMessageToOllama(msg))
      }
    }

    // Add the current prompt as a user message if it's not empty
    if (prompt.trim()) {
      msgs.push({
        role: 'user',
        content: prompt,
      })
      yield msgs[msgs.length - 1]
    }

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
            options: {
              temperature: 0.7,
              top_p: 0.9,
              top_k: 40,
              num_predict: 512,
            },
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

          yield msgs[msgs.length - 1]
          continue
        } else {
          // For other errors, log and rethrow
          e('Error in Ollama API call', err)
          throw err
        }
      }

      msgs.push(response.message)
      yield msgs[msgs.length - 1]

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

        yield msgs[msgs.length - 1]
      }
    }
  }
}

export function connectServersToClient(client: Client, servers: Server[]) {
  servers.forEach((server) => {
    const [cli, srv] = InMemoryTransport.createLinkedPair()
    void client.connect(cli)
    void server.connect(srv)
  })
}

function convertOllamaMessageToAnthropic(
  msg: Message
): Anthropic.Messages.MessageParam {
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
}

function convertAnthropicMessageToOllama(msg: MessageParam): Message {
  if (msg.role === 'user' || msg.role === 'assistant') {
    // For simple text messages
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      }
    }

    // For content blocks
    if (Array.isArray(msg.content)) {
      // Check for tool results
      const toolResults = msg.content.filter(
        (block) => block.type === 'tool_result'
      )
      if (toolResults.length > 0) {
        return {
          role: 'tool',
          content:
            typeof toolResults[0].content === 'string'
              ? toolResults[0].content
              : JSON.stringify(toolResults[0].content),
        }
      }

      // Check for tool uses
      const toolUses = msg.content.filter((block) => block.type === 'tool_use')
      if (toolUses.length > 0 && msg.role === 'assistant') {
        const textBlocks = msg.content.filter((block) => block.type === 'text')
        const textContent =
          textBlocks.length > 0
            ? textBlocks.map((block) => block.text).join('\n')
            : ''

        return {
          role: 'assistant',
          content: textContent,
          tool_calls: toolUses.map((block) => ({
            id: block.id || `tool_${Date.now()}`,
            type: 'function',
            function: {
              name: block.name,
              arguments:
                typeof block.input === 'string'
                  ? JSON.parse(block.input)
                  : block.input,
            },
          })),
        }
      }

      // For normal text content blocks
      const textBlocks = msg.content.filter((block) => block.type === 'text')
      if (textBlocks.length > 0) {
        return {
          role: msg.role,
          content: textBlocks.map((block) => block.text).join('\n'),
        }
      }
    }
  }

  // Fallback for any other message type
  return {
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content:
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content),
  }
}
