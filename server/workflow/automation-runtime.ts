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

const d = debug('b:automation')

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
    d(
      'Initializing LiveAutomationRuntime with directory: %s',
      automationDirectory
    )

    this.reparseAutomations = this.automationDirectory
      ? merge(
          of(), // Start on initial subscribe
          createBufferedDirectoryMonitor(
            {
              path: this.automationDirectory,
              recursive: true,
            },
            2000
          ).pipe(
            tap(() =>
              d(
                'Detected change in automation directory: %s',
                this.automationDirectory
              )
            ),
            map(() => {})
          )
        )
      : NEVER

    this.scannedAutomationDir = this.automationDirectory
      ? defer(() => this.reparseAutomations).pipe(
          switchMap(() => {
            d(
              'Reparsing automations from directory: %s',
              this.automationDirectory
            )
            return from(
              parseAllAutomations(this.automationDirectory!).then(
                (automations) => {
                  d('Parsed %d automations', automations.length)
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
        d('Rescheduling automations, count: %d', automations.length)
        return from(rescheduleAutomations(this, automations)).pipe(
          tap(() => d('Finished rescheduling automations'))
        )
      }),
      share() // Share the result of rescheduling
    )

    this.signalFired = defer(() => this.createdSignalsForForAutomations).pipe(
      switchMap(() => {
        d('Setting up triggers based on database signals')
        return from(this.handlersForDatabaseSignals())
      }),
      tap({
        next: (handlers) => {
          d('Created %d trigger handlers', handlers.length)
          this.scheduledTriggers = handlers
        },
      }),
      switchMap((handlers) => {
        d('Merging %d trigger observables', handlers.length)
        if (handlers.length === 0) {
          return NEVER
        }
        return merge(...handlers.map((handler) => handler.trigger))
      }),
      tap(({ signal, automation }) =>
        d(
          'Signal fired for automation %s (%s), signal type: %s, signal ID: %s',
          automation.hash,
          automation.fileName,
          signal.type,
          signal.id
        )
      ),
      share() // Share the fired signals
    )

    this.automationExecuted = defer(() => this.signalFired).pipe(
      switchMap(({ signal, automation }) => {
        d(
          'Executing automation %s (%s), triggered by signal %s (ID: %s)',
          automation.hash,
          automation.fileName,
          signal.type,
          signal.id
        )
        return from(
          runExecutionForAutomation(this, automation, signal.id)
        ).pipe(
          tap(() => d('Finished execution for automation %s', automation.hash))
        )
      }),
      share() // Share the execution result
    )
  }

  start() {
    d('Starting LiveAutomationRuntime event subscription')
    const subscription = this.automationExecuted.subscribe({
      error: (err) => d('Error in automation execution pipeline: %o', err),
      complete: () => d('Automation execution pipeline completed'),
    })
    d('Automation execution pipeline subscribed')
    return subscription
  }

  private async handlersForDatabaseSignals(): Promise<TriggerHandler[]> {
    const triggerHandlers: TriggerHandler[] = []

    d('Loading signals from database')
    const signals = await this.db.selectFrom('signals').selectAll().execute()
    d('Loaded %d signals from database', signals.length)

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
        d(
          'Automation hash %s from signal ID %s not found in current automation list. Deleting signal.',
          signal.automationHash,
          signal.id
        )

        await this.db
          .deleteFrom('signals')
          .where('id', '=', signal.id) // Use ID for deletion
          .execute()
        d('Deleted signal ID: %s', signal.id)

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
            d('Creating CronTriggerHandler for signal ID %s', signal.id)
            triggerHandlers.push(new CronTriggerHandler(signal, automation))
            break
          case 'offset':
            d('Creating RelativeTimeTriggerHandler for signal ID %s', signal.id)
            triggerHandlers.push(
              new RelativeTimeTriggerHandler(signal, automation)
            )
            break
          case 'time':
            d('Creating AbsoluteTimeTriggerHandler for signal ID %s', signal.id)
            triggerHandlers.push(
              new AbsoluteTimeTriggerHandler(signal, automation)
            )
            break
          default:
            d(
              'Unknown signal type %s for signal ID %s. Skipping.',
              signal.type,
              signal.id
            )
        }
      } catch (error) {
        d(
          'Error creating trigger handler for signal ID %s: %o',
          signal.id,
          error
        )
        // Optionally, delete the problematic signal or handle the error differently
      }
    }

    d(
      'Finished processing signals. Created %d trigger handlers.',
      triggerHandlers.length
    )
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
    d(
      'CronTriggerHandler created for signal %s, automation %s. Cron: %s',
      signal.id,
      automation.hash,
      data.cron
    )
    this.trigger = this.cronToObservable(cron).pipe(
      map(() => {
        d(
          'Cron trigger fired for signal %s, automation %s',
          this.signal.id,
          this.automation.hash
        )
        return { signal: this.signal, automation: this.automation }
      })
    )
  }

  cronToObservable(cron: Cron): Observable<void> {
    d('Setting up cron interval for: %o', cron)
    return new Observable<void>((subj) => {
      const task = () => {
        d('Cron task executing for signal %s', this.signal.id)
        subj.next()
      }
      const handle = scheduler.setInterval(cron, task)
      d('Cron interval scheduled with handle %o', handle)

      return () => {
        d('Clearing cron interval with handle %o', handle)
        scheduler.clearTimeoutOrInterval(handle)
      }
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
    d(
      'RelativeTimeTriggerHandler created for signal %s, automation %s. Offset: %d seconds',
      signal.id,
      automation.hash,
      offsetInSeconds
    )

    this.trigger = timer(offsetInSeconds * 1000).pipe(
      map(() => {
        d(
          'Relative time trigger fired for signal %s, automation %s after %d seconds',
          this.signal.id,
          this.automation.hash,
          offsetInSeconds
        )
        return { signal: this.signal, automation: this.automation }
      })
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
    d(
      'AbsoluteTimeTriggerHandler created for signal %s, automation %s. Target time: %s',
      signal.id,
      automation.hash,
      absoluteTimeData.iso8601Time
    )

    // Only schedule if the time is in the future
    if (timeUntilTarget > 0) {
      d(
        'Scheduling absolute time trigger for signal %s in %d ms',
        signal.id,
        timeUntilTarget
      )
      this.trigger = timer(timeUntilTarget).pipe(
        map(() => {
          d(
            'Absolute time trigger fired for signal %s, automation %s at %s',
            this.signal.id,
            this.automation.hash,
            absoluteTimeData.iso8601Time
          )
          return { signal: this.signal, automation: this.automation }
        })
      )
    } else {
      d(
        'Skipping past-due absolute time trigger for signal %s: Target time %s is in the past.',
        signal.id,
        absoluteTimeData.iso8601Time
      )
      this.trigger = NEVER
    }
  }
}
