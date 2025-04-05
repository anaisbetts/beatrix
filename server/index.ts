import { configDotenv } from 'dotenv'
import { Command } from 'commander'

import { createDefaultLLMProvider } from './llm'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { ServerWebsocketApiImpl } from './api'
import { createDatabase } from './db'
import { ServerWebSocket } from 'bun'
import { filter, Subject } from 'rxjs'
import { ServerMessage } from '../shared/ws-rpc'
import { handleWebsocketRpc } from './lib/ws-rpc'
import { messagesToString, ServerWebsocketApi } from '../shared/prompt'
import serveStatic from './serve-static-bun'

import path from 'path'
import { exists } from 'fs/promises'
import { runAllEvals, runQuickEvals } from './run-evals'
import { ScenarioResult } from '../shared/types'
import { createLLMDriver } from './eval-framework'
import { LiveHomeAssistantApi } from './lib/ha-ws-api'
import packageJson from '../package.json'
import { LiveAutomationRuntime } from './workflow/automation-runtime'

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

async function serveCommand(options: {
  port: string
  automations: string
  testMode: boolean
  evalMode: boolean
}) {
  const port = options.port || process.env.PORT || DEFAULT_PORT

  const conn = await LiveHomeAssistantApi.createViaEnv()
  const db = await createDatabase()
  const service = new LiveAutomationRuntime(
    conn,
    createDefaultLLMProvider(),
    db,
    path.resolve(options.automations)
  )

  console.log(
    `Starting server on port ${port} (testMode: ${options.testMode || options.evalMode}, evalMode: ${options.evalMode}})`
  )
  const subj: Subject<ServerMessage> = new Subject()

  handleWebsocketRpc<ServerWebsocketApi>(
    new ServerWebsocketApiImpl(service, options.testMode, options.evalMode),
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
  const api = await LiveHomeAssistantApi.createViaEnv()
  const llm = createDefaultLLMProvider()

  // XXX: Ugh, there's no way to expose multiple servers in one go. For now, just expose
  // Home Assistant
  //const tools = createBuiltinServers(conn, llm, { testMode: options.testMode })
  const ha = createHomeAssistantServer(api, llm, {
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
  num: string
  quick: boolean
}) {
  const { model, driver } = options

  const llm = createLLMDriver(model, driver)

  console.log(`Running ${options.quick ? 'quick' : 'all'} evals...`)
  const results = []
  for (let i = 0; i < parseInt(options.num); i++) {
    console.log(`Run ${i + 1} of ${options.num}`)

    const evalFunction = options.quick ? runQuickEvals : runAllEvals
    for await (const result of evalFunction(llm)) {
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
    `Overall Score: ${score}/${possibleScore} (${(score / possibleScore) * 100.0}%)`
  )
}

async function dumpEventsCommand() {
  const conn = await LiveHomeAssistantApi.createViaEnv()

  console.error('Dumping non-noisy events...')
  conn
    .eventsObservable()
    .pipe(
      filter(
        (x) =>
          x.event_type !== 'state_changed' && x.event_type !== 'call_service'
      )
    )
    .subscribe((event) => {
      console.log(JSON.stringify(event))
    })
}

async function main() {
  const program = new Command()
  const debugMode = process.execPath.endsWith('bun')

  program
    .name('beatrix')
    .description('Home Assistant Agentic Automation')
    .version(packageJson.version)

  program
    .command('serve')
    .description('Start the HTTP server')
    .option('-p, --port <port>', 'port to run server on')
    .option('-a, --automations <dir>', 'the directory to load automations from')
    .option(
      '-t, --test-mode',
      'enable read-only mode that simulates write operations',
      false
    )
    .option(
      '-e, --eval-mode',
      'Runs the server in eval mode which makes the debug chat target the evals data. Implies -t',
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
      'The service to evaluate: "anthropic", "ollama", or "openai"',
      'anthropic'
    )
    .option('-n, --num <num>', 'Number of repetitions to run', '1')
    .option('-v, --verbose', 'Enable verbose output', false)
    .option('-q, --quick', 'Run quick evals instead of full evaluations', false)
    .action(evalCommand)

  if (debugMode) {
    program
      .command('dump-events')
      .description('Dump events to stdout')
      .action(dumpEventsCommand)
  }

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
