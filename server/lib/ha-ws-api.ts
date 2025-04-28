import debug from 'debug'
import {
  Auth,
  Connection,
  ConnectionEventListener,
  HassEvent,
  HassServices,
  createConnection,
  createLongLivedTokenAuth,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'
import {
  EMPTY,
  Observable,
  Subject,
  Subscription,
  SubscriptionLike,
  concat,
  filter,
  firstValueFrom,
  from,
  interval,
  merge,
  of,
  retry,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs'

import { AppConfig } from '../../shared/types'
import { e, i, w } from '../logging'
import { clamp } from './math'

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
}

export class LiveHomeAssistantApi implements HomeAssistantApi {
  private stateCache: Record<string, HassState> | undefined

  private connectionSub: Subscription
  private connection: Connection | null = null
  private readonly connectionFactory: Observable<Connection>
  private readonly eventsObs: Subject<HassEvent> = new Subject()
  private failCount = 0

  private constructor(
    auth: Auth,
    private testMode: boolean = false
  ) {
    this.connectionFactory = new Observable<Connection>((subj) => {
      const disp = new Subscription()

      i(`Connecting to Home Assistant...`)
      createConnection({ auth }).then(
        (x) => {
          i('Connected successfully')
          this.failCount = 0

          disp.add(
            merge(
              fromHassEvent(x, 'disconnected', (e) => JSON.stringify(e)),
              fromHassEvent(x, 'reconnect-error', (e) => JSON.stringify(e))
            ).subscribe((e) => {
              w('Disconnected from Home Assistant!', e)
              subj.error(new Error(e))
            })
          )

          disp.add(
            interval(3 * 60 * 1000)
              .pipe(switchMap(async () => x.ping()))
              .subscribe({
                error: (e) => {
                  w('Ping to Home Assistant WS connection failed!', e)
                  subj.error(e)
                },
              })
          )

          x.subscribeEvents<HassEvent>((ev) => this.eventsObs.next(ev)).then(
            (unsub) => disp.add(() => void unsub()),
            (err) => subj.error(err)
          )

          LiveHomeAssistantApi.fetchFullState(x).then(
            (states) => (this.stateCache = states),
            (err: any) => {
              e('Failed to fetch initial state information!')
              subj.error(err)
            }
          )

          subj.next(x)
        },
        (e) => subj.error(e)
      )

      disp.add(() => this.connection?.close())
      return disp
    }).pipe(
      retry({
        delay: () => timer(Math.pow(2, clamp(0, this.failCount++, 10)) * 1000),
      }),
      shareReplay(1)
    )

    this.connectionSub = this.connectionFactory.subscribe({
      next: (x) => (this.connection = x),
      error: (err) => e('Failed to connect to Home Assistant!', err),
    })

    this.connectionSub.add(
      this.eventsObs
        .pipe(filter((x) => x.event_type === 'state_changed'))
        .subscribe((ev) => {
          const entityId = ev.data.entity_id
          if (entityId) {
            delete ev.data.new_state.context
            this.stateCache![entityId] = ev.data.new_state
          }
        })
    )
  }

  static async createViaConfig(config: AppConfig) {
    i(`Using Home Assistant URL ${config.haBaseUrl}`)
    const auth = createLongLivedTokenAuth(config.haBaseUrl!, config.haToken!)

    const ret = new LiveHomeAssistantApi(auth)
    await firstValueFrom(ret.connectionFactory)

    return ret
  }

  async fetchServices(): Promise<HassServices> {
    if (cache.has('services')) {
      return cache.get('services') as HassServices
    }

    const ret = await this.connection!.sendMessagePromise<HassServices>({
      type: 'get_services',
    })

    cache.set('services', ret)
    return ret
  }

  private static async fetchFullState(
    conn: Connection
  ): Promise<Record<string, HassState>> {
    const ret = await conn.sendMessagePromise<HassState[]>({
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

  async fetchStates(force = false): Promise<Record<string, HassState>> {
    if (this.stateCache && !force) {
      // NB: We do the clone here so that callers get a stable snapshot
      // rather than a constantly shifting live object
      return Promise.resolve(structuredClone(this.stateCache))
    }

    this.stateCache = await LiveHomeAssistantApi.fetchFullState(
      this.connection!
    )

    return this.stateCache
  }

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
      await this.connection!.sendMessagePromise({
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
    return await this.connection!.sendMessagePromise<T>(message)
  }

  unsubscribe(): void {
    this.eventsObs.complete()
    this.connectionSub.unsubscribe()
  }

  get closed() {
    return this.connectionSub.closed
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
  /^binary_sensor\.remote_ui/,

  // Name-based pattern filters (can appear anywhere)
  /_uptime/,
  /_cpu_utilization/,
  /_memory_/,
  /_uplink_mac/,
  /_firmware/,
  /debug_/,
  /_identify/,
  /_signal/,
  /_mac/,
  /_version/,
  /_bssid/,
  /_ssid/,
  /_ip/,
  /hacs_/,
  /_connectivity/,
]

export function filterUncommonEntities(
  entities: Record<string, HassState>,
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
          entities[e].state !== 'unavailable' && entities[e].state !== 'unknown'
      )

  return Object.fromEntries(
    filtered
      .filter((x) => !LOW_VALUE_REGEXES.find((re) => re.test(x)))
      .map((k) => [k, entities[k]])
  )
}

interface HassEventTargetAddRemove {
  addEventListener(eventType: string, callback: ConnectionEventListener): void
  removeEventListener(
    eventType: string,
    callback: ConnectionEventListener
  ): void
}

function fromHassEvent<R>(
  target: HassEventTargetAddRemove,
  name: string,
  resultSelector: (event: any) => R
) {
  return new Observable<R>((subj) => {
    const h = (_: Connection, r: any) => subj.next(resultSelector(r))
    target.addEventListener(name, h)
    return new Subscription(() => target.removeEventListener(name, h))
  })
}
