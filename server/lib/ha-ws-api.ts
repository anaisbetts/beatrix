import debug from 'debug'
import {
  createLongLivedTokenAuth,
  createConnection,
  Connection,
  HassEventBase,
  HassServices,
  HassEvent,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'

import { filter, Observable, share, Subscription, SubscriptionLike } from 'rxjs'
import { SerialSubscription } from '../../shared/serial-subscription'

const d = debug('ha:ws')

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

  eventsObservable(): Observable<HassEventBase>

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
    entities: HassState[],
    options?: {
      includeUnavailable?: boolean
    }
  ): HassState[]
}

export class LiveHomeAssistantApi implements HomeAssistantApi {
  private eventsSub = new SerialSubscription()
  private services: Promise<Record<string, HassState>> | undefined

  constructor(
    private connection: Connection,
    private testMode: boolean = false
  ) {}

  static async createViaEnv() {
    const auth = createLongLivedTokenAuth(
      process.env.HA_BASE_URL!,
      process.env.HA_TOKEN!
    )

    const connection = await createConnection({ auth })
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
    this.services = this.fetchFullState()

    const state = await this.services
    this.services = Promise.resolve(state)

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
    if (this.services) {
      return this.services
    }

    const ret = (this.services = this.fetchFullState())
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

    return this.connection.sendMessagePromise<T>(message)
  }

  filterUncommonEntities(
    entities: HassState[],
    options?: {
      includeUnavailable?: boolean
    }
  ): HassState[] {
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

export async function fetchHAUserInformation(api: HomeAssistantApi) {
  const states = await api.fetchStates()

  const people = states.filter((state) => state.entity_id.startsWith('person.'))
  d('people: %o', people)

  const ret = people.reduce(
    (acc, x) => {
      const name =
        (x.attributes.friendly_name as string) ??
        x.entity_id.replace('person.', '')

      const notifiers = ((x.attributes.device_trackers as string[]) ?? []).map(
        (t: string) => deviceTrackerNameToNotifyName(t)
      )

      acc[x.entity_id.replace('person.', '')] = {
        name,
        notifiers,
        state: x.state,
      }

      return acc
    },
    {} as Record<string, HAPersonInformation>
  )

  d('ret: %o', ret)
  return ret
}

export function filterUncommonEntitiesFromTime(
  entities: HassState[],
  currentTime: number,
  options: {
    includeUnavailable?: boolean
  } = {}
): HassState[] {
  // Default options
  const { includeUnavailable = false } = options
  // Combine domain and pattern filters into a single array of RegExp objects

  // Step 1: Filter out unavailable/unknown entities if configured
  let filtered = includeUnavailable
    ? entities
    : entities.filter(
        (e) =>
          e.state !== 'unavailable' &&
          e.state !== 'unknown' &&
          changedRecently(new Date(e.last_changed), 10 * 24, currentTime)
      )

  return filtered.filter(
    (x) => !LOW_VALUE_REGEXES.find((re) => re.test(x.entity_id))
  )
}

function changedRecently(date: Date, hours: number, now: number): boolean {
  const dateTime = date.getTime()

  const timeDifference = now - dateTime
  const hoursInMilliseconds = hours * 60 * 60 * 1000

  return timeDifference < hoursInMilliseconds
}
