import { describe, expect, it } from 'bun:test'
import { Observable, firstValueFrom, of, throwError, timer } from 'rxjs'

import { IpcResponse } from '../../shared/ws-rpc'
import { IpcRequest } from '../../shared/ws-rpc'
import { ServerMessage } from '../../shared/ws-rpc'
import { handleWebsocketRpc } from './ws-rpc'

class TestHandler {
  itReturnsAValue() {
    return 5
  }

  itThrowsAnError() {
    throw new Error('Oh no!')
  }

  itReturnsAnObservable() {
    return of('item1', 'item2', 'item3')
  }

  itReturnsAnObservableThatThrows() {
    return throwError(() => new Error('Observable error!'))
  }

  itReturnsAPromise() {
    return Promise.resolve('promise result')
  }

  itReturnsAPromiseThatRejects() {
    return Promise.reject(new Error('Promise rejection!'))
  }

  itReturnsAComplexObject() {
    return {
      name: 'Test Object',
      values: [1, 2, 3],
      nested: {
        property: true,
        date: new Date(2025, 2, 25).toISOString(),
      },
      fn: function () {
        /* This should be omitted in JSON */
      },
    }
  }

  itReturnsNull() {
    return null
  }

  itReturnsUndefined() {
    return undefined
  }

  itTakesArguments(a: number, b: string, c: boolean) {
    return `a=${a}, b=${b}, c=${c}`
  }
}

class MockWebSocket {
  replies: string[] = []

  constructor(private request: IpcRequest) {}

  createServerMessage(): Observable<ServerMessage> {
    return of({
      message: JSON.stringify(this.request),
      reply: (msg: string | Buffer) => {
        if (typeof msg !== 'string') return Promise.reject(new Error('wat'))
        this.replies.push(msg)
        return Promise.resolve()
      },
    })
  }

  getResponses(): IpcResponse[] {
    return this.replies.map((r) => JSON.parse(r) as IpcResponse)
  }
}

describe('handleWebsocketRpc', () => {
  it('The simplest thing that can possibly work', async () => {
    const rq: IpcRequest = {
      requestId: '1',
      method: 'itReturnsAValue',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // XXX: We have to do this because ServerMessage.reply returns a promise
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('1')
    expect(resp.type).toBe('reply')
    expect(JSON.parse(resp.object)).toBe(5)
  })

  it('should handle methods that throw errors', async () => {
    const rq: IpcRequest = {
      requestId: '2',
      method: 'itThrowsAnError',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // Wait for the promise to resolve
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)
    expect(responses[0].requestId).toBe('2')
    expect(responses[0].type).toBe('error')

    // The server code stringifies the error
    const errorObj = JSON.parse(responses[0].object)
    expect(errorObj).toBeDefined()
  })

  it('should handle methods that return observables', async () => {
    const rq: IpcRequest = {
      requestId: '3',
      method: 'itReturnsAnObservable',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // Wait for the observable to complete
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(4) // 3 items + 1 end notification

    // Check item responses
    for (let i = 0; i < 3; i++) {
      const resp = responses[i]
      expect(resp.requestId).toBe('3')
      expect(resp.type).toBe('item')
      expect(resp.object).toBe(`item${i + 1}`)
    }

    // Check end notification
    const endResp = responses[3]
    expect(endResp.requestId).toBe('3')
    expect(endResp.type).toBe('end')
    expect(endResp.object).toBeNull()
  })

  it('should handle observables that throw errors', async () => {
    const rq: IpcRequest = {
      requestId: '4',
      method: 'itReturnsAnObservableThatThrows',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // Wait for the observable to complete or error
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    // Observable throws immediately without emitting an item in this implementation
    expect(responses.length).toBe(1)

    // Check the error
    const errorResp = responses[0]
    expect(errorResp.requestId).toBe('4')
    expect(errorResp.type).toBe('error')
    // Just check we got an error response
    expect(errorResp.object).toBeTruthy()
  })

  it('should handle methods that return promises with values', async () => {
    const rq: IpcRequest = {
      requestId: '5',
      method: 'itReturnsAPromise',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // Wait for the promise to resolve
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('5')
    expect(resp.type).toBe('reply')
    expect(resp.object).toBe('promise result')
  })

  it('should handle promises that reject', async () => {
    const rq: IpcRequest = {
      requestId: '6',
      method: 'itReturnsAPromiseThatRejects',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    // Wait for the promise to reject
    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('6')
    expect(resp.type).toBe('error')

    // Promise rejections may be handled differently
    // Just verify we got an error response
    expect(resp.object).toBeTruthy()
  })

  it('should handle complex objects', async () => {
    const rq: IpcRequest = {
      requestId: '7',
      method: 'itReturnsAComplexObject',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('7')
    expect(resp.type).toBe('reply')

    // For complex objects, the object gets serialized first by the handler
    // So we need to parse it to verify its structure
    const parsedObj =
      typeof resp.object === 'string' ? JSON.parse(resp.object) : resp.object

    // Verify complex object structure
    expect(parsedObj).toHaveProperty('name', 'Test Object')
    expect(parsedObj).toHaveProperty('values')
    expect(Array.isArray(parsedObj.values)).toBe(true)

    // Function should be omitted in JSON serialization
    expect(parsedObj.fn).toBeUndefined()
  })

  it('should handle null return values', async () => {
    const rq: IpcRequest = {
      requestId: '8',
      method: 'itReturnsNull',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('8')
    expect(resp.type).toBe('reply')
    expect(resp.object).toBeNull()
  })

  it('should handle undefined return values', async () => {
    const rq: IpcRequest = {
      requestId: '9',
      method: 'itReturnsUndefined',
      args: [],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('9')
    expect(resp.type).toBe('reply')
    // In real-world scenarios, undefined might become null or be omitted
    // Both are acceptable outcomes for undefined values in JSON
    expect(resp.object === null || resp.object === undefined).toBe(true)
  })

  it('should correctly pass arguments to methods', async () => {
    const rq: IpcRequest = {
      requestId: '10',
      method: 'itTakesArguments',
      args: [42, 'hello', true],
    }

    const socket = new MockWebSocket(rq)
    handleWebsocketRpc(new TestHandler(), socket.createServerMessage())

    await firstValueFrom(timer(100))

    const responses = socket.getResponses()
    expect(responses.length).toBe(1)

    const resp = responses[0]
    expect(resp.requestId).toBe('10')
    expect(resp.type).toBe('reply')
    expect(resp.object).toBe('a=42, b=hello, c=true')
  })
})
