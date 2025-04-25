import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import debug from 'debug'
import { Hono } from 'hono'
import { BlankEnv, BlankSchema } from 'hono/types'
import { LRUCache } from 'lru-cache'
import { Message } from 'ollama'

import { ServerWebsocketApiImpl } from './api'
import { convertOllamaMessageToAnthropic } from './ollama'

const d = debug('b:ollama-proxy')

let serverApi: ServerWebsocketApiImpl | undefined
export function setOllamaApiImpl(api: ServerWebsocketApiImpl) {
  d('Setting Ollama API implementation: %o', api ? api.constructor.name : api)
  serverApi = api
}

export function setupOllamaProxy(app: Hono<BlankEnv, BlankSchema, '/'>) {
  d('Setting up Ollama proxy routes')
  app.get('/ollama/api/tags', (c) => {
    d('GET /ollama/api/tags called')
    // NB: All of this data is faked but just in case some client
    // wants it, it's there
    return c.json({
      models: [
        {
          name: 'beatrix-runtime',
          model: 'beatrix-runtime',
          modified_at: new Date().toISOString(),
          size: 4920753328,
          digest: 'beatrix-' + Math.random().toString(16).substring(2, 10),
          details: {
            parent_model: '',
            format: 'gguf',
            family: 'beatrix',
            families: ['beatrix', 'assistant'],
            parameter_size: '8.0B',
            quantization_level: 'Q4_K_M',
          },
        },
      ],
    })
  })

  // NB: So this entire codebase is a bit Weird. Tools like Home Assistant can't
  // Deal with seeing tool calls and end up mangling them. To prevent that from
  // happening, we need to provide them a "censored" conversation, while we
  // still have the real one in the background with Beatrix
  const msgIdCache = new LRUCache<string, number>({
    max: 256,
  })

  app.post('/ollama/api/chat', async (c) => {
    d('POST /ollama/api/chat called')
    const body = await c.req.json()
    d('Request body: %o', body)
    const { messages, stream = false, model } = body

    if (!serverApi) {
      d('Error: serverApi not set')
      c.status(500)
      return c.text('Runtime not set up')
    }

    // Try to find the server ID via their first message
    const firstMsg = messages[0].content
    const previousMessageId = msgIdCache.get(firstMsg)
    d('First message: %s, previousMessageId: %o', firstMsg, previousMessageId)

    // Convert Ollama messages to Anthropic format
    const anthropicMessages: MessageParam[] = []
    let userPrompt = ''

    // Process all messages except the last one
    for (let i = 0; i < messages.length - 1; i++) {
      const converted = convertOllamaMessageToAnthropic(messages[i])
      d('Converted Ollama message to Anthropic: %o', converted)
      anthropicMessages.push(converted)
    }

    // The last message is the user's prompt
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'user') {
        userPrompt = lastMessage.content
        d('User prompt: %s', userPrompt)
      }
    }

    if (stream) {
      d('Handling streaming response')
      // Set up streaming response
      c.header('Content-Type', 'text/event-stream')
      c.header('Cache-Control', 'no-cache')
      c.header('Connection', 'keep-alive')

      // Use writableStream for node environments
      const stream = new TransformStream()
      const writer = stream.writable.getWriter()
      const encoder = new TextEncoder()

      // Start the response
      c.res = new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })

      const observable = serverApi.handlePromptRequest(
        userPrompt,
        undefined,
        undefined,
        previousMessageId,
        'chat'
      )

      let assistantMessage: Message | null = null

      observable.subscribe({
        next: (message) => {
          d('Observable next (stream): %o', message)
          msgIdCache.set(firstMsg, message.serverId)
          if (message.role === 'assistant') {
            // Convert Anthropic message to Ollama format
            const ollamaMessage =
              convertAnthropicMessageToOllamaCensored(message)
            d(
              'Converted Anthropic message to Ollama (censored): %o',
              ollamaMessage
            )
            assistantMessage = ollamaMessage
            const content = ollamaMessage.content

            if (content) {
              // Format for Ollama streaming response
              const response = {
                model,
                created_at: new Date().toISOString(),
                message: {
                  role: 'assistant',
                  content,
                },
                done: false,
              }
              d('Writing streaming response chunk: %o', response)
              void writer.write(encoder.encode(JSON.stringify(response) + '\n'))
            }
          }
        },
        error: (err) => {
          d('Observable error (stream): %o', err)
          console.error('Error in stream:', err)
          // Send error event and close the writer
          const errorResponse = {
            error: {
              message: err.message || 'Unknown error',
              type: 'server_error',
            },
            done: true,
          }

          // We need to handle this synchronously in the callback
          void writer.write(
            encoder.encode(JSON.stringify(errorResponse) + '\n')
          )
          // We need to close in a separate step
          void writer.close().catch((closeErr) => {
            console.error('Error closing stream after error:', closeErr)
          })
        },
        complete: () => {
          d('Observable complete (stream)')
          // Send completion event and close
          const finalResponse = {
            model,
            created_at: new Date().toISOString(),
            done: true,
            // Include an empty message in the final response to satisfy the validation
            message: assistantMessage || { role: 'assistant', content: '' },
          }

          // Handle each operation separately
          void writer
            .write(encoder.encode(JSON.stringify(finalResponse) + '\n'))
            .then(() => writer.close())
            .catch((closeErr) => {
              console.error('Error in stream completion sequence:', closeErr)
            })
        },
      })

      return c.body(null)
    } else {
      d('Handling non-streaming response')
      // Non-streaming response
      return new Promise<Response>((resolve) => {
        let assistantMessage: Message | null = null

        const observable = serverApi!.handlePromptRequest(
          userPrompt,
          undefined,
          undefined,
          previousMessageId,
          'chat'
        )

        observable.subscribe({
          next: (message) => {
            d('Observable next (non-stream): %o', message)
            msgIdCache.set(firstMsg, message.serverId)

            if (message.role === 'assistant') {
              assistantMessage =
                convertAnthropicMessageToOllamaCensored(message)
              d(
                'Converted Anthropic message to Ollama (censored): %o',
                assistantMessage
              )
            }
          },
          error: (err) => {
            d('Observable error (non-stream): %o', err)
            console.error('Error in completion:', err)
            resolve(
              c.json(
                {
                  error: {
                    message: err.message || 'Unknown error',
                    type: 'server_error',
                  },
                },
                500
              )
            )
          },
          complete: () => {
            d('Observable complete (non-stream)')
            // Final Ollama response format
            if (assistantMessage) {
              resolve(
                c.json({
                  model,
                  created_at: new Date().toISOString(),
                  message: assistantMessage,
                  done: true,
                })
              )
            } else {
              resolve(
                c.json(
                  {
                    error: {
                      message: 'No response generated',
                      type: 'server_error',
                    },
                  },
                  500
                )
              )
            }
          },
        })
      })
    }
  })
}

export function convertAnthropicMessageToOllamaCensored(
  msg: MessageParam
): Message {
  d('Converting Anthropic message to Ollama (censored): %o', msg)
  // Handle standard messages
  let contentString = ''
  if (typeof msg.content === 'string') {
    contentString = msg.content
  } else if (Array.isArray(msg.content)) {
    // Only include text blocks, completely skipping tool blocks
    contentString = msg.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') {
          return block.text
        }
        return ''
      })
      .join('\n')
  }

  return {
    role: msg.role,
    content: contentString,
  }
}
