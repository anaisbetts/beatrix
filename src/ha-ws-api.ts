import {
  createLongLivedTokenAuth,
  createConnection,
  Connection,
  HassEventBase,
  HassServices,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'

import { Observable, Subscription } from 'rxjs'

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
