import { configDotenv } from 'dotenv'
import { connectToHAWebsocket, eventsObservable } from './ha-ws-api'
import {
  executePromptWithTools,
  messagesToString,
} from './execute-prompt-with-tools'

configDotenv()

async function main() {
  const connection = await connectToHAWebsocket()

  /*
  const events = eventsObservable(connection)
  events.subscribe((ev) => {
    console.log('Event:', ev)
  })
    */

  const msgs = await executePromptWithTools(
    connection,
    'Send a notification to the nVidia Shield, with the title "Foo" and the message "bar"'
  )

  console.log(messagesToString(msgs))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
