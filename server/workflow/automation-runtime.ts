import { Kysely } from 'kysely'
import { Schema, Signal } from '../db-schema'
import { LargeLanguageProvider } from '../llm'
import { HomeAssistantApi } from '../lib/ha-ws-api'
import { parseAllAutomations } from './parser'
import {
  Automation,
  CronTrigger,
  RelativeTimeTrigger,
  AbsoluteTimeTrigger,
} from '../../shared/types'
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
  tap,
  timer,
} from 'rxjs'
import { createBufferedDirectoryMonitor } from '../lib/directory-monitor'
import { rescheduleAutomations } from './scheduler-step'
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
  scheduledTriggers: TriggerHandler[]

  reparseAutomations: Observable<void>
  scannedAutomationDir: Observable<Automation[]>
  createdSignalsForForAutomations: Observable<void>
  signalFired: Observable<SignalledAutomation>
  automationExecuted: Observable<void>
}

export class LiveAutomationRuntime implements AutomationRuntime {
  automationList: Automation[]
  scheduledTriggers: TriggerHandler[]

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
    this.scheduledTriggers = []

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
      switchMap(() => from(this.handlersForDatabaseSignals())),
      tap({ next: (x) => (this.scheduledTriggers = x) }),
      switchMap((xs) => merge(...xs.map((x) => x.trigger)))
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

  private async handlersForDatabaseSignals(): Promise<TriggerHandler[]> {
    const triggerHandlers: TriggerHandler[] = []

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
          triggerHandlers.push(new CronTriggerHandler(signal, automation))
          break
        case 'offset':
          d(
            'Creating relative time trigger for automation %s',
            signal.automationHash
          )
          triggerHandlers.push(
            new RelativeTimeTriggerHandler(signal, automation)
          )
          break
        case 'time':
          d(
            'Creating absolute time trigger for automation %s',
            signal.automationHash
          )
          triggerHandlers.push(
            new AbsoluteTimeTriggerHandler(signal, automation)
          )
          break
      }
    }

    return triggerHandlers
  }
}

interface TriggerHandler {
  readonly signal: Signal
  readonly automation: Automation
  readonly trigger: Observable<SignalledAutomation>
}

class CronTriggerHandler implements TriggerHandler {
  readonly trigger: Observable<SignalledAutomation>

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const data: CronTrigger = JSON.parse(signal.data)
    const cron = parseCronExpression(data.cron)
    this.trigger = this.cronToObservable(cron).pipe(
      map(() => ({ signal: this.signal, automation: this.automation }))
    )
  }

  cronToObservable(cron: Cron): Observable<void> {
    return new Observable<void>((subj) => {
      const handle = scheduler.setInterval(cron, () => {
        subj.next()
      })

      return () => scheduler.clearTimeoutOrInterval(handle)
    }).pipe(share())
  }
}

class RelativeTimeTriggerHandler implements TriggerHandler {
  readonly trigger: Observable<SignalledAutomation>

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const relativeTimeData: RelativeTimeTrigger = JSON.parse(signal.data)
    const offsetInSeconds = relativeTimeData.offsetInSeconds

    this.trigger = timer(offsetInSeconds * 1000).pipe(
      map(() => ({ signal: this.signal, automation: this.automation }))
    )
  }
}

class AbsoluteTimeTriggerHandler implements TriggerHandler {
  readonly trigger: Observable<SignalledAutomation>

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const absoluteTimeData: AbsoluteTimeTrigger = JSON.parse(signal.data)
    const targetTime = new Date(absoluteTimeData.iso8601Time).getTime()
    const currentTime = Date.now()
    const timeUntilTarget = targetTime - currentTime

    // Only schedule if the time is in the future
    if (timeUntilTarget > 0) {
      this.trigger = timer(timeUntilTarget).pipe(
        map(() => ({ signal: this.signal, automation: this.automation }))
      )
    } else {
      d(
        'Skipping past-due absolute time trigger: %s',
        absoluteTimeData.iso8601Time
      )
      this.trigger = NEVER
    }
  }
}
