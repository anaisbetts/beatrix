import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ServerWebSocket } from 'bun'
import { Command } from 'commander'
import { configDotenv } from 'dotenv'
import { mkdir } from 'fs/promises'
import { sql } from 'kysely'
import path from 'path'
import { Observable, Subject, Subscription, filter, mergeMap } from 'rxjs'

import pkg from '../package.json'
import { ServerWebsocketApi, messagesToString } from '../shared/api'
import { SerialSubscription } from '../shared/serial-subscription'
import { ScenarioResult } from '../shared/types'
import { ServerMessage } from '../shared/ws-rpc'
import { ServerWebsocketApiImpl } from './api'
import { createConfigViaEnv } from './config'
import { createDatabaseViaEnv } from './db'
import { EvalHomeAssistantApi } from './eval-framework'
import { LiveHomeAssistantApi } from './lib/ha-ws-api'
import { handleWebsocketRpc } from './lib/ws-rpc'
import { createBuiltinServers, createDefaultLLMProvider } from './llm'
import { disableLogging, i, startLogger } from './logging'
import { isProdMode, repoRootDir } from './paths'
import { runAllEvals, runQuickEvals } from './run-evals'
import serveStatic from './serve-static-bun'
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
  const websocketMessages: Subject<ServerMessage> = new Subject()
  const startItUp: Subject<void> = new Subject()

  console.log(
    `Starting server on port ${port} (testMode: ${options.testMode || options.evalMode}, evalMode: ${options.evalMode})`
  )

  if (isProdMode) {
    i('Running in Production Mode')
  } else {
    i('Running in development server-only mode')
  }

  const currentSub = new SerialSubscription()
  let currentRuntime: AutomationRuntime

  startItUp
    .pipe(
      mergeMap(async () => {
        i('Starting up Runtime')
        let { runtime, subscription } = await initializeRuntimeAndStart(
          options.notebook,
          options.evalMode,
          options.testMode,
          websocketMessages
        )

        runtime.shouldRestart.subscribe(() => startItUp.next(undefined))

        currentSub.current = subscription
        currentRuntime = runtime
      })
    )
    .subscribe()

  // Setup graceful shutdown handler
  process.on('SIGINT', () => {
    if (currentRuntime) void flushAndExit(currentRuntime)
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
        websocketMessages.next({
          message: message,
          reply: async (m) => {
            ws.send(m, true)
          },
        })
      },
    },
  })

  startItUp.next(undefined)
}

async function mcpCommand(options: { testMode: boolean; notebook: string }) {
  // Because MCP relies on stdio for transport, it is important that we don't
  // spam any other console output
  disableLogging()

  const config = await createConfigViaEnv(options.notebook)
  const runtime = await LiveAutomationRuntime.createViaConfig(config)

  const megaServer = new McpServer({ name: 'beatrix', version: pkg.version })
  createBuiltinServers(runtime, null, {
    testMode: options.testMode,
    megaServer,
  })

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
  notebook: string
  model: string
  driver: string
  verbose: boolean
  num: string
  quick: boolean
}) {
  const { model, driver } = options

  const config = await createConfigViaEnv(options.notebook)
  const llm = createDefaultLLMProvider(config, driver, model)

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
  const config = await createConfigViaEnv('.')
  const conn = await LiveHomeAssistantApi.createViaConfig(config)

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

async function initializeRuntimeAndStart(
  notebook: string,
  evalMode: boolean,
  testMode: boolean,
  websocketMessages: Observable<ServerMessage>
) {
  const subscription = new Subscription()
  const config = await createConfigViaEnv(notebook)

  await mkdir(path.join(notebook, 'automations'), {
    recursive: true,
  })

  const conn = evalMode
    ? new EvalHomeAssistantApi()
    : await LiveHomeAssistantApi.createViaConfig(config)

  const db = await createDatabaseViaEnv()
  subscription.add(await startLogger(db, config.timezone ?? 'Etc/UTC'))

  const runtime = await LiveAutomationRuntime.createViaConfig(
    config,
    conn,
    path.resolve(notebook)
  )

  handleWebsocketRpc<ServerWebsocketApi>(
    new ServerWebsocketApiImpl(
      config,
      runtime,
      path.resolve(notebook),
      testMode,
      evalMode
    ),
    websocketMessages
  )

  subscription.add(runtime.start())
  return { runtime, subscription }
}

async function flushAndExit(runtime: AutomationRuntime) {
  try {
    console.log('Flushing database...')

    // Run PRAGMA commands to ensure database integrity during shutdown
    await sql`PRAGMA wal_checkpoint(FULL)`.execute(runtime.db)

    // Close database connection
    await runtime.db.destroy()
    runtime.unsubscribe()
  } catch (error) {
    console.error('Error during shutdown:', error)
  }

  process.exit(0)
}

async function main() {
  const program = new Command()
  const debugMode = process.execPath.endsWith('bun')

  program
    .name('beatrix')
    .description('Home Assistant Agentic Automation')
    .version(pkg.version)

  program
    .command('serve')
    .description('Start the HTTP server')
    .option('-p, --port <port>', 'port to run server on')
    .option(
      '-n, --notebook <dir>',
      'the directory to load automations and prompts from',
      './notebook'
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
    .option(
      '-n, --notebook <dir>',
      'the directory to load automations and prompts from',
      './notebook'
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
    .option(
      '--notebook <dir>',
      'the directory to load automations and prompts from',
      './notebook'
    )
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
