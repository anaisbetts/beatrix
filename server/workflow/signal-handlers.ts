import { CronExpression, CronExpressionParser } from 'cron-parser'
import { DateTime } from 'luxon'
import {
  NEVER,
  Observable,
  defer,
  distinctUntilChanged,
  filter,
  map,
  of,
  repeat,
  share,
  switchMap,
  takeWhile,
  timer,
} from 'rxjs'

import {
  AbsoluteTimeSignal,
  Automation,
  CronSignal,
  RelativeTimeSignal,
  SignalHandlerInfo,
  StateRangeSignal,
  StateRegexSignal,
} from '../../shared/types'
import { guaranteedThrottle } from '../../shared/utility'
import { Signal } from '../db-schema'
import { observeStatesForEntities } from '../lib/ha-ws-api'
import { i } from '../logging'
import { AutomationRuntime, SignalledAutomation, d } from './automation-runtime'

export interface SignalHandler extends SignalHandlerInfo {
  readonly signal: Signal
  readonly signalObservable: Observable<SignalledAutomation>
}

export class CronSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation,
    timezone: string
  ) {
    const data: CronSignal = JSON.parse(signal.data)

    this.isValid = false // Default to invalid
    this.friendlySignalDescription = 'Invalid cron expression'

    const currentTime = DateTime.now().setZone(timezone)
    try {
      const cron = CronExpressionParser.parse(data.cron, {
        tz: timezone,
        currentDate: currentTime.toJSDate(),
      }) // Assign inside try

      this.friendlySignalDescription = DateTime.fromISO(
        cron.next().toISOString()!
      ).toLocaleString(DateTime.DATETIME_MED)

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
    }

    const cron = CronExpressionParser.parse(data.cron, {
      tz: timezone,
      currentDate: currentTime.toJSDate(),
    })

    if (this.isValid) {
      this.signalObservable = this.cronToObservable(cron).pipe(
        map(() => {
          d(
            'Cron trigger fired for signal %s, automation %s',
            this.signal.id,
            this.automation.hash
          )

          if (cron.hasNext()) {
            this.friendlySignalDescription = DateTime.fromISO(
              cron.next().toISOString()!
            ).toLocaleString(DateTime.DATETIME_MED)

            cron.prev()
          } else {
            this.friendlySignalDescription = '(Does not fire again)'
          }

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

  cronToObservable(cron: CronExpression): Observable<void> {
    d('Setting up cron interval for: %o', cron)

    return defer(() => of(cron.next())).pipe(
      switchMap((n) => timer(n.toDate())),
      map(() => {}),
      takeWhile(() => cron.hasNext()),
      repeat(),
      share()
    )
  }
}

export class RelativeTimeSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation,
    timezone: string
  ) {
    const relativeTimeData: RelativeTimeSignal = JSON.parse(signal.data)
    const fireTime = DateTime.now().setZone(timezone).plus({
      seconds: relativeTimeData.offsetInSeconds,
    })

    this.isValid = true
    this.friendlySignalDescription = fireTime.toLocaleString(
      DateTime.DATETIME_SHORT_WITH_SECONDS
    )

    d(
      'RelativeTimeSignalHandler created for signal %s, automation %s. Offset: %d seconds',
      signal.id,
      automation.hash,
      relativeTimeData.offsetInSeconds
    )

    this.signalObservable = timer(relativeTimeData.offsetInSeconds * 1000).pipe(
      map(() => {
        i(
          `Relative time trigger fired for signal ${this.signal.id}, automation ${this.automation.hash} (offset: ${relativeTimeData.offsetInSeconds}s)`
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
    public readonly automation: Automation,
    timezone: string
  ) {
    const absoluteTimeData: AbsoluteTimeSignal = JSON.parse(signal.data)
    const targetTime = new Date(absoluteTimeData.iso8601Time).getTime()
    const currentTime = Date.now()
    const timeUntilTarget = targetTime - currentTime

    this.isValid = true
    this.friendlySignalDescription = DateTime.now()
      .setZone(timezone)
      .plus({ millisecond: timeUntilTarget })
      .toLocaleString()

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
      stateData.entityIds,
      false
    ).pipe(
      map((state) => {
        let match = state ? regex.test(state.state) : false
        return { state, match }
      }),
      filter(({ match }) => match),
      distinctUntilChanged((x, y) => x.match === y.match),
      map(({ state }) => {
        i(
          `State regex trigger fired for signal ${this.signal.id}, automation ${this.automation.hash}. Matched entity: ${state.entity_id}, State: "${state.state}"`
        )
        return { signal: this.signal, automation: this.automation }
      }),
      guaranteedThrottle(stateData.delay ?? 750),
      share()
    )
  }
}

export class StateRangeSignalHandler implements SignalHandler {
  readonly signalObservable: Observable<SignalledAutomation>
  readonly friendlySignalDescription: string
  readonly isValid: boolean
  private inRangeStartTime: number | null = null

  constructor(
    public readonly signal: Signal,
    public readonly automation: Automation,
    private readonly runtime: AutomationRuntime
  ) {
    const rangeData: StateRangeSignal = JSON.parse(signal.data)

    this.isValid = true // Default to valid, we'll check if parameters make sense
    this.friendlySignalDescription = `State range trigger for entity: ${rangeData.entityId} when value is between ${rangeData.min} and ${rangeData.max} for ${rangeData.durationSeconds} seconds`

    // Validate parameters
    if (rangeData.min >= rangeData.max) {
      this.isValid = false
      this.friendlySignalDescription = `Invalid range values: min (${rangeData.min}) must be less than max (${rangeData.max})`
      this.signalObservable = NEVER
      i(
        `Invalid range values for signal ${signal.id}: min ${rangeData.min} >= max ${rangeData.max}`
      )
      return
    }

    if (rangeData.durationSeconds <= 0) {
      this.isValid = false
      this.friendlySignalDescription = `Invalid duration: ${rangeData.durationSeconds} seconds must be greater than 0`
      this.signalObservable = NEVER
      i(
        `Invalid duration for signal ${signal.id}: ${rangeData.durationSeconds} seconds`
      )
      return
    }

    d(
      'StateRangeSignalHandler created for signal %s, automation %s. Entity: %s, Range: [%d, %d], Duration: %d seconds',
      signal.id,
      automation.hash,
      rangeData.entityId,
      rangeData.min,
      rangeData.max,
      rangeData.durationSeconds
    )

    // Create the observable that tracks the entity state
    this.signalObservable = observeStatesForEntities(
      this.runtime.api,
      [rangeData.entityId],
      false
    ).pipe(
      filter((state: HassState | undefined | null): state is HassState => {
        if (!state) {
          return false // Skip null/undefined states
        }

        // Convert state to number and check if it's in range
        const numValue = parseFloat(state.state)
        if (isNaN(numValue)) {
          // Just log and skip non-numeric states, don't notify or permanently break
          // This handles 'unavailable', 'unknown' or other non-numeric states gracefully
          d(
            `Entity ${rangeData.entityId} state "${state.state}" is not a number, skipping this update`
          )
          return false
        }

        const inRange = numValue >= rangeData.min && numValue <= rangeData.max
        const now = Date.now()

        if (inRange) {
          // If we just entered the range, record the start time
          if (this.inRangeStartTime === null) {
            this.inRangeStartTime = now
            d(
              `Entity ${rangeData.entityId} entered range [${rangeData.min}, ${rangeData.max}] with value ${numValue}`
            )
          }

          // Check if we've been in range long enough
          const timeInRange = now - this.inRangeStartTime
          const durationMet = timeInRange >= rangeData.durationSeconds * 1000

          if (durationMet) {
            d(
              `Entity ${rangeData.entityId} has been in range for ${timeInRange / 1000} seconds, triggering`
            )
            // Reset the start time so we don't keep triggering
            this.inRangeStartTime = null
            return true
          }
        } else if (this.inRangeStartTime !== null) {
          // If we were in range but now we're not, reset the start time
          d(`Entity ${rangeData.entityId} exited range with value ${numValue}`)
          this.inRangeStartTime = null
        }

        return false
      }),
      map((matchedState: HassState) => {
        i(
          `State range trigger fired for signal ${this.signal.id}, automation ${this.automation.hash}. Entity: ${matchedState.entity_id}, Value: ${matchedState.state}, Range: [${rangeData.min}, ${rangeData.max}], Duration: ${rangeData.durationSeconds}s`
        )
        return { signal: this.signal, automation: this.automation }
      }),
      share()
    )
  }
}
