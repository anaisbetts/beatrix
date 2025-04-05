import { Kysely } from 'kysely'
import { Schema, Signal } from '../db-schema'
import { LargeLanguageProvider } from '../llm'
import { HomeAssistantApi } from '../lib/ha-ws-api'
import { parseAllAutomations } from './parser'
import { Automation } from '../../shared/types'
import {
  defer,
  from,
  map,
  merge,
  NEVER,
  Observable,
  of,
  share,
  switchMap,
} from 'rxjs'
import { createBufferedDirectoryMonitor } from '../lib/directory-monitor'
import { rescheduleAutomations } from './scheduler-step'
import { CronTrigger } from '../mcp/scheduler'
import { Cron, parseCronExpression } from 'cron-schedule'
import { TimerBasedCronScheduler as scheduler } from 'cron-schedule/schedulers/timer-based.js'
import debug from 'debug'
import { runExecutionForAutomation } from './execution-step'

const d = debug('ha:service')

interface SignalledAutomation {
  signal: Signal
  automation: Automation
}

export interface AutomationRuntime {
  readonly api: HomeAssistantApi
  readonly llm: LargeLanguageProvider
  readonly db: Kysely<Schema>

  automationList: Automation[]

  reparseAutomations: Observable<void>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>
}

export class LiveAutomationRuntime implements AutomationRuntime {
  automationList: Automation[]

  reparseAutomations: Observable<void>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>

  constructor(
    readonly api: HomeAssistantApi,
    readonly llm: LargeLanguageProvider,
    readonly db: Kysely<Schema>,
    private readonly automationDirectory?: string
  ) {
    this.automationList = []
    this.reparseAutomations = this.automationDirectory
      ? merge(
          of(), // Start on initial subscribe
          createBufferedDirectoryMonitor(
            {
              path: this.automationDirectory,
              recursive: true,
            },
            2000
          ).pipe(map(() => {}))
        )
      : NEVER

    this.scannedAutomationDir = this.automationDirectory
      ? defer(() => this.reparseAutomations).pipe(
          switchMap(() => {
            d('Reparsing automations...')

            return from(
              parseAllAutomations(this.automationDirectory!).then(
                (x) => (this.automationList = x)
              )
            )
          })
        )
      : NEVER

    this.createdSignalsForForAutomations = defer(
      () => this.scannedAutomationDir
    ).pipe(
      switchMap((automations) => {
        d('Rescheduling automations...')

        return from(rescheduleAutomations(this, automations))
      })
    )

    this.signalFired = defer(() => this.createdSignalsForForAutomations).pipe(
      switchMap(() => from(this.observableForDatabaseSignals())),
      switchMap((x) => x)
    )

    this.automationExecuted = defer(() => this.signalFired).pipe(
      switchMap(({ signal, automation }) => {
        d(
          'Executing automation %s (%s), because %s',
          automation.hash,
          automation.fileName,
          signal.type
        )

        return from(runExecutionForAutomation(this, automation, signal.id))
      })
    )
  }

  start() {
    return this.automationExecuted.subscribe()
  }

  private async observableForDatabaseSignals() {
    const observableList: Observable<SignalledAutomation>[] = []

    d('Loading signals from database')
    const signals = await this.db.selectFrom('signals').selectAll().execute()

    for (const signal of signals) {
      const automation = this.automationList.find(
        (x) => x.hash === signal.automationHash
      )

      if (!automation) {
        d(
          'Found automation hash %s but not in our list? Deleting',
          signal.automationHash
        )

        await this.db
          .deleteFrom('signals')
          .where('automationHash', '=', signal.automationHash)
          .execute()

        continue
      }

      switch (signal.type) {
        case 'cron':
          d('Creating trigger for automation %s', signal.automationHash)

          const data: CronTrigger = JSON.parse(signal.data)
          const cron = parseCronExpression(data.cron)
          observableList.push(
            cronToObservable(cron).pipe(map(() => ({ signal, automation })))
          )
          break
      }
    }

    return merge(...observableList)
  }
}

function cronToObservable(cron: Cron): Observable<void> {
  return new Observable<void>((subj) => {
    const handle = scheduler.setInterval(cron, () => {
      subj.next()
    })

    return () => scheduler.clearTimeoutOrInterval(handle)
  }).pipe(share())
}
