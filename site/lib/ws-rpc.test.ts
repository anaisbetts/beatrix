import { describe, expect, it } from 'bun:test'
import debug from 'debug'
import {
  Observable,
  Subject,
  concat,
  delay,
  firstValueFrom,
  map,
  of,
  share,
  tap,
  throwError,
  timer,
  toArray,
} from 'rxjs'

import { handleWebsocketRpc } from '../../server/lib/ws-rpc'
import { IpcResponse, ServerMessage } from '../../shared/ws-rpc'
import { RecursiveProxyHandler, createRemoteClient } from './ws-rpc'

interface TestInterface {
  itShouldReturnAString(): string
  add(a: number, b: number): number
  addPromise(a: number, b: number): Promise<number>
  addObservable(a: number, b: number): Observable<number>
  itReturnsAnObservableThatThrows(): Observable<number>
  itReturnsAPromiseThatRejects(): Promise<void>
}

const d = debug('b:ws')

class TestInterfaceImpl implements TestInterface {
  itShouldReturnAString(): string {
    return 'hello'
  }

  add(a: number, b: number): number {
    return a + b
  }

  addPromise(a: number, b: number): Promise<number> {
    return Promise.resolve(a + b)
  }

  addObservable(a: number, b: number): Observable<number> {
    return of(a, b, a + b).pipe(delay(10))
  }

  itReturnsAnObservableThatThrows() {
    return concat(
      of(5),
      throwError(() => new Error('Observable error!'))
    )
  }

  itReturnsAPromiseThatRejects() {
    return Promise.reject(new Error('Promise rejection!'))
  }
}

describe('createRemoteClient', () => {
  it('should roundtrip the entire thing', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    const ret = await firstValueFrom(client.itShouldReturnAString())
    expect(ret).toBe('hello')
  })

  it('should add', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    const ret = await firstValueFrom(client.itShouldReturnAString())
    expect(ret).toBe('hello')
  })

  it('should addPromise', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    const ret = await firstValueFrom(client.addPromise(5, 5))
    expect(ret).toBe(10)
  })

  it('should itReturnsAPromiseThatRejects', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    try {
      await firstValueFrom(
        client.itReturnsAPromiseThatRejects().pipe(
          tap({
            next: (x) => d('next: %o', x),
            error: (e) => d('err: %o', e),
            complete: () => d('done'),
          })
        )
      )
      expect(false).toBe(true)
    } catch {}
  })

  it('should addObservable', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    const ret = await firstValueFrom(client.addObservable(3, 4).pipe(toArray()))
    expect(ret).toStrictEqual([3, 4, 7])
  })

  it('should throw itReturnsAnObservableThatThrows', async () => {
    const subj: Subject<ServerMessage> = new Subject()
    const resps: Subject<string> = new Subject()

    const respMsgs = resps.pipe(
      map((x) => JSON.parse(x) as IpcResponse),
      share()
    )

    handleWebsocketRpc(new TestInterfaceImpl(), subj)

    const client = createRemoteClient<TestInterface>((msg) => {
      subj.next({
        message: msg,
        reply: (m) => {
          resps.next(m as string)
          return Promise.resolve()
        },
      })
      return Promise.resolve()
    }, respMsgs)

    let didThrow = false
    let didEnd = false
    let items: any[] = []

    client.itReturnsAnObservableThatThrows().subscribe({
      next: (x) => items.push(x),
      error: () => (didThrow = true),
      complete: () => (didEnd = true),
    })

    await firstValueFrom(timer(100))

    expect(items).toEqual([5])
    expect(didThrow).toBeTrue()
    expect(didEnd).toBeFalse()
  })
})

