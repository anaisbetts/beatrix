import { configDotenv } from 'dotenv'
import { Command } from 'commander'

import { connectToHAWebsocket } from './lib/ha-ws-api'
import { createBuiltinServers, LargeLanguageProvider } from './llm'
import { createDefaultLLMProvider } from './llm'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { ServerWebsocketApiImpl } from './api'
import { createDatabase } from './db'
import { ServerWebSocket } from 'bun'
import { Subject } from 'rxjs'
import { ServerMessage } from '../shared/ws-rpc'
import { handleWebsocketRpc } from './ws-rpc'
import { messagesToString, ServerWebsocketApi } from '../shared/prompt'
import serveStatic from './serve-static-bun'

import path from 'path'
import { exists } from 'fs/promises'
import { AnthropicLargeLanguageProvider } from './anthropic'
import { OllamaLargeLanguageProvider } from './ollama'
import { runAllEvals } from './run-all-evals'
import { ScenarioResult } from './eval-framework'

configDotenv()

const DEFAULT_PORT = '8080'

function repoRootDir() {
  // If we are running as a single-file executable all of the normal node methods
  // to get __dirname get Weird. However, if we're running in dev mode, we can use
  // our usual tricks
  const haystack = ['bun.exe', 'bun-profile.exe', 'bun', 'node']
  const needle = path.basename(process.execPath)
  if (haystack.includes(needle)) {
    return path.resolve(__dirname, '..')
  } else {
    return path.dirname(process.execPath)
  }
}

async function serveCommand(options: { port: string; testMode: boolean }) {
  const port = options.port || process.env.PORT || DEFAULT_PORT

  const conn = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()
  const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })
  const db = await createDatabase()

  console.log(`Starting server on port ${port} (testMode: ${options.testMode})`)
  const subj: Subject<ServerMessage> = new Subject()

  handleWebsocketRpc<ServerWebsocketApi>(
    new ServerWebsocketApiImpl(db, llm, tools),
    subj
  )

  const isProdMode = await exists(path.join(repoRootDir(), 'assets'))
  if (isProdMode) {
    console.log('Running in Production Mode')
  } else {
    console.log('Running in development server-only mode')
  }

  const assetsServer = serveStatic(path.join(repoRootDir(), 'public'))

  Bun.serve({
    port: port,
    async fetch(req, server) {
      // XXX: This sucks, there's gotta be a better way
      const u = URL.parse(req.url)
      if (u?.pathname === '/api/ws' && server.upgrade(req)) {
        return new Response()
      }
      return await assetsServer(req)
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

function printResult(result: ScenarioResult) {
  // Indent the message if it has >1 line
  const lastMsg = messagesToString([
    result.messages[result.messages.length - 1],
  ])
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')

  console.log(`Eval: ${result.prompt} (tools: ${result.toolsDescription})`)
  console.log(`Last message: ${lastMsg}`)
  console.log(`Score: ${result.finalScore}/${result.finalScorePossible}`)
}

async function evalCommand(options: {
  model: string
  driver: string
  verbose: boolean
  num: number
}) {
  const { model, driver } = options

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is required, it is used for eval grading'
    )
  }

  let llm: LargeLanguageProvider
  if (driver === 'anthropic') {
    llm = new AnthropicLargeLanguageProvider(
      process.env.ANTHROPIC_API_KEY,
      model
    )
  } else if (driver === 'ollama') {
    if (!process.env.OLLAMA_HOST) {
      throw new Error('OLLAMA_HOST is required for Ollama driver')
    }

    llm = new OllamaLargeLanguageProvider(process.env.OLLAMA_HOST, model)
  } else {
    throw new Error("Invalid driver specified. Use 'anthropic' or 'ollama'.")
  }

  console.log('Running all evals...')
  const results = []
  for (let i = 0; i < options.num; i++) {
    console.log(`Run ${i + 1} of ${options.num}`)

    for await (const result of runAllEvals(llm)) {
      results.push(result)
      if (options.verbose) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        printResult(result)
      }

      console.log('\n')
    }
  }

  const { score, possibleScore } = results.reduce(
    (acc, x) => {
      acc.score += x.finalScore
      acc.possibleScore += x.finalScorePossible
      return acc
    },
    { score: 0, possibleScore: 0 }
  )

  console.log(
    `Overall Score: ${score}/${possibleScore} (${(score / possibleScore) * 100.0}%`
  )
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

  program
    .command('evals')
    .description('Run evaluations for a given model')
    .option('-m, --model <model>', 'The model to evaluate')
    .option(
      '-d, --driver <driver>',
      'The service to evaluate, either "anthropic" or "ollama"',
      'ollama'
    )
    .option('-n, --num <num>', 'Number of repetitions to run', 1)
    .option('-v, --verbose', 'Enable verbose output', false)

    .action(evalCommand)

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
