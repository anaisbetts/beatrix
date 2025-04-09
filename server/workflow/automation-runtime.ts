import debug from 'debug'
import { Kysely } from 'kysely'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  NEVER,
  Observable,
  defer,
  from,
  map,
  merge,
  share,
  startWith,
  switchMap,
  tap,
} from 'rxjs'

import { Automation } from '../../shared/types'
import { AppConfig } from '../config'
import { createDatabaseViaEnv } from '../db'
import { Schema, Signal } from '../db-schema'
import { createBufferedDirectoryMonitor } from '../lib/directory-monitor'
import { HomeAssistantApi, LiveHomeAssistantApi } from '../lib/ha-ws-api'
import { LargeLanguageProvider, createDefaultLLMProvider } from '../llm'
import { e, i } from '../logging'
import { runExecutionForAutomation } from './execution-step'
import { parseAllAutomations } from './parser'
import { rescheduleAutomations } from './scheduler-step'
import {
  AbsoluteTimeSignalHandler,
  CronSignalHandler,
  RelativeTimeSignalHandler,
  SignalHandler,
  StateRegexSignalHandler,
} from './signal-handlers'

export const d = debug('b:automation')

export interface SignalledAutomation {
  signal: Signal
  automation: Automation
}

export interface AutomationRuntime {
  readonly api: HomeAssistantApi
  readonly llm: LargeLanguageProvider
  readonly db: Kysely<Schema>
  readonly notebookDirectory: string | undefined

  automationList: Automation[]
  scheduledSignals: SignalHandler[]

  reparseAutomations: Observable<void>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>
}

export class LiveAutomationRuntime implements AutomationRuntime {
  automationList: Automation[]
  scheduledSignals: SignalHandler[]
  notebookDirectory: string | undefined

  reparseAutomations: Observable<void>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>

  static async createViaConfig(
    config: AppConfig,
    api?: HomeAssistantApi,
    notebookDirectory?: string
  ) {
    const llm = createDefaultLLMProvider(config)
    const db = await createDatabaseViaEnv()

    return new LiveAutomationRuntime(
      api ?? (await LiveHomeAssistantApi.createViaConfig(config)),
      llm,
      db,
      notebookDirectory
    )
  }

  constructor(
    readonly api: HomeAssistantApi,
    readonly llm: LargeLanguageProvider,
    readonly db: Kysely<Schema>,
    notebookDirectory?: string
  ) {
    this.automationList = []
    this.scheduledSignals = []
    this.notebookDirectory = notebookDirectory

    this.reparseAutomations = this.notebookDirectory
      ? createBufferedDirectoryMonitor(
          {
            path: getAutomationDirectory(this),
            recursive: true,
          },
          2000
        ).pipe(
          tap(() =>
            i(
              `Detected change in automation directory: ${this.notebookDirectory}`
            )
          ),
          map(() => {}),
          startWith(undefined)
        )
      : NEVER

    this.scannedAutomationDir = this.notebookDirectory
      ? defer(() => this.reparseAutomations).pipe(
          switchMap(() => {
            i(`Reparsing automations from directory: ${this.notebookDirectory}`)
            return from(
              parseAllAutomations(getAutomationDirectory(this)).then(
                (automations) => {
                  i(`Parsed ${automations.length} automations`)
                  this.automationList = automations
                  return automations
                }
              )
            )
          }),
          share() // Share the result of parsing
        )
      : NEVER

    this.createdSignalsForForAutomations = defer(
      () => this.scannedAutomationDir
    ).pipe(
      switchMap((automations) => {
        i(`Scheduling triggers for ${automations.length} automations`)
        return from(rescheduleAutomations(this, automations)).pipe(
          tap(() => i('Finished scheduling triggers'))
        )
      }),
      share() // Share the result of rescheduling
    )

    this.signalFired = defer(() => this.createdSignalsForForAutomations).pipe(
      switchMap(() => {
        d('Setting up Signals based on database')
        return from(this.handlersForDatabaseSignals())
      }),
      tap({
        next: (handlers) => {
          i(`Created ${handlers.length} Signal handlers from database`)
          this.scheduledSignals = handlers
        },
      }),
      switchMap((handlers) => {
        if (handlers.length === 0) {
          return NEVER
        }
        return merge(...handlers.map((handler) => handler.signalObservable))
      }),
      tap(({ signal, automation }) =>
        i(
          `Signal ID ${signal.id} (${signal.type}) fired for automation: ${automation.fileName} (${automation.hash})`
        )
      ),
      share() // Share the fired signals
    )

    this.automationExecuted = defer(() => this.signalFired).pipe(
      switchMap(({ signal, automation }) => {
        i(
          `Executing automation ${automation.fileName} (${automation.hash}), triggered by signal ID ${signal.id} (${signal.type})`
        )

        return from(
          runExecutionForAutomation(this, automation, signal.id)
        ).pipe(
          tap(() =>
            i(
              `Finished execution for automation ${automation.fileName} (${automation.hash})`
            )
          )
        )
      }),
      share() // Share the execution result
    )
  }

