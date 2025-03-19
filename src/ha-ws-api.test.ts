import { describe, expect, it } from 'bun:test'
import { connectToHAWebsocket, fetchServices } from './ha-ws-api'

describe('the fetch methods', () => {
  it('can fetch the services list', async () => {
    const conn = await connectToHAWebsocket()
    const svcs = await fetchServices(conn)

    console.log('Services:', svcs.notify)
    expect(svcs).toBeDefined()
  })
})