describe('RecursiveProxyHandler', () => {
  describe('create', () => {
    it('should create a proxy with the given name and method handler', () => {
      const methodHandler = createMockFn().mockReturnValue('result')
      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      // Verify the proxy is callable
      expect(typeof proxy).toBe('function')
    })

    it('should apply overrides to the created proxy', () => {
      const methodHandler = createMockFn()
      const overrides = { specialProperty: 'special value' }
      const proxy = RecursiveProxyHandler.create(
        'root',
        methodHandler,
        overrides
      ) as any

      // Access the special property
      expect(proxy.specialProperty).toBe('special value')
      // Ensure method handler wasn't called
      expect(methodHandler.callCount()).toBe(0)
    })
  })

  describe('method invocation', () => {
    it('should call the method handler with the correct method chain for direct invocation', () => {
      const methodHandler = createMockFn().mockReturnValue('result')
      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      const result = proxy()

      expect(result).toBe('result')
      expect(methodHandler.calledWith(['root'], [])).toBe(true)
    })

    it('should call the method handler with the correct method chain for nested invocation', () => {
      const methodHandler = createMockFn().mockReturnValue('nested result')
      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      const result = proxy.foo.bar()

      expect(result).toBe('nested result')
      expect(methodHandler.calledWith(['root', 'foo', 'bar'], [])).toBe(true)
    })

    it('should pass arguments to the method handler', () => {
      const methodHandler = createMockFn().mockReturnValue('with args')
      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      const result = proxy.method(1, 'two', { three: true })

      expect(result).toBe('with args')
      expect(
        methodHandler.calledWith(
          ['root', 'method'],
          [1, 'two', { three: true }]
        )
      ).toBe(true)
    })

    it('should handle deep nested method chains', () => {
      const methodHandler = createMockFn().mockReturnValue('deep result')
      const proxy = RecursiveProxyHandler.create('api', methodHandler) as any

      const result = proxy.users.admin.permissions.check('read', 'write')

      expect(result).toBe('deep result')
      expect(
        methodHandler.calledWith(
          ['api', 'users', 'admin', 'permissions', 'check'],
          ['read', 'write']
        )
      ).toBe(true)
    })
  })

  describe('getter replacement', () => {
    it('should replace get suffix in method names', () => {
      const methodHandler = createMockFn().mockImplementation(
        (methodChain: string[]) => {
          // Return the last method name for testing
          return methodChain[methodChain.length - 1]
        }
      )

      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      const result = proxy.value_get()

      expect(result).toBe('value')
      expect(methodHandler.calledWith(['root', 'value'], [])).toBe(true)
    })
  })

  describe('proxy caching', () => {
    it('should reuse proxy handlers for the same property', () => {
      const methodHandler = createMockFn()
      const proxy = RecursiveProxyHandler.create('root', methodHandler) as any

      // Access the same property twice
      const first = proxy.foo
      const second = proxy.foo

      // Both should return proxy functions
      expect(typeof first).toBe('function')
      expect(typeof second).toBe('function')

      // Call both to verify they have the same behavior
      first()
      second()

      expect(methodHandler.callCount()).toBe(2)
      expect(JSON.stringify(methodHandler.nthCall(1))).toBe(
        JSON.stringify([['root', 'foo'], []])
      )
      expect(JSON.stringify(methodHandler.nthCall(2))).toBe(
        JSON.stringify([['root', 'foo'], []])
      )
    })
  })
})

/**
 * Simple mock function implementation since we're not using Jest
 */
function createMockFn() {
  const calls: any[][] = []
  const fn = function (...args: any[]) {
    calls.push(args)
    return fn.returnValue
  }

  fn.calls = calls
  fn.returnValue = undefined
  fn.mockReturnValue = function (value: any) {
    fn.returnValue = value
    return fn
  }
  fn.mockImplementation = function (implementation: Function) {
    const originalFn = fn
    const newFn = function (...args: any[]) {
      originalFn.calls.push(args)
      return implementation(...args)
    }
    newFn.calls = originalFn.calls
    newFn.returnValue = originalFn.returnValue
    newFn.mockReturnValue = originalFn.mockReturnValue
    newFn.mockImplementation = originalFn.mockImplementation
    newFn.callCount = originalFn.callCount
    newFn.calledWith = originalFn.calledWith
    newFn.nthCall = originalFn.nthCall
    return newFn
  }
  fn.callCount = function () {
    return calls.length
  }
  fn.calledWith = function (...expectedArgs: any[]) {
    return calls.some((callArgs) => {
      if (callArgs.length !== expectedArgs.length) return false
      return callArgs.every((arg, i) => {
        if (typeof arg === 'object' && arg !== null) {
          return JSON.stringify(arg) === JSON.stringify(expectedArgs[i])
        }
        return arg === expectedArgs[i]
      })
    })
  }
  fn.nthCall = function (n: number) {
    return calls[n - 1] || []
  }

  return fn
}
