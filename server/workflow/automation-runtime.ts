import debug from 'debug'
import { Kysely } from 'kysely'
import { DateTime } from 'luxon'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  AsyncSubject,
  NEVER,
  Observable,
  Subject,
  SubscriptionLike,
  defer,
  from,
  map,
  merge,
  share,
  startWith,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs'

import { SerialSubscription } from '../../shared/serial-subscription'
import { Automation } from '../../shared/types'
import { AppConfig } from '../../shared/types'
import { saveConfig } from '../config'
import { createDatabaseViaEnv } from '../db'
import { Schema, Signal } from '../db-schema'
import { createBufferedDirectoryMonitor } from '../lib/directory-monitor'
import { HomeAssistantApi, LiveHomeAssistantApi } from '../lib/ha-ws-api'
import { LargeLanguageProvider, createDefaultLLMProvider } from '../llm'
import { e, i, w } from '../logging'
import { getConfigFilePath, isProdMode } from '../paths'
import { runExecutionForAutomation } from './execution-step'
import { parseAllAutomations, serializeAutomations } from './parser'
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

export interface AutomationRuntime extends SubscriptionLike {
  readonly api: HomeAssistantApi
  readonly llmFactory: () => LargeLanguageProvider
  readonly db: Kysely<Schema>
  readonly timezone: string // "America/Los_Angeles" etc
  readonly notebookDirectory: string | undefined

  automationList: Automation[]
  cueList: Automation[]
  scheduledSignals: SignalHandler[]

  reparseAutomations: Observable<string>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>
  shouldRestart: Observable<void>

  saveConfigAndClose(config: AppConfig): Promise<void>
}

