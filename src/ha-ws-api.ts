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

interface HAPersonInformation {
  name: string
  notifiers: string[]
  state: string
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
  return await connection.sendMessagePromise<HassState[]>({
    type: 'get_states',
  })
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

function deviceTrackerNameToNotifyName(tracker: string) {
  // XXX: There is no nice way to do this and it sucks ass
  return `mobile_app_${tracker.replace('device_tracker.', '')}`
}
