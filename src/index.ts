import { configDotenv } from 'dotenv'

import index from '../site/index.html'
import { connectToHAWebsocket } from './ha-ws-api'
import {
  AnthropicLargeLanguageProvider,
  createBuiltinServers,
} from './execute-prompt-with-tools'

configDotenv()

async function main() {
  const port = process.env.PORT || '5432'

  const conn = await connectToHAWebsocket()

  const llm = new AnthropicLargeLanguageProvider()
  const tools = createBuiltinServers(conn)

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
