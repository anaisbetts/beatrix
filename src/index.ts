import { configDotenv } from 'dotenv'
import index from '../index.html'

configDotenv()

async function main() {
  /*
  const connection = await connectToHAWebsocket()

  const events = eventsObservable(connection)
  events.subscribe((ev) => {
    console.log('Event:', ev)
  })
    */
  /*
  const msgs = await executePromptWithTools(
    connection,
    'Send a notification to the nVidia Shield, with the title "Foo" and the message "bar"'
  )

  console.log(messagesToString(msgs))
  */

  const port = process.env.PORT || '5432'

  console.log('Starting server on port', port)
  Bun.serve({
    port: port,
    routes: {
      '/': index,
    },
  })
}

main()
  //.then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
