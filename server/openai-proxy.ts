import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Hono } from 'hono'
import { BlankEnv, BlankSchema } from 'hono/types'

import {
  convertAnthropicMessageToOpenAI,
  convertOpenAIMessageToAnthropic,
} from './openai'
import { AutomationRuntime } from './workflow/automation-runtime'

let runtime: AutomationRuntime | undefined
export function setOpenAIAutomationRuntime(currentRuntime: AutomationRuntime) {
  runtime = currentRuntime
}

export function setupOpenAIProxy(app: Hono<BlankEnv, BlankSchema, '/'>) {
  app.get('/openai/v1/models', (c) => {
    return c.json({
      object: 'list',
      data: [
        {
          id: 'beatrix-runtime',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'beatrix',
        },
      ],
    })
  })

  app.post('/openai/v1/chat/completions', async (c) => {
    const body = await c.req.json()
    const { messages, stream = false } = body

    if (!runtime) {
      c.status(500)
      c.text('Runtime not set up')
    }

    // Create LLM provider using runtime
    const llm = runtime!.llmFactory({ type: 'automation' })

    // Convert OpenAI messages to Anthropic format
    const anthropicMessages: MessageParam[] = []
    let userPrompt = ''

    // Process all messages except the last one
    for (let i = 0; i < messages.length - 1; i++) {
      anthropicMessages.push(convertOpenAIMessageToAnthropic(messages[i]))
    }

    // The last message is the user's prompt
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'user') {
        userPrompt =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content)
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

      // Send the initial event
      const initialEvent = encoder.encode(
        `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'beatrix-runtime',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            },
          ],
        })}\n\n`
      )

      void writer.write(initialEvent)

      // Process the observable
      const observable = llm.executePromptWithTools(
        userPrompt,
        [],
        anthropicMessages
      )

      observable.subscribe({
        next: (message) => {
          if (message.role === 'assistant') {
            // Convert Anthropic message to OpenAI format
            const openaiMessage = convertAnthropicMessageToOpenAI(message)
            const content =
              typeof openaiMessage.content === 'string'
                ? openaiMessage.content
                : JSON.stringify(openaiMessage.content)

            // Send content chunk
            if (content) {
              const event = encoder.encode(
                `data: ${JSON.stringify({
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'beatrix-runtime',
                  choices: [
                    {
                      index: 0,
                      delta: { content },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`
              )
              void writer.write(event)
            }
          }
        },
        error: (err) => {
          console.error('Error in stream:', err)
          // Send error event and close the writer
          const event = encoder.encode(
            `data: ${JSON.stringify({
              error: {
                message: err.message || 'Unknown error',
                type: 'server_error',
              },
            })}\n\n`
          )

          // We need to handle this synchronously in the callback
          void writer.write(event)
          // We need to close in a separate step
          void writer.close().catch((closeErr) => {
            console.error('Error closing stream after error:', closeErr)
          })
        },
        complete: () => {
          // Send completion event and close
          const event = encoder.encode(
            `data: ${JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'beatrix-runtime',
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            })}\n\n`
          )

          // Handle each operation separately
          void writer
            .write(event)
            .then(() => writer.write(encoder.encode('data: [DONE]\n\n')))
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
        let fullAssistantMessage = ''

        const observable = llm.executePromptWithTools(
          userPrompt,
          [],
          anthropicMessages
        )

        observable.subscribe({
          next: (message) => {
            if (message.role === 'assistant') {
              const openaiMessage = convertAnthropicMessageToOpenAI(message)
              if (typeof openaiMessage.content === 'string') {
                fullAssistantMessage += openaiMessage.content
              }
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
            resolve(
              c.json({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'beatrix-runtime',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: fullAssistantMessage,
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 0, // We don't have actual token counts
                  completion_tokens: 0,
                  total_tokens: 0,
                },
              })
            )
          },
        })
      })
    }
  })
}
