#!/usr/bin/env bun
import debug from 'debug'
import { config } from 'dotenv'
import { Ollama } from 'ollama'
import process from 'process'

const d = debug('b:ollama-test')

// Load environment variables
config()

async function main() {
  // Set up Ollama client pointing to our local server
  const baseUrl =
    process.env.TEST_OLLAMA_BASE_URL || 'http://localhost:8080/ollama'
  d('Using Ollama base URL: %s', baseUrl)

  const ollama = new Ollama({ host: baseUrl })

  try {
    // Test the models endpoint
    d('Testing models listing endpoint...')
    const models = await ollama.list()
    console.log(
      'Available models:',
      models.models.map((model) => model.name)
    )

    // Test the chat completions endpoint with both streaming and non-streaming modes
    await testOllamaChat(ollama, false)
    await testOllamaChat(ollama, true)

    console.log('All tests completed successfully!')
  } catch (error) {
    console.error('Error during testing:', error)
    process.exit(1)
  }
}

async function testOllamaChat(ollama: Ollama, streamMode: boolean) {
  d('Testing chat completion (stream=%s)...', streamMode)

  const prompt = 'Tell me a short joke about programming'
  console.log(`\nSending prompt: "${prompt}" (stream=${streamMode})`)

  const messages = [{ role: 'user', content: prompt }]

  if (streamMode) {
    // Test streaming mode
    console.log('\nStreaming response:')
    let fullResponse = ''

    const stream = await ollama.chat({
      model: 'beatrix-runtime',
      messages,
      stream: true,
    })

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        process.stdout.write(chunk.message.content)
        fullResponse += chunk.message.content
      }
    }

    console.log('\n\nComplete streamed response:', fullResponse)
  } else {
    // Test regular mode
    const response = await ollama.chat({
      model: 'beatrix-runtime',
      messages,
      stream: false,
    })

    console.log('\nResponse:')
    console.log(response.message?.content)
    console.log('\nFull response object:', JSON.stringify(response, null, 2))
  }
}

// Run the main function
main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
