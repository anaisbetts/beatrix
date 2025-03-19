import {
  Connection,
  createConnection,
  createLongLivedTokenAuth,
  HassEventBase,
} from 'home-assistant-js-websocket'
import { Observable, Subscription } from 'rxjs'

function eventsObservable(connection: Connection): Observable<HassEventBase> {
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

async function main() {
  const auth = createLongLivedTokenAuth(
    process.env.HA_BASE_URL!,
    process.env.HA_TOKEN!
  )

  console.log('create')
  const connection = await createConnection({ auth })
  connection.addEventListener('ready', () => console.log('readyyyyy'))
  console.log('Connected')

  const events = eventsObservable(connection)
  events.subscribe((ev) => {
    console.log('Event:', ev)
  })

  await new Promise((res) => setTimeout(res, 1000 * 60 * 60 * 24))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
