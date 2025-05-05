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
  map,
  merge,
  mergeMap,
  switchMap,
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
import {
  LargeLanguageProvider,
  ModelSpecifier,
  createDefaultLLMProvider,
} from '../llm'
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
  readonly llmFactory: (modelSpec: ModelSpecifier) => LargeLanguageProvider
  readonly db: Kysely<Schema>
  readonly timezone: string // "America/Los_Angeles" etc
  readonly notebookDirectory: string | undefined

  automationList: Automation[]
  cueList: Automation[]
  scheduledSignals: SignalHandler[]

  reparseAutomations: Observable<void>
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

  reparseAutomations: Subject<void> = new Subject()
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
      (modelSpec: ModelSpecifier) =>
        createDefaultLLMProvider(config, modelSpec),
      db,
      config.timezone ?? 'Etc/UTC',
      notebookDirectory
    )
  }

  constructor(
    readonly api: HomeAssistantApi,
    readonly llmFactory: (modelSpec: ModelSpecifier) => LargeLanguageProvider,
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
            return undefined
          })
        )
      )

    const dirChanged = this.notebookDirectory
      ? defer(() => merge(...watchedDirectories())).pipe(
          throttleTime(30 * 1000)
        )
      : NEVER

    dirChanged.subscribe(() => {
      i('Directory changed! Re-reading automations')
      this.reparseAutomations.next(undefined)
    })
  }

  async reloadAutomations() {
    const toRead: [string, boolean][] = [
      [getCueDirectory(this), true],
      [getAutomationDirectory(this), false],
    ]

    for (const [dir, isCue] of toRead) {
      i(`Reparsing automations from directory: ${dir}`)

      const automations = await parseAllAutomations(dir)
      automations.forEach((x) => (x.isCue = isCue))

      if (isCue) {
        this.cueList = automations
      } else {
        this.automationList = automations
      }

      i(`Scheduling triggers for ${automations.length} automations`)
      await rescheduleAutomations(this, automations)
    }

    d('Setting up Signals based on database')
    this.scheduledSignals = await this.handlersForDatabaseSignals()

    i(`Created ${this.scheduledSignals.length} Signal handlers from database`)
    if (this.scheduledSignals.length < 1) {
      return NEVER
    } else {
      return merge(
        ...this.scheduledSignals.map((handler) => handler.signalObservable)
      )
    }
  }

  start() {
    i('Starting automation runtime event processing')

    this.pipelineSub.current = this.reparseAutomations
      .pipe(
        switchMap(async () => {
          const ret = await this.reloadAutomations()
          return ret
        }),
        switchMap((x) => x),
        mergeMap(async ({ automation, signal }) => {
          i(
            `Executing automation ${automation.fileName} (${automation.hash}), triggered by signal ID ${signal.id} (${signal.type})`
          )

          await runExecutionForAutomation(this, automation, signal.id)

          i(
            `Finished execution for automation ${automation.fileName} (${automation.hash})`
          )

          if (automation.isCue && this.notebookDirectory) {
            i(`Removing automation ${automation.hash} because it is a Cue`)
            await this.removeCue(automation)
          }
        })
      )
      .subscribe({
        error: (err) =>
          e(
            'Error in automation execution pipeline, this should never happen!',
            err
          ),
      })

    if (isProdMode) {
      // Kick off a scan on startup
      this.reparseAutomations.next(undefined)
    } else {
      console.error(
        'Running in dev mode, skipping initial automations folder scan. Change a file to kick it off'
      )
    }

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