  start() {
    i('Starting automation runtime event processing')
    const subscription = this.automationExecuted.subscribe({
      error: (err) => e('Error in automation execution pipeline:', err),
      complete: () => d('Automation execution pipeline completed'),
    })
    d('Automation execution pipeline subscribed')
    return subscription
  }

  private async handlersForDatabaseSignals(): Promise<SignalHandler[]> {
    const signalHandlers: SignalHandler[] = []

    i('Loading signals from database')
    const signals = await this.db
      .selectFrom('signals')
      .selectAll()
      .where('isDead', '!=', true)
      .execute()

    i(`Loaded ${signals.length} signals from database`)

    for (const signal of signals) {
      d(
        'Processing signal ID: %s, Type: %s, Hash: %s',
        signal.id,
        signal.type,
        signal.automationHash
      )
      const automation = this.automationList.find(
        (x) => x.hash === signal.automationHash
      )

      if (!automation) {
        i(
          `Automation hash ${signal.automationHash} from signal ID ${signal.id} not found in current automation list. Deleting signal.`
        )

        // NB: it could be the case that even though a particular automation no
        // longer exists, an automation log still references it. In order to not
        // break that, we mark it dead instead.
        await this.db
          .updateTable('signals')
          .where('id', '=', signal.id) // Use ID for deletion
          .set({ isDead: true })
          .execute()

        i(
          `Deleted orphaned signal ID: ${signal.id} (automation hash ${signal.automationHash} not found)`
        )

        continue
      }

      d(
        'Found matching automation %s (%s) for signal ID %s',
        automation.hash,
        automation.fileName,
        signal.id
      )

      try {
        switch (signal.type) {
          case 'cron':
            d('Creating CronSignalHandler for signal ID %s', signal.id)
            signalHandlers.push(new CronSignalHandler(signal, automation))
            break
          case 'offset':
            d('Creating RelativeTimeSignalHandler for signal ID %s', signal.id)
            signalHandlers.push(
              new RelativeTimeSignalHandler(signal, automation)
            )
            break
          case 'time':
            d('Creating AbsoluteTimeSignalHandler for signal ID %s', signal.id)
            signalHandlers.push(
              new AbsoluteTimeSignalHandler(signal, automation)
            )
            break
          case 'state':
            d('Creating StateRegexSignalHandler for signal ID %s', signal.id)
            try {
              signalHandlers.push(
                new StateRegexSignalHandler(signal, automation, this)
              )
            } catch (error) {
              e(
                `Error creating StateRegexSignal handler for signal ID ${signal.id}:`,
                error
              )
            }
            break
          default:
            i(
              `Unknown signal type '${signal.type}' for signal ID ${signal.id}. Skipping.`
            )
        }
      } catch (err) {
        e(
          'Error creating trigger handler for signal %s, type %s: %o',
          signal.id,
          signal.type,
          err
        )
        // Optionally, delete the problematic signal or handle the error differently
      }
    }

    i(
      `Finished processing signals. Active trigger handlers: ${signalHandlers.length}`
    )
    return signalHandlers
  }
}

export function getAutomationDirectory(runtime: AutomationRuntime) {
  if (!runtime.notebookDirectory) {
    throw new Error('Automation directory is not set')
  }

  const ret = path.join(runtime.notebookDirectory, 'automations')
  if (!existsSync(ret)) {
    mkdirSync(ret, { recursive: true })
  }

  return ret
}

export function getMemoryFile(runtime: AutomationRuntime) {
  if (!runtime.notebookDirectory) {
    throw new Error('Automation directory is not set')
  }

  const ret = path.join(runtime.notebookDirectory, 'memory.md')
  if (!existsSync(ret)) {
    writeFileSync(ret, '', 'utf-8')
  }

  return ret
}
