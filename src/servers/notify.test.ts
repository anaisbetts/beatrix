import { describe, expect, it } from 'bun:test'
import { connectToHAWebsocket, fetchServices } from '../ha-ws-api'
import { createNotifyServer, extractNotifiers } from './notify'

describe('the notify server', () => {
  it('can list all notify targets', async () => {
    const conn = await connectToHAWebsocket()
    const svcs = await fetchServices(conn)

    const result = await extractNotifiers(svcs)

    expect(result.length).toBeGreaterThan(0)
    console.log('Notifiers:', result)
  })

  it('can list all people', async () => {
    const conn = await connectToHAWebsocket()
    const server = createNotifyServer(conn, { testMode: true })

    // Mock implementation for get_states
    conn.sendMessagePromise = async (message: any) => {
      if (message.type === 'get_states') {
        return [
          {
            entity_id: 'person.test_user',
            state: 'home',
            attributes: {
              friendly_name: 'Test User',
              id: 'test_id_123',
            },
          },
          {
            entity_id: 'person.another_user',
            state: 'away',
            attributes: {
              friendly_name: 'Another User',
            },
          },
          {
            entity_id: 'light.bedroom',
            state: 'on',
            attributes: {
              friendly_name: 'Bedroom Light',
            },
          },
        ]
      }

      return []
    }

    // Get the tool and execute it
    const toolFn = server.getToolMap().get('list-people')!
    const result = await toolFn.fn({})

    // Parse the returned content
    const people = JSON.parse(result.content[0].text)

    expect(people.length).toBe(2)
    expect(people[0].entity_id).toBe('person.test_user')
    expect(people[0].name).toBe('Test User')
    expect(people[1].entity_id).toBe('person.another_user')
    expect(people[1].name).toBe('Another User')

    console.log('People:', people)
  })
})
