import debug from 'debug'
import {
  Connection,
  HassEvent,
  HassServices,
  createConnection,
  createLongLivedTokenAuth,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'
import {
  EMPTY,
  Observable,
  ReplaySubject,
  Subscription,
  SubscriptionLike,
  concat,
  filter,
  from,
  fromEvent,
  map,
  merge,
  of,
  share,
  switchMap,
} from 'rxjs'

import { SerialSubscription } from '../../shared/serial-subscription'
import { AppConfig } from '../../shared/types'
import { i } from '../logging'

const d = debug('b:ws')

export interface HassState {
  entity_id: string
  state: string
  attributes: Record<string, any>
  last_changed: string
  last_reported: string
  last_updated: string
}

export interface HAPersonInformation {
  name: string
  notifiers: string[]
  state: string
}

export interface CallServiceOptions {
  domain: string
  service: string
  service_data?: Record<string, any>
  target?: {
    entity_id?: string | string[]
    device_id?: string | string[]
    area_id?: string | string[]
  }
  return_response?: boolean
}

const cache = new LRUCache<string, any>({
  ttl: 5 * 60 * 1000,
  max: 100,
  ttlAutopurge: false,
})

export interface HomeAssistantApi extends SubscriptionLike {
  fetchServices(): Promise<HassServices>

  fetchStates(): Promise<Record<string, HassState>>

  eventsObservable(): Observable<HassEvent>

  sendNotification(
    target: string,
    message: string,
    title: string | undefined
  ): Promise<void>

  callService<T = any>(
    options: CallServiceOptions,
    testModeOverride?: boolean
  ): Promise<T | null>

  filterUncommonEntities(
    entities: Record<string, HassState>,
    options?: {
      includeUnavailable?: boolean
    }
  ): Record<string, HassState>
}

export class LiveHomeAssistantApi implements HomeAssistantApi {
  private eventsSub = new SerialSubscription()
  private stateCache: Promise<Record<string, HassState>> | undefined
  private readonly _connectionEvents = new ReplaySubject<string>(1)
  public readonly connectionEvents = this._connectionEvents.asObservable()

  constructor(
    private connection: Connection,
    private testMode: boolean = false
  ) {
    // Feed underlying connection events into the Subject
    merge(
      fromEvent(this.connection, 'disconnected'),
      fromEvent(this.connection, 'reconnect-error') // Assuming this is the correct event name
    )
      .pipe(map(() => 'disconnect-error' as const))
      .subscribe(this._connectionEvents) // Use the private subject
  }

  static async createViaConfig(config: AppConfig) {
    const auth = createLongLivedTokenAuth(config.haBaseUrl!, config.haToken!)

    i(`Connecting to ${config.haBaseUrl}...`)
    const connection = await createConnection({ auth })

    // Send supported_features message immediately after connection/auth
    try {
      await connection.sendMessagePromise({
        id: 1, // As per HA documentation for the first message
        type: 'supported_features',
        features: { coalesce_messages: 1 },
      })
      d('Sent supported_features message with coalesce_messages.')
    } catch (err) {
      // Log a warning if sending supported_features fails, but proceed.
      // It's optional and might not be supported by all HA versions or configurations.
      console.warn('Failed to send supported_features message:', err)
      d('Failed to send supported_features message: %o', err)
    }

    const ret = new LiveHomeAssistantApi(connection)
    await ret.setupStateCache()

    return ret
  }

  async fetchServices(): Promise<HassServices> {
    if (cache.has('services')) {
      return cache.get('services') as HassServices
    }

    const ret = await this.connection.sendMessagePromise<HassServices>({
      type: 'get_services',
    })

    cache.set('services', ret)
    return ret
  }

  private async fetchFullState(): Promise<Record<string, HassState>> {
    const ret = await this.connection.sendMessagePromise<HassState[]>({
      type: 'get_states',
    })

    ret.forEach((x: any) => delete x.context)
    return ret.reduce(
      (acc, x) => {
        const entityId = x.entity_id
        if (entityId) {
          acc[entityId] = x
        }
        return acc
      },
      {} as Record<string, HassState>
    )
  }

  private async setupStateCache() {
    this.stateCache = this.fetchFullState()

    const state = await this.stateCache
    this.stateCache = Promise.resolve(state)

    this.eventsSub.current = this.eventsObservable()
      .pipe(filter((x) => x.event_type === 'state_changed'))
      .subscribe((ev) => {
        const entityId = ev.data.entity_id
        if (entityId) {
          delete ev.data.new_state.context
          state[entityId] = ev.data.new_state
        }
      })
  }

  fetchStates(): Promise<Record<string, HassState>> {
    if (this.stateCache) {
      // NB: We do the Object.assign here so that callers get a stable snapshot
      // rather than a constantly shifting live object
      return this.stateCache.then((x) => Object.assign({}, x))
    }

    const ret = (this.stateCache = this.fetchFullState())
    return ret
  }

  private eventsObs = new Observable<HassEvent>((subj) => {
    const disp = new Subscription()

    this.connection
      .subscribeEvents<HassEvent>((ev) => subj.next(ev))
      .then(
        (unsub) => disp.add(() => void unsub()),
        (err) => subj.error(err)
      )

    return disp
  }).pipe(share())

  eventsObservable(): Observable<HassEvent> {
    return this.eventsObs
  }

  async sendNotification(
    target: string,
    message: string,
    title: string | undefined
  ) {
    if (this.testMode) {
      const svcs = await this.fetchServices()
      const notifiers = await extractNotifiers(svcs)

      if (!notifiers.find((n) => n.name === target)) {
        throw new Error('Target not found')
      }
    } else {
      await this.connection.sendMessagePromise({
        type: 'call_service',
        domain: 'notify',
        service: target,
        service_data: { message, ...(title ? { title } : {}) },
      })
    }
  }

  async callService<T = any>(
    options: CallServiceOptions,
    testModeOverride?: boolean
  ): Promise<T | null> {
    const useTestMode =
      testModeOverride !== undefined ? testModeOverride : this.testMode

    if (useTestMode) {
      // In test mode, validate that entity_id starts with domain
      const entityId = options.target?.entity_id

      if (entityId) {
        // Handle both string and array cases
        const entities = Array.isArray(entityId) ? entityId : [entityId]

        for (const entity of entities) {
          if (!entity.startsWith(`${options.domain}.`)) {
            throw new Error(
              `Entity ID ${entity} doesn't match domain ${options.domain}`
            )
          }
        }
      }

      return null
    }

    const message = {
      type: 'call_service',
      ...options,
    }

    try {
      // NB: home-assistant-js-websocket timeout error is just Error('Timeout')
      return await this.connection.sendMessagePromise<T>(message)
    } catch (e) {
      if (e instanceof Error && e.message === 'Timeout') {
        d(
          'sendMessagePromise timed out, emitting disconnect-error and closing connection'
        )
        this._connectionEvents.next('disconnect-error')
        this.connection.close()
      }

      // Re-throw the error so the caller can handle it
      throw e
    }
  }

  filterUncommonEntities(
    entities: Record<string, HassState>,
    options?: {
      includeUnavailable?: boolean
    }
  ): Record<string, HassState> {
    return filterUncommonEntitiesFromTime(entities, Date.now(), options)
  }

  unsubscribe(): void {
    this.eventsSub.unsubscribe()
  }

  get closed() {
    return this.eventsSub.closed
  }
}

export async function extractNotifiers(svcs: HassServices) {
  return Object.keys(svcs.notify).reduce(
    (acc, k) => {
      if (k === 'persistent_notification' || k === 'send_message') {
        return acc
      }

      const service = svcs.notify[k]
      acc.push({ name: k, description: service.name! })
      return acc
    },
    [] as { name: string; description: string }[]
  )
}

function deviceTrackerNameToNotifyName(tracker: string) {
  // XXX: There is no nice way to do this and it sucks ass
  return `mobile_app_${tracker.replace('device_tracker.', '')}`
}

export async function fetchHAUserInformation(api: HomeAssistantApi) {
  const states = await api.fetchStates()

  const people = Object.keys(states).filter((state) =>
    state.startsWith('person.')
  )

  d('people: %o', people)

  const ret = people.reduce(
    (acc, x) => {
      const state = states[x]
      const name =
        (state.attributes.friendly_name as string) ??
        state.entity_id.replace('person.', '')

      const notifiers = (
        (state.attributes.device_trackers as string[]) ?? []
      ).map((t: string) => deviceTrackerNameToNotifyName(t))

      acc[state.entity_id.replace('person.', '')] = {
        name,
        notifiers,
        state: state.state,
      }

      return acc
    },
    {} as Record<string, HAPersonInformation>
  )

  d('ret: %o', ret)
  return ret
}

export function observeStatesForEntities(
  conn: HomeAssistantApi,
  ids: string[],
  actAsBehavior: boolean = true
): Observable<HassState> {
  const future = conn.eventsObservable().pipe(
    filter((ev) => ev.event_type === 'state_changed'),
    switchMap((ev) => {
      const entityId = ev.data.entity_id

      if (ids.includes(entityId)) {
        return of(ev.data.new_state as HassState)
      } else {
        return EMPTY
      }
    })
  )

  if (!actAsBehavior) {
    return future
  }

  return concat(
    from(conn.fetchStates()).pipe(
      switchMap((states) => {
        return from(ids.map((id) => states[id]))
      })
    ),
    future
  )
}

const LOW_VALUE_REGEXES = [
  // Domain-based filters (anchored at start)
  /^update\./,
  /^device_tracker\./,
  /^button\./,
  /^binary_sensor\.remote_ui/,
  /^conversation\./,
  /^stt\./,
  /^tts\./,
  /^number\./,
  /^select\./,

  // Name-based pattern filters (can appear anywhere)
  /_uptime/,
  /_cpu_utilization/,
  /_memory_/,
  /_battery_/,
  /_uplink_mac/,
  /_firmware/,
  /debug_/,
  /_identify/,
  /_reboot/,
  /_restart/,
  /_power_cycle/,
  /_fan_speed/,
  /_signal/,
  /_mac/,
  /_version/,
  /_bssid/,
  /_ssid/,
  /_ip/,
  /hacs_/,
  /_connectivity/,
]

export function filterUncommonEntitiesFromTime(
  entities: Record<string, HassState>,
  currentTime: number,
  options: {
    includeUnavailable?: boolean
  } = {}
): Record<string, HassState> {
  // Default options
  const { includeUnavailable = false } = options
  // Combine domain and pattern filters into a single array of RegExp objects

  // Step 1: Filter out unavailable/unknown entities if configured
  let filtered = includeUnavailable
    ? Object.keys(entities)
    : Object.keys(entities).filter(
        (e) =>
          entities[e].state !== 'unavailable' &&
          entities[e].state !== 'unknown' &&
          changedRecently(
            new Date(entities[e].last_changed),
            10 * 24,
            currentTime
          )
      )

  return Object.fromEntries(
    filtered
      .filter((x) => !LOW_VALUE_REGEXES.find((re) => re.test(x)))
      .map((k) => [k, entities[k]])
  )
}

function changedRecently(date: Date, hours: number, now: number): boolean {
  const dateTime = date.getTime()

  const timeDifference = now - dateTime
  const hoursInMilliseconds = hours * 60 * 60 * 1000

  return timeDifference < hoursInMilliseconds
}
