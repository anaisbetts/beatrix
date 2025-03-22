import { configDotenv } from 'dotenv'
import { Command } from 'commander'

import index from '../site/index.html'
import { connectToHAWebsocket } from './ha-ws-api'
import { createBuiltinServers } from './execute-prompt-with-tools'
import { createDefaultLLMProvider } from './llm'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

configDotenv()

async function serveCommand(options: { port: string; testMode: boolean }) {
  const port = options.port || process.env.PORT || '5432'

  const conn = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()
  const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })

  console.log(`Starting server on port ${port} (testMode: ${options.testMode})`)
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

async function mcpCommand(options: { testMode: boolean }) {
  const conn = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()
  const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })

  const transport = new StdioServerTransport()
  for (const t of tools) {
    await t.server.connect(transport)
  }
}

async function main() {
  const program = new Command()

  program
    .name('ha-agentic-automation')
    .description('Home Assistant Agentic Automation')
    .version('0.1.0')

  program
    .command('serve')
    .description('Start the HTTP server')
    .option('-p, --port <port>', 'port to run server on')
    .option(
      '-t, --test-mode',
      'enable read-only mode that simulates write operations',
      false
    )
    .action(serveCommand)

  program
    .command('mcp')
    .description('Run all built-in tools as an MCP server')
    .option(
      '-t, --test-mode',
      'enable read-only mode that simulates write operations',
      false
    )
    .action(mcpCommand)

  // Default command is 'serve' if no command is specified
  if (process.argv.length <= 2) {
    process.argv.push('serve')
  }

  await program.parseAsync()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
