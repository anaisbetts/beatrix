import {
  createLongLivedTokenAuth,
  createConnection,
  Connection,
  HassEventBase,
} from 'home-assistant-js-websocket'

import { Observable, Subscription } from 'rxjs'

export async function connectToHAWebsocket() {
  const auth = createLongLivedTokenAuth(
    process.env.HA_BASE_URL!,
    process.env.HA_TOKEN!
  )

  const connection = await createConnection({ auth })
  return connection
}
export function eventsObservable(
  connection: Connection
): Observable<HassEventBase> {
  return new Observable((subj) => {
    const disp = new Subscription()

    connection
      .subscribeEvents<HassEventBase>((ev) => subj.next(ev))
      .then(
        (unsub) => disp.add(() => unsub()),
        (err) => subj.error(err)
      )

    return disp
  })
}
