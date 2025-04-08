import { Cron, parseCronExpression } from 'cron-schedule'
import { TimerBasedCronScheduler as scheduler } from 'cron-schedule/schedulers/timer-based.js'
import { NEVER, Observable, filter, map, share, timer } from 'rxjs'

import {
  AbsoluteTimeSignal,
  Automation,
  CronSignal,
  RelativeTimeSignal,
  SignalHandlerInfo,
  StateRegexSignal,
} from '../../shared/types'
import { Signal } from '../db-schema'
import { HassState, observeStatesForEntities } from '../lib/ha-ws-api'
import { i } from '../logging'
import { AutomationRuntime, SignalledAutomation, d } from './automation-runtime'

export interface SignalHandler extends SignalHandlerInfo {
  readonly signal: Signal
  readonly signalObservable: Observable<SignalledAutomation>
}

export class CronSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const data: CronSignal = JSON.parse(signal.data)
    let cron: Cron | null = null // Declare outside try

    this.isValid = false // Default to invalid
    this.friendlySignalDescription = 'Invalid cron expression'

    try {
      cron = parseCronExpression(data.cron) // Assign inside try
      this.friendlySignalDescription = cron
        .getNextDate(new Date())
        .toLocaleString()
      this.isValid = true // Set to valid only if parsing and date calculation succeed

      d(
        'CronSignalHandler created for signal %s, automation %s. Cron: %s',
        signal.id,
        automation.hash,
        data.cron
      )
    } catch (error) {
      i(
        `Invalid cron expression "${data.cron}" for signal ${signal.id}:`,
        error
      )
      // isValid remains false, description remains 'Invalid cron expression'
    }

    // Create trigger only if cron is valid
    if (this.isValid && cron) {
      this.signalObservable = this.cronToObservable(cron).pipe(
        map(() => {
          d(
            'Cron trigger fired for signal %s, automation %s',
            this.signal.id,
            this.automation.hash
          )
          return { signal: this.signal, automation: this.automation }
        })
      )
    } else {
      this.signalObservable = NEVER // Don't schedule if invalid
      d(
        'Cron expression %s is invalid or parsing failed, not scheduling trigger for signal %s',
        data.cron,
        signal.id
      )
    }
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
export class RelativeTimeSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const relativeTimeData: RelativeTimeSignal = JSON.parse(signal.data)
    const offsetInSeconds = relativeTimeData.offsetInSeconds
    const fireTime = new Date(Date.now() + offsetInSeconds * 1000)

    this.isValid = true
    this.friendlySignalDescription = fireTime.toLocaleString()

    d(
      'RelativeTimeSignalHandler created for signal %s, automation %s. Offset: %d seconds',
      signal.id,
      automation.hash,
      offsetInSeconds
    )

    this.signalObservable = timer(offsetInSeconds * 1000).pipe(
      map(() => {
        i(
          `Relative time trigger fired for signal ${this.signal.id}, automation ${this.automation.hash} (offset: ${offsetInSeconds}s)`
        )
        return { signal: this.signal, automation: this.automation }
      })
    )
  }
}
export class AbsoluteTimeSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation
  ) {
    const absoluteTimeData: AbsoluteTimeSignal = JSON.parse(signal.data)
    const targetTime = new Date(absoluteTimeData.iso8601Time).getTime()
    const currentTime = Date.now()
    const timeUntilTarget = targetTime - currentTime

    this.isValid = true
    this.friendlySignalDescription = new Date(targetTime).toLocaleString()

    d(
      'AbsoluteTimeSignalHandler created for signal %s, automation %s. Target time: %s',
      signal.id,
      automation.hash,
      absoluteTimeData.iso8601Time
    )

    // Only schedule if the time is in the future
    if (timeUntilTarget > 0) {
      this.isValid = true
      i(
        `Scheduling absolute time trigger for signal ${signal.id} at ${this.friendlySignalDescription} (in ${timeUntilTarget} ms)`
      )
      this.signalObservable = timer(timeUntilTarget).pipe(
        map(() => {
          i(
            `Absolute time trigger fired for signal ${this.signal.id}, automation ${this.automation.hash} at ${absoluteTimeData.iso8601Time}`
          )
          return { signal: this.signal, automation: this.automation }
        })
      )
    } else {
      this.isValid = false
      i(
        `Skipping past-due absolute time trigger for signal ${signal.id}: Target time ${absoluteTimeData.iso8601Time} is in the past.`
      )
      this.signalObservable = NEVER
      this.friendlySignalDescription += ' (Past due)'
    }
  }
}
export class StateRegexSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation,
    private readonly runtime: AutomationRuntime
  ) {
    const stateData: StateRegexSignal = JSON.parse(signal.data)
    let regex: RegExp | null = null

    this.isValid = false // Default to invalid
    this.friendlySignalDescription = `Invalid state regex trigger for entities: ${stateData.entityIds.join(', ')}`

    try {
      regex = new RegExp(stateData.regex, 'i') // Case-insensitive match
      this.isValid = true
      this.friendlySignalDescription = `State match on [${stateData.entityIds.join(', ')}] for regex /${stateData.regex}/i`

      d(
        'StateRegexSignalHandler created for signal %s, automation %s. Entities: %o, Regex: /%s/i',
        signal.id,
        automation.hash,
        stateData.entityIds,
        stateData.regex
      )
    } catch (error) {
      i(
        `Invalid state regex "/${stateData.regex}/i" for signal ID ${signal.id}:`,
        error
      )
      // isValid remains false, description remains the default error message
      this.signalObservable = NEVER
      return // Don't proceed if regex is invalid
    }

    // Only create the observable if the regex is valid
    this.signalObservable = observeStatesForEntities(
      this.runtime.api,
      stateData.entityIds
    ).pipe(
      filter((state: HassState | undefined | null): state is HassState => {
        if (!state) {
          return false // Skip null/undefined states
        }

        const match = regex.test(state.state) // Use the compiled regex (isValid check ensures regex is non-null)
        return match
      }),
      map((matchedState: HassState) => {
        i(
          `State regex trigger fired for signal ${this.signal.id}, automation ${this.automation.hash}. Matched entity: ${matchedState.entity_id}, State: "${matchedState.state}"`
        )
        return { signal: this.signal, automation: this.automation }
      }),
      share()
    )
  }
}
