import debug from 'debug'
import {
  createLongLivedTokenAuth,
  createConnection,
  Connection,
  HassEventBase,
  HassServices,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'

import { Observable, Subscription } from 'rxjs'

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

export async function connectToHAWebsocket() {
  const auth = createLongLivedTokenAuth(
    process.env.HA_BASE_URL!,
    process.env.HA_TOKEN!
  )

  const connection = await createConnection({ auth })
  return connection
}

const cache = new LRUCache<string, any>({
  ttl: 5 * 60 * 1000,
  max: 100,
  ttlAutopurge: false,
})

export async function fetchServices(
  connection: Connection
): Promise<HassServices> {
  if (cache.has('services')) {
    return cache.get('services') as HassServices
  }

  const ret = await connection.sendMessagePromise<HassServices>({
    type: 'get_services',
  })

  cache.set('services', ret)
  return ret
}

export async function fetchStates(
  connection: Connection
): Promise<HassState[]> {
  if (cache.has('states')) {
    return cache.get('states') as HassState[]
  }

  const ret = await connection.sendMessagePromise<HassState[]>({
    type: 'get_states',
  })

  ret.forEach((x: any) => delete x.context)
  cache.set('states', ret, { ttl: 1000 })
  return ret
}

export function eventsObservable(
  connection: Connection
): Observable<HassEventBase> {
  return new Observable((subj) => {
    const disp = new Subscription()

    connection
      .subscribeEvents<HassEventBase>((ev) => subj.next(ev))
      .then(
        (unsub) => disp.add(() => void unsub()),
        (err) => subj.error(err)
      )

    return disp
  })
}

export async function fetchHAUserInformation(connection: Connection) {
  const states = await fetchStates(connection)

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

export async function sendNotification(
  testMode: boolean,
  connection: Connection,
  target: string,
  message: string,
  title: string | undefined
) {
  if (testMode) {
    const svcs = await fetchServices(connection)
    const notifiers = await extractNotifiers(svcs)

    if (!notifiers.find((n) => n.name === target)) {
      throw new Error('Target not found')
    }
  } else {
    await connection.sendMessagePromise({
      type: 'call_service',
      domain: 'notify',
      service: target,
      service_data: { message, ...(title ? { title } : {}) },
    })
  }
}

export async function callService<T = any>(
  connection: Connection,
  options: CallServiceOptions,
  testMode = false
): Promise<T | null> {
  if (testMode) {
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

  return connection.sendMessagePromise<T>(message)
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

export function filterUncommonEntities(
  entities: HassState[],
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
          changedRecently(new Date(e.last_changed), 10 * 24)
      )

  return filtered.filter(
    (x) => !LOW_VALUE_REGEXES.find((re) => re.test(x.entity_id))
  )
}

function changedRecently(date: Date, hours: number): boolean {
  const now = new Date().getTime()
  const dateTime = date.getTime()

  const timeDifference = now - dateTime
  const hoursInMilliseconds = hours * 60 * 60 * 1000

  return timeDifference < hoursInMilliseconds
}