export class LiveAutomationRuntime
  implements AutomationRuntime, SubscriptionLike
{
  automationList: Automation[]
  cueList: Automation[]
  scheduledSignals: SignalHandler[]
  notebookDirectory: string | undefined

  reparseAutomations: Observable<string>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>
  shouldRestart: Subject<void> = new AsyncSubject()

  pipelineSub = new SerialSubscription()

  static async createViaConfig(
    config: AppConfig,
    api?: HomeAssistantApi,
    notebookDirectory?: string
  ) {
    const db = await createDatabaseViaEnv()

    return new LiveAutomationRuntime(
      api ?? (await LiveHomeAssistantApi.createViaConfig(config)),
      () => createDefaultLLMProvider(config),
      db,
      config.timezone ?? 'Etc/UTC',
      notebookDirectory
    )
  }

  constructor(
    readonly api: HomeAssistantApi,
    readonly llmFactory: () => LargeLanguageProvider,
    readonly db: Kysely<Schema>,
    readonly timezone: string,
    notebookDirectory?: string
  ) {
    this.automationList = []
    this.cueList = []
    this.scheduledSignals = []
    this.notebookDirectory = notebookDirectory

    const watchedDirectories = () =>
      [getAutomationDirectory(this), getCueDirectory(this)].map((dir) =>
        createBufferedDirectoryMonitor(
          {
            path: dir,
            recursive: true,
          },
          10 * 1000
        ).pipe(
          map(() => {
            i(`Detected change in automation directory: ${dir}`)
            return dir
          })
        )
      )

    this.reparseAutomations = this.notebookDirectory
      ? defer(() => merge(...watchedDirectories())).pipe(
          throttleTime(30 * 1000)
        )
      : NEVER

    if (isProdMode) {
      // Kick off a scan on startup
      this.reparseAutomations = this.reparseAutomations.pipe(
        startWith(getAutomationDirectory(this), getCueDirectory(this))
      )
    } else {
      console.error(
        'Running in dev mode, skipping initial automations folder scan. Change a file to kick it off'
      )
    }

    this.scannedAutomationDir = this.notebookDirectory
      ? defer(() => this.reparseAutomations).pipe(
          switchMap((dir) => {
            const isCue = dir.startsWith(getCueDirectory(this))
            const rootDir = isCue
              ? getCueDirectory(this)
              : getAutomationDirectory(this)
            i(`Reparsing automations from directory: ${this.notebookDirectory}`)

            return from(
              parseAllAutomations(path.resolve(rootDir)).then((automations) => {
                i(`Parsed ${automations.length} automations`)

                if (isCue) {
                  automations.forEach((x) => (x.isCue = true))
                  this.cueList = automations
                } else {
                  this.automationList = automations
                }

                return automations
              })
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
      switchMap((handlers) => {
        i(`Created ${handlers.length} Signal handlers from database`)
        this.scheduledSignals = handlers

        if (handlers.length === 0) {
          return NEVER
        }
        return merge(...handlers.map((handler) => handler.signalObservable))
      }),
      share()
    )

    this.automationExecuted = defer(() => this.signalFired).pipe(
      switchMap(({ signal, automation }) => {
        i(
          `Executing automation ${automation.fileName} (${automation.hash}), triggered by signal ID ${signal.id} (${signal.type})`
        )

        return from(
          runExecutionForAutomation(this, automation, signal.id).then(() => {
            i(
              `Finished execution for automation ${automation.fileName} (${automation.hash})`
            )

            if (automation.isCue && this.notebookDirectory) {
              i(`Removing automation ${automation.hash} because it is a Cue`)
              return this.removeCue(automation)
            }
          })
        )
      }),
      share() // Share the execution result
    )
  }

  start() {
    i('Starting automation runtime event processing')

    this.pipelineSub.current = this.automationExecuted.subscribe({
      error: (err) =>
        e(
          'Error in automation execution pipeline, this should never happen!',
          err
        ),
    })

    return this.pipelineSub
  }

  async removeCue(automation: Automation): Promise<void> {
    const file = this.cueList.find((x) => automation.hash === x.hash)?.fileName

    const toWrite = this.cueList.filter(
      (x) => x.fileName === automation.fileName && x.hash !== automation.hash
    )

    // NB: This is a bit Weird because it is possible (likely even!) that we
    // will go from one automation => zero automations for a file. When that
    // happens, we'll just delete it rather than leaving a weird file
    if (toWrite.length > 0) {
      await serializeAutomations(toWrite)
    } else {
      w(`Cue file ${file} is empty, deleting!`)
      await unlink(file!)
    }
  }

  async saveConfigAndClose(config: AppConfig): Promise<void> {
    i('Saving new configuration and restarting')
    await saveConfig(config, getConfigFilePath(this.notebookDirectory!))

    this.shouldRestart.next(undefined)
    this.shouldRestart.complete()
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

      const automation = this.automationList
        .concat(this.cueList)
        .find((x) => x.hash === signal.automationHash)

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
            signalHandlers.push(
              new CronSignalHandler(signal, automation, this.timezone)
            )
            break
          case 'offset':
            d('Creating RelativeTimeSignalHandler for signal ID %s', signal.id)
            signalHandlers.push(
              new RelativeTimeSignalHandler(signal, automation, this.timezone)
            )
            break
          case 'time':
            d('Creating AbsoluteTimeSignalHandler for signal ID %s', signal.id)
            signalHandlers.push(
              new AbsoluteTimeSignalHandler(signal, automation, this.timezone)
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
      }
    }

    i(
      `Finished processing signals. Active trigger handlers: ${signalHandlers.length}`
    )
    return signalHandlers
  }

  closed: boolean = false
  unsubscribe(): void {
    if (this.closed) return
    this.closed = true

    void this.db.destroy()
    this.pipelineSub.unsubscribe()
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

export function getCueDirectory(runtime: AutomationRuntime) {
  if (!runtime.notebookDirectory) {
    throw new Error('Automation directory is not set')
  }

  const ret = path.join(runtime.notebookDirectory, 'cues')
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

export function now(runtime: AutomationRuntime): DateTime {
  const timezone = runtime.timezone || 'Etc/UTC'
  return DateTime.now().setZone(timezone)
}
