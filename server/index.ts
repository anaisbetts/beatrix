import { configDotenv } from 'dotenv'
import { Command } from 'commander'

import index from '../site/index.html'
import { connectToHAWebsocket } from './lib/ha-ws-api'
import { createBuiltinServers } from './llm'
import { createDefaultLLMProvider } from './llm'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { handlePromptRequest } from './api'
import { createDatabase } from './db'
import { ServerWebSocket } from 'bun'
import { Subject } from 'rxjs'
import { ServerMessage } from '../shared/ws-rpc'
import { handleWebsocketRpc } from './ws-rpc'

configDotenv()

async function serveCommand(options: { port: string; testMode: boolean }) {
  const port = options.port || process.env.PORT || '5432'

  const conn = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()
  const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })
  const db = await createDatabase()

  console.log(`Starting server on port ${port} (testMode: ${options.testMode})`)
  const subj: Subject<ServerMessage> = new Subject()

  handleWebsocketRpc(
    {
      helloWorld: () => 'Hello world',
    },
    subj
  )

  Bun.serve({
    port: port,
    fetch(req, server) {
      const u = URL.parse(req.url)
      if (u?.pathname === '/api/ws' && server.upgrade(req)) {
        return new Response()
      }

      return new Response('yes')
    },
    routes: {
      '/': index,
      '/api/prompt': {
        POST: (req) => handlePromptRequest(db, llm, tools, req),
      },
    },
    websocket: {
      async message(ws: ServerWebSocket, message: string | Buffer) {
        subj.next({
          message: message,
          reply: async (m) => {
            ws.send(m, true)
          },
        })
      },
    },
  })
}

async function mcpCommand(options: { testMode: boolean }) {
  const conn = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()

  // XXX: Ugh, there's no way to expose multiple servers in one go. For now, just expose
  // Home Assistant
  //const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })
  const ha = createHomeAssistantServer(conn, llm, {
    testMode: options.testMode,
  })
  await ha.server.connect(new StdioServerTransport())

  /*
  for (const t of tools) {
    const transport = new StdioServerTransport()
    await t.server.connect(transport)
  }
  */
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
