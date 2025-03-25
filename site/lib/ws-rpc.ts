import {
  AsyncSubject,
  EMPTY,
  filter,
  from,
  mergeMap,
  NEVER,
  Observable,
  of,
  shareReplay,
  Subject,
  takeUntil,
  takeWhile,
  throwError,
} from 'rxjs'
import { Asyncify, IpcRequest, IpcResponse } from '../../shared/ws-rpc'
import debug from 'debug'

const d = debug('ha:ws-rpc')

export function createRemoteClient<T>(
  sender: (msg: string) => Promise<void>,
  messageStream: Observable<IpcResponse>
): Asyncify<T> {
  let rqId = 1

  const ret = RecursiveProxyHandler.create('root', ([, ...chain], args) => {
    rqId++
    const rq: IpcRequest = {
      requestId: rqId.toString(),
      method: chain.join('.'),
      args: args,
    }

    const retVal = handleSingleRequest(rq, messageStream).pipe(shareReplay())

    retVal.subscribe({ error: () => {} })

    return from(sender(JSON.stringify(rq))).pipe(mergeMap(() => retVal))
  })

  return ret as Asyncify<T>
}

function handleSingleRequest(rq: IpcRequest, stream: Observable<IpcResponse>) {
  const bail: Subject<void> = new AsyncSubject()

  return stream.pipe(
    filter((x) => x.requestId === rq.requestId),
    takeUntil(bail),
    mergeMap((x) => {
      d('Got a response! %o', x)

      switch (x.type) {
        case 'item':
          return of(x.object)
        case 'error':
          return throwError(() =>
            'message' in x.object
              ? new Error(x.object.message)
              : new Error(x.object.toString())
          )
        case 'end':
          bail.next()
          return EMPTY
        case 'reply':
          bail.next()
          return of(x.object)
        default:
          return throwError(() => new Error('invalid'))
      }
    })
  )
}

/**
 * RecursiveProxyHandler is a ES6 Proxy Handler object that intercepts method
 * invocations and returns the full object that was invoked. So this means, if you
 * get a proxy, then execute `foo.bar.bamf(5)`, you'll receive a callback with
 * the parameters "foo.bar.bamf" as a string, and [5].
 */
export class RecursiveProxyHandler implements ProxyHandler<Function> {
  private name: string
  private proxies: Record<string, RecursiveProxyHandler>
  private methodHandler: (methodChain: string[], args: any[]) => any
  private parent: RecursiveProxyHandler | null
  private overrides: Record<string, any> | null

  /**
   * Creates a new RecursiveProxyHandler. Don't use this, use `create`
   *
   * @private
   */
  constructor(
    name: string,
    methodHandler: (methodChain: string[], args: any[]) => any,
    parent: RecursiveProxyHandler | null = null,
    overrides: Record<string, any> | null = null
  ) {
    this.name = name
    this.proxies = {}
    this.methodHandler = methodHandler
    this.parent = parent
    this.overrides = overrides
  }

  /**
   * Creates an ES6 Proxy which is handled by RecursiveProxyHandler.
   *
   * @param  {string} name             The root object name
   * @param  {Function} methodHandler  The Function to handle method invocations -
   *                                   this method will receive an Array<String> of
   *                                   object names which will point to the Function
   *                                   on the Proxy being invoked.
   *
   * @param  {Object} overrides        An optional object that lets you directly
   *                                   include functions on the top-level object, its
   *                                   keys are key names for the property, and
   *                                   the values are what the key on the property
   *                                   should return.
   *
   * @return {Proxy}                   An ES6 Proxy object that uses
   *                                   RecursiveProxyHandler.
   */
  static create(
    name: string,
    methodHandler: (methodChain: string[], args: any[]) => any,
    overrides: Record<string, any> | null = null
  ): Function {
    const emptyFn = function () {}
    return new Proxy(
      emptyFn,
      new RecursiveProxyHandler(name, methodHandler, null, overrides)
    )
  }

  /**
   * The {get} ES6 Proxy handler.
   *
   * @private
   */
  get(target: Function, prop: string | symbol): any {
    if (this.overrides && typeof prop === 'string' && prop in this.overrides) {
      return this.overrides[prop]
    }

    const emptyFn = function () {}
    return new Proxy(emptyFn, this.getOrCreateProxyHandler(prop.toString()))
  }

  /**
   * The {apply} ES6 Proxy handler.
   *
   * @private
   */
  apply(target: Function, thisArg: any, argList: any[]): any {
    let methodChain = [this.replaceGetterWithName(this.name)]
    let iter = this.parent

    while (iter) {
      methodChain.unshift(iter.name)
      iter = iter.parent
    }

    return this.methodHandler(methodChain, argList)
  }

  /**
   * Creates a proxy for a returned `get` call.
   *
   * @param  {string} name  The property name
   * @return {RecursiveProxyHandler}
   *
   * @private
   */
  private getOrCreateProxyHandler(name: string): RecursiveProxyHandler {
    let ret = this.proxies[name]
    if (ret) return ret

    ret = new RecursiveProxyHandler(name, this.methodHandler, this)
    this.proxies[name] = ret
    return ret
  }

  /**
   * Because we don't support directly getting values by-name, we convert any
   * call of the form "getXyz" into a call for the value 'xyz'
   *
   * @return {string} The name of the actual method or property to evaluate.
   * @private
   */
  private replaceGetterWithName(name: string): string {
    return name.replace(/_get$/, '')
  }
}
