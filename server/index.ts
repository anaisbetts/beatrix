import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ServerWebSocket } from 'bun'
import { Command } from 'commander'
import { configDotenv } from 'dotenv'
import { mkdir } from 'fs/promises'
import { sql } from 'kysely'
import path from 'path'
import { Subject, filter } from 'rxjs'

import packageJson from '../package.json'
import pkg from '../package.json'
import { ServerWebsocketApi, messagesToString } from '../shared/prompt'
import { ScenarioResult } from '../shared/types'
import { ServerMessage } from '../shared/ws-rpc'
import { ServerWebsocketApiImpl } from './api'
import { createDatabaseViaEnv } from './db'
import { EvalHomeAssistantApi, createLLMDriver } from './eval-framework'
import { LiveHomeAssistantApi } from './lib/ha-ws-api'
import { handleWebsocketRpc } from './lib/ws-rpc'
import { createBuiltinServers, createDefaultLLMProvider } from './llm'
import { disableLogging, i, startLogger } from './logging'
import { runAllEvals, runQuickEvals } from './run-evals'
import serveStatic from './serve-static-bun'
import { isProdMode, repoRootDir } from './utils'
import {
  AutomationRuntime,
  LiveAutomationRuntime,
} from './workflow/automation-runtime'

configDotenv()

const DEFAULT_PORT = '8080'

async function serveCommand(options: {
  port: string
  notebook: string
  testMode: boolean
  evalMode: boolean
}) {
  const port = options.port || process.env.PORT || DEFAULT_PORT

  const conn = options.evalMode
    ? new EvalHomeAssistantApi()
    : await LiveHomeAssistantApi.createViaEnv()

  const db = await createDatabaseViaEnv()
  await startLogger(db)

  await mkdir(path.join(options.notebook, 'automations'), {
    recursive: true,
  })
  const runtime = new LiveAutomationRuntime(
    conn,
    createDefaultLLMProvider(),
    db,
    path.resolve(options.notebook, 'automations')
  )

  console.log(
    `Starting server on port ${port} (testMode: ${options.testMode || options.evalMode}, evalMode: ${options.evalMode}})`
  )
  const subj: Subject<ServerMessage> = new Subject()

  handleWebsocketRpc<ServerWebsocketApi>(
    new ServerWebsocketApiImpl(runtime, options.testMode, options.evalMode),
    subj
  )

  if (isProdMode) {
    i('Running in Production Mode')
  } else {
    i('Running in development server-only mode')
  }

  // Setup graceful shutdown handler
  process.on('SIGINT', () => {
    void flushAndExit(runtime)
  })

  const assetsServer = serveStatic(path.join(repoRootDir(), 'public'))

  Bun.serve({
    port: port,
    async fetch(req, server) {
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
  // Because MCP relies on stdio for transport, it is important that we don't
  // spam any other console output
  disableLogging()

  const runtime = new LiveAutomationRuntime(
    await LiveHomeAssistantApi.createViaEnv(),
    createDefaultLLMProvider(),
    await createDatabaseViaEnv()
  )

  const megaServer = new McpServer({ name: 'beatrix', version: pkg.version })
  createBuiltinServers(runtime, { testMode: options.testMode, megaServer })
  await megaServer.server.connect(new StdioServerTransport())
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
    .option(
      '-n, --notebook <dir>',
      'the directory to load automations and prompts from'
    )
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

async function flushAndExit(runtime: AutomationRuntime) {
  try {
    console.log('Flushing database...')

    // Run PRAGMA commands to ensure database integrity during shutdown
    await sql`PRAGMA wal_checkpoint(FULL)`.execute(runtime.db)

    // Close database connection
    await runtime.db.destroy()
  } catch (error) {
    console.error('Error during shutdown:', error)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
