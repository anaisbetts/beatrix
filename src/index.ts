import { configDotenv } from 'dotenv'
import { connectToHAWebsocket, eventsObservable } from './ha-ws-api'

configDotenv()

async function main() {
  const connection = await connectToHAWebsocket()

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
