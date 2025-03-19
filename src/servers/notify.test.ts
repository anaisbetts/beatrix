import { describe, expect, it } from 'bun:test'
import { connectToHAWebsocket, fetchServices } from '../ha-ws-api'
import { extractNotifiers } from './notify'

describe('the notify server', () => {
  it('can list all notify targets', async () => {
    const conn = await connectToHAWebsocket()
    const svcs = await fetchServices(conn)

    const result = await extractNotifiers(svcs)

    expect(result.length).toBeGreaterThan(0)
    console.log('Notifiers:', result)
  })
})
