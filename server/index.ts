import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ServerWebSocket } from 'bun'
import { Command } from 'commander'
import { configDotenv } from 'dotenv'
import { mkdir, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { createBunWebSocket } from 'hono/bun'
import { sql } from 'kysely'
import { DateTime } from 'luxon'
import path from 'path'
import { Observable, Subject, Subscription, filter, mergeMap } from 'rxjs'

import pkg from '../package.json'
import { ServerWebsocketApi, messagesToString } from '../shared/api'
import { SerialSubscription } from '../shared/serial-subscription'
import { Automation, BugReportData, ScenarioResult } from '../shared/types'
import { ServerMessage } from '../shared/ws-rpc'
import { ServerWebsocketApiImpl } from './api'
import { createConfigViaEnv } from './config'
import { createDatabase, createDatabaseViaEnv } from './db'
import { EvalHomeAssistantApi } from './eval-framework'
import { LiveHomeAssistantApi, filterUncommonEntities } from './lib/ha-ws-api'
import { handleWebsocketRpc } from './lib/ws-rpc'
import { createBuiltinServers, createDefaultLLMProvider } from './llm'
import { disableLogging, e, i, startLogger } from './logging'
import { setOllamaApiImpl, setupOllamaProxy } from './ollama-proxy'
import { setOpenAIAutomationRuntime, setupOpenAIProxy } from './openai-proxy'
import { isProdMode, repoRootDir } from './paths'
import { runAllEvals, runQuickEvals } from './run-evals'
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

  i(
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
        let { runtime, subscription, wsApi } = await initializeRuntimeAndStart(
          options.notebook,
          options.evalMode,
          options.testMode,
          websocketMessages
        )

        runtime.shouldRestart.subscribe(() => startItUp.next(undefined))

        currentSub.current = subscription
        currentRuntime = runtime

        setOpenAIAutomationRuntime(currentRuntime)
        setOllamaApiImpl(wsApi)
      })
    )
    .subscribe()

  process.on('SIGINT', () => {
    console.log('Got sigint!')
    if (currentRuntime) void flushAndExit(currentRuntime)
  })
  process.on('SIGTERM', () => {
    console.log('Got sigterm!')
    if (currentRuntime) void flushAndExit(currentRuntime)
  })
  process.on('SIGQUIT', () => {
    console.log('Got sigterm!')
    if (currentRuntime) void flushAndExit(currentRuntime)
  })

  const app = new Hono()

  const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>()
  app.get(
    '/api/ws',
    upgradeWebSocket(() => {
      return {
        onMessage(message, ws) {
          const data =
            typeof message.data === 'string'
              ? message.data
              : JSON.stringify({ type: 'binary-data' })

          websocketMessages.next({
            message: data,
            reply: async (m) => {
              ws.send(m)
            },
          })
        },
        onClose() {
          i('WebSocket connection closed')
        },
        onError(error) {
          e('WebSocket error:', error)
        },
      }
    })
  )

  setupOpenAIProxy(app)
  setupOllamaProxy(app)

  app.use('/*', serveStatic({ root: path.join(repoRootDir(), 'public') }))

  // Start the server
  Bun.serve({
    port: parseInt(port),
    fetch: app.fetch,
    websocket,
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

  console.log(`Running ${options.quick ? 'quick' : 'all'} evals...`)
  const results = []
  for (let i = 0; i < parseInt(options.num); i++) {
    console.log(`Run ${i + 1} of ${options.num}`)

    const evalFunction = options.quick ? runQuickEvals : runAllEvals
    for await (const result of evalFunction(() =>
      createDefaultLLMProvider(config, {
        modelWithDriver: `${driver}/${model}`,
      })
    )) {
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

async function dumpBugReportCommand(options: { dbPath?: string }) {
  disableLogging()
  console.log('Dumping latest bug report...')

  const db = options.dbPath
    ? await createDatabase(options.dbPath)
    : await createDatabaseViaEnv()

  try {
    const bugReportEntry = await db
      .selectFrom('logs')
      .select(['createdAt', 'message'])
      .where('level', '=', 100)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst()

    if (!bugReportEntry?.message) {
      console.error('No bug report found (log level 100).')
      return
    }

    let bugReportData: BugReportData
    try {
      bugReportData = JSON.parse(bugReportEntry.message) as BugReportData
    } catch (error) {
      console.error('Failed to parse bug report JSON:', error)
      return
    }
    const createdAt = DateTime.fromISO(bugReportEntry.createdAt)
    const reportDirName = `bug-report-${createdAt.toFormat('yyyyMMdd_HHmmss')}`
    console.log(`Creating bug report directory: ${reportDirName}`)
    await mkdir(reportDirName, { recursive: true })
    const reportDirPath = path.resolve(reportDirName)

    await writeFile(
      path.join(reportDirPath, 'states.json'),
      JSON.stringify(bugReportData.states, null, 2)
    )
    await writeFile(
      path.join(reportDirPath, 'services.json'),
      JSON.stringify(bugReportData.services, null, 2)
    )

    const writeAutomationFiles = async (
      items: Automation[],
      subDir: string
    ) => {
      const dirPath = path.join(reportDirPath, subDir)
      await mkdir(dirPath, { recursive: true })

      for (const item of items) {
        // Normalize paths to use forward slashes for cross-platform compatibility
        const normalizedFileName = item.fileName.replace(/\\/g, '/')
        const normalizedNotebookRoot = (
          bugReportData.notebookRoot ?? ''
        ).replace(/\\/g, '/')

        // Ensure notebookRoot ends with a slash for correct replacement
        const notebookRootPrefix = normalizedNotebookRoot.endsWith('/')
          ? normalizedNotebookRoot
          : `${normalizedNotebookRoot}/`

        const relativePath = normalizedFileName.replace(notebookRootPrefix, '')

        if (relativePath === normalizedFileName) {
          // This should not happen if notebookRoot is set correctly, but good to check
          console.warn(
            `Could not make path relative: ${item.fileName} (notebookRoot: ${bugReportData.notebookRoot})`
          )
        }

        const filePath = path.join(dirPath, relativePath)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, item.contents)
      }
    }

    await writeAutomationFiles(bugReportData.automations, 'automations')
    await writeAutomationFiles(bugReportData.cues, 'cues')

    console.log('Bug report dump complete.')
  } finally {
    await db.destroy()
  }
}

async function dumpEventsCommand() {
  const config = await createConfigViaEnv('.')
  const conn = await LiveHomeAssistantApi.createViaConfig(config)

  const states = filterUncommonEntities(await conn.fetchStates())
  await Bun.write('./states.json', JSON.stringify(states, null, 2))

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

  const runtime = await LiveAutomationRuntime.createViaConfig(
    config,
    conn,
    path.resolve(notebook)
  )

  subscription.add(await startLogger(runtime.db, config.timezone ?? 'Etc/UTC'))
  const wsApi = new ServerWebsocketApiImpl(
    config,
    runtime,
    path.resolve(notebook),
    testMode,
    evalMode
  )

  handleWebsocketRpc<ServerWebsocketApi>(wsApi, websocketMessages)

  subscription.add(runtime.start())
  return { runtime, subscription, wsApi }
}

let exiting = false
async function flushAndExit(runtime: AutomationRuntime) {
  if (exiting) return
  exiting = true

  try {
    i('Flushing database...')
    disableLogging()

    // Run PRAGMA commands to ensure database integrity during shutdown
    await sql`PRAGMA wal_checkpoint(FULL)`.execute(runtime.db)

    // Close database connection
    await runtime.db.destroy()
    runtime.unsubscribe()
  } catch (error) {
    e('Error during shutdown:', error)
  }

  // NB: There seems to be a bug in Bun where if you call db.close() then
  // immediately exit, the database connection will not be correctly closed
  setTimeout(() => process.exit(0), 100)
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

  program
    .command('dump-bug-report')
    .description('Dumps the latest captured bug report data into a directory.')
    .option(
      '--db-path <path>',
      'Path to the database file to dump the report from (defaults to app.db in data dir)'
    )
    .action(dumpBugReportCommand)

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
