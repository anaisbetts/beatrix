import { configDotenv } from 'dotenv'

import index from '../site/index.html'
import { connectToHAWebsocket } from './ha-ws-api'
import {
  AnthropicLargeLanguageProvider,
  createBuiltinServers,
  LargeLanguageProvider,
  OllamaLargeLanguageProvider,
} from './execute-prompt-with-tools'

configDotenv()

async function main() {
  const port = process.env.PORT || '5432'

  const conn = await connectToHAWebsocket()

  let llm: LargeLanguageProvider

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Found Anthropic API key, using Anthropic as provider')
    llm = new AnthropicLargeLanguageProvider(process.env.ANTHROPIC_API_KEY)
  } else if (process.env.OLLAMA_HOST) {
    console.log('Found Ollama host, using Ollama as provider')
    llm = new OllamaLargeLanguageProvider(process.env.OLLAMA_HOST)
  }

  const tools = createBuiltinServers(conn, { testMode: true })

  console.log('Starting server on port', port)
  Bun.serve({
    port: port,
    routes: {
      '/': index,
      '/api/prompt': {
        POST: async (req) => {
          const { prompt } = await req.json()
          try {
            const resp = await llm.executePromptWithTools(prompt, tools)
            return Response.json({ prompt, messages: resp })
          } catch (e) {
            console.error(e)
            return Response.json({ prompt, error: JSON.stringify(e) })
          }
        },
      },
    },
  })
}

main()
  //.then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
