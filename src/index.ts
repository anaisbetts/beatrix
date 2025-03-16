import WebSocket from 'ws'
import { Observable, Subject, firstValueFrom, filter, map, lastValueFrom } from 'rxjs'
import debug from 'debug'
import { AnonymousSubject } from 'rxjs/internal/Subject'

const d = debug('ha-websocket')

interface HAAuth {
  type: 'auth'
  access_token: string
}

interface HAAuthResponse {
  type: 'auth_ok' | 'auth_invalid'
  ha_version?: string
}

interface HAEvent {
  id: number
  type: 'event'
  event: {
    event_type: string
    data: any
    origin: string
    time_fired: string
    context: {
      id: string
      parent_id: string | null
      user_id: string | null
    }
  }
}

interface HAEventSubscription {
  id: number
  type: 'subscribe_events'
  event_type?: string
}

interface HAMessage {
  type: string
  [key: string]: any
}

function websocketToObservable<T = string>(url: string): AnonymousSubject<T> {
  const ws = new WebSocket(url)

  return new AnonymousSubject<T>(
    {
      next: (x) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(typeof x === 'string' ? x : JSON.stringify(x))
        }
      },
      error: (err) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      },
      complete: () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      },
    },
    new Observable<T>((subj) => {
      ws.on('open', () => d('WebSocket connection established'))
      
      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg.toString())
          d('Received message:', parsed)
          subj.next(parsed as T)
        } catch (err) {
          d('Error parsing message:', err)
          subj.next(msg as unknown as T)
        }
      })
      
      ws.on('error', (err) => {
        d('WebSocket error:', err)
        subj.error(err)
      })
      
      ws.on('close', () => {
        d('WebSocket connection closed')
        subj.complete()
      })

      return () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      }
    })
  )
}

async function connectToHomeAssistant(url?: string, token?: string): Promise<Observable<HAEvent>> {
  const baseUrl = url || process.env.HA_BASE_URL || ''
  const accessToken = token || process.env.HA_TOKEN || ''

  if (!baseUrl) throw new Error('Home Assistant URL is required')
  if (!accessToken) throw new Error('Home Assistant access token is required')

  // Convert http(s):// to ws(s)://
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/api/websocket'
  d('Connecting to Home Assistant at', wsUrl)
  
  const connection = websocketToObservable<HAMessage>(wsUrl)
  
  // Wait for auth_required message
  await firstValueFrom(connection.pipe(filter(msg => msg.type === 'auth_required')))
  
  // Send authentication
  d('Sending authentication message')
  connection.next({
    type: 'auth',
    access_token: accessToken
  })
  
  // Wait for auth response
  const authResponse = await firstValueFrom(connection.pipe(
    filter(msg => msg.type === 'auth_ok' || msg.type === 'auth_invalid')
  ))
  
  if (authResponse.type === 'auth_invalid') {
    throw new Error('Authentication failed')
  }
  
  d('Authentication successful')
  
  // Subscribe to all events
  let messageId = 1
  const subscriptionMessage: HAEventSubscription = {
    id: messageId++,
    type: 'subscribe_events'
  }
  
  d('Subscribing to all events')
  connection.next(subscriptionMessage)
  
  // Filter the connection to only return event messages
  return connection.pipe(
    filter(msg => msg.type === 'event'),
    map(msg => msg as HAEvent)
  )
}

async function main() {
  try {
    const events = await connectToHomeAssistant()
    d('Connected to Home Assistant, subscribed to all events')

    events.subscribe((event) => {
      console.log(`Event: ${event.event.event_type}`, event.event.data)
    })

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('Received SIGINT, closing connection')
      process.exit(0)
    })

		await lastValueFrom(events);
  } catch (error) {
    console.error('Error connecting to Home Assistant:', error)
    process.exit(1)
  }
}

main().catch(console.error)
