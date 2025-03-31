import { createNotifyServer } from './mcp/notify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { withTimeout, TimeoutError } from './lib/promise-extras'
import debug from 'debug'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Ollama, Message, Tool } from 'ollama'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { LargeLanguageProvider } from './llm'
import { from, map, Observable } from 'rxjs'
import { HomeAssistantApi } from './lib/ha-ws-api'

const d = debug('ha:llm')

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
    toolServers: McpServer[]
  ): Observable<MessageParam> {
    return from(this._executePromptWithTools(prompt, toolServers)).pipe(
      map((m) => convertOllamaMessageToAnthropic(m))
    )
  }

  async *_executePromptWithTools(prompt: string, toolServers: McpServer[]) {
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

    const msgs: Message[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]
    yield msgs[msgs.length - 1]

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
          d('Error in Ollama API call: %o', err)
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

export function createBuiltinServers(
  api: HomeAssistantApi,
  llm: LargeLanguageProvider,
  opts?: { testMode?: boolean }
) {
  const { testMode } = opts ?? {}

  return [
    createNotifyServer(api),
    createHomeAssistantServer(api, llm, { testMode: testMode ?? false }),
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
