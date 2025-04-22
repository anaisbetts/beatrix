#!/usr/bin/env bun
import debug from 'debug'
import { config } from 'dotenv'
import OpenAI from 'openai'
import process from 'process'

const d = debug('b:openai-test')

// Load environment variables
config()

async function main() {
  // Set up OpenAI client pointing to our local server
  const baseUrl =
    process.env.TEST_OPENAI_BASE_URL || 'http://localhost:8080/openai/v1'
  d('Using OpenAI base URL: %s', baseUrl)

  const openai = new OpenAI({
    apiKey: 'dummy-key', // The key doesn't matter for our proxy
    baseURL: baseUrl,
  })

  try {
    // Test the models endpoint
    d('Testing /v1/models endpoint...')
    const models = await openai.models.list()
    console.log(
      'Available models:',
      models.data.map((model) => model.id)
    )

    // Test the chat completions endpoint with both streaming and non-streaming modes
    await testChatCompletions(openai, false)
    await testChatCompletions(openai, true)

    console.log('All tests completed successfully!')
  } catch (error) {
    console.error('Error during testing:', error)
    process.exit(1)
  }
}

async function testChatCompletions(openai: OpenAI, stream: boolean) {
  d('Testing /v1/chat/completions (stream=%s)...', stream)

  const prompt = 'Tell me a short joke about programming'
  console.log(`\nSending prompt: "${prompt}" (stream=${stream})`)

  if (stream) {
    // Test streaming mode
    const stream = await openai.chat.completions.create({
      model: 'beatrix-runtime',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    })

    console.log('\nStreaming response:')
    let fullResponse = ''

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        process.stdout.write(content)
        fullResponse += content
      }
    }

    console.log('\n\nComplete streamed response:', fullResponse)
  } else {
    // Test regular mode
    const completion = await openai.chat.completions.create({
      model: 'beatrix-runtime',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    })

    console.log('\nResponse:')
    console.log(completion.choices[0]?.message?.content)
    console.log('\nFull response object:', JSON.stringify(completion, null, 2))
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
