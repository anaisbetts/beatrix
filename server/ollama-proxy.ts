import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Hono } from 'hono'
import { BlankEnv, BlankSchema } from 'hono/types'
import { Message } from 'ollama'

import {
  convertAnthropicMessageToOllama,
  convertOllamaMessageToAnthropic,
} from './ollama'
import { AutomationRuntime } from './workflow/automation-runtime'

let runtime: AutomationRuntime | undefined
export function setOllamaAutomationRuntime(currentRuntime: AutomationRuntime) {
  runtime = currentRuntime
}

export function setupOllamaProxy(app: Hono<BlankEnv, BlankSchema, '/'>) {
  app.get('/ollama/api/tags', (c) => {
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

  app.post('/ollama/api/chat', async (c) => {
    const body = await c.req.json()
    const { messages, stream = false, model } = body

    if (!runtime) {
      c.status(500)
      return c.text('Runtime not set up')
    }

    // Create LLM provider using runtime
    const llm = runtime.llmFactory()

    // Convert Ollama messages to Anthropic format
    const anthropicMessages: MessageParam[] = []
    let userPrompt = ''

    // Process all messages except the last one
    for (let i = 0; i < messages.length - 1; i++) {
      anthropicMessages.push(convertOllamaMessageToAnthropic(messages[i]))
    }

    // The last message is the user's prompt
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'user') {
        userPrompt = lastMessage.content
      }
    }

    if (stream) {
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

      // Process the observable
      const observable = llm.executePromptWithTools(
        userPrompt,
        [],
        anthropicMessages
      )

      observable.subscribe({
        next: (message) => {
          if (message.role === 'assistant') {
            // Convert Anthropic message to Ollama format
            const ollamaMessage = convertAnthropicMessageToOllama(message)
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

              void writer.write(encoder.encode(JSON.stringify(response) + '\n'))
            }
          }
        },
        error: (err) => {
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
          // Send completion event and close
          const finalResponse = {
            model,
            created_at: new Date().toISOString(),
            done: true,
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
      // Non-streaming response
      return new Promise<Response>((resolve) => {
        let assistantMessage: Message | null = null

        const observable = llm.executePromptWithTools(
          userPrompt,
          [],
          anthropicMessages
        )

        observable.subscribe({
          next: (message) => {
            if (message.role === 'assistant') {
              assistantMessage = convertAnthropicMessageToOllama(message)
            }
          },
          error: (err) => {
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
