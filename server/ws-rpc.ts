import {
  catchError,
  concat,
  concatMap,
  defer,
  from,
  mergeMap,
  Observable,
  throwError,
} from 'rxjs'
import { getAllProperties } from '../shared/utility'
import debug from 'debug'
import { ServerMessage, IpcRequest, IpcResponse } from '../shared/ws-rpc'

const d = debug('ha:ws-rpc')

export function handleWebsocketRpc<T extends object>(
  routes: T,
  socket: Observable<ServerMessage>
) {
  d('handleWebsocketRpc: initializing with routes %o', Object.keys(routes))
  const validKeys = Object.fromEntries(
    getAllProperties(routes).map((k) => [k, true])
  )
  d('handleWebsocketRpc: valid methods %o', Object.keys(validKeys))

  return socket
    .pipe(
      mergeMap((sm) => {
        d(
          'handleWebsocketRpc: received message %s',
          typeof sm.message === 'string'
            ? sm.message.substring(0, 100) + '...'
            : '[Buffer]'
        )
        let rq: IpcRequest | null = null
        try {
          rq = validateRequest(sm.message, validKeys)
          d(
            'handleWebsocketRpc: invoking method %s with args %o',
            rq.method,
            rq.args
          )

          const fn: any = routes[rq.method as keyof T]
          const retVal = fn.apply(routes, rq.args ?? [])

          return handleSingleResponse(rq, sm, retVal)
        } catch (err) {
          d('handleWebsocketRpc: error handling request: %o', err)
          if (rq && rq.requestId) {
            d(
              'handleWebsocketRpc: sending error response for request %s',
              rq.requestId
            )
            const resp: IpcResponse = {
              requestId: rq?.requestId ?? '',
              type: 'error',
              object: JSON.stringify(err),
            }

            return from(sm.reply(JSON.stringify(resp)))
          }

          d('handleWebsocketRpc: no valid request ID, propagating error')
          return throwError(() => err)
        }
      })
    )
    .subscribe({
      error: (e) => {
        d('handleWebsocketRpc: socket subscription failed: %o', e)
        console.error('Socket has failed!', e)
      },
      complete: () => d('handleWebsocketRpc: socket completed'),
    })
}

function validateRequest(
  msg: any,
  validKeys: Record<string, boolean>
): IpcRequest {
  d('validateRequest: received message type %s', typeof msg)
  if (typeof msg !== 'string') {
    d('validateRequest: error - received non-string message')
    throw new Error('no buffers allowed')
  }

  d('validateRequest: parsing message %s', msg)
  const rq = JSON.parse(msg) as IpcRequest
  const keys = ['requestId', 'method', 'args']
  if (!rq) {
    d('validateRequest: error - parsed null request')
    throw new Error('Invalid request')
  }

  d('validateRequest: validating required keys %o', keys)
  keys.forEach((k) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    if (!(k in rq!)) {
      d('validateRequest: error - missing required key %s', k)
      throw new Error('Invalid request')
    }
  })

  d(
    'validateRequest: checking method %s against valid methods %o',
    rq.method,
    Object.keys(validKeys)
  )
  if (!validKeys[rq.method]) {
    d('validateRequest: error - invalid method %s', rq.method)
    throw new Error('Invalid method')
  }

  d('validateRequest: request validated successfully %o', {
    requestId: rq.requestId,
    method: rq.method,
  })
  return rq
}

function handleSingleResponse(
  rq: IpcRequest,
  serverMessage: ServerMessage,
  retVal: any
): Observable<void> {
  // If our handler returns Observable<T>
  if (retVal && typeof retVal === 'object' && 'subscribe' in retVal) {
    d(
      'handleSingleResponse: processing Observable response for %s',
      rq.requestId
    )
    const obs = retVal as Observable<any>

    const finished: IpcResponse = {
      requestId: rq.requestId,
      type: 'end',
      object: null,
    }
    const fobs = defer(() => {
      d('handleSingleResponse: sending end message for %s', rq.requestId)
      return from(serverMessage.reply(JSON.stringify(finished)))
    })

    const items = obs.pipe(
      concatMap((v) => {
        d('handleSingleResponse: sending item for %s: %o', rq.requestId, v)
        const resp: IpcResponse = {
          requestId: rq.requestId,
          type: 'item',
          object: v,
        }

        return from(serverMessage.reply(JSON.stringify(resp)))
      })
    )

    return concat(items, fobs).pipe(
      catchError((e: any) => {
        d(
          'handleSingleResponse: error in observable for %s: %o',
          rq.requestId,
          e
        )
        const err: IpcResponse = {
          requestId: rq.requestId,
          type: 'error',
          object: {
            message: e?.message || String(e)
          },
        }

        return from(serverMessage.reply(JSON.stringify(err)))
      })
    )
  }

  // If our handler returns Promise<T>
  if (retVal && typeof retVal === 'object' && 'then' in retVal) {
    d('handleSingleResponse: processing Promise response for %s', rq.requestId)
    const p = retVal as Promise<any>
    return from(
      p.then(
        (x) => {
          d(
            'handleSingleResponse: promise resolved for %s: %o',
            rq.requestId,
            x
          )
          const resp: IpcResponse = {
            requestId: rq.requestId,
            type: 'reply',
            object: x,
          }
          return serverMessage.reply(JSON.stringify(resp))
        },
        (e) => {
          d(
            'handleSingleResponse: promise rejected for %s: %o',
            rq.requestId,
            e
          )
          const resp: IpcResponse = {
            requestId: rq.requestId,
            type: 'error',
            object: {
              message: e?.message || String(e)
            },
          }
          return serverMessage.reply(JSON.stringify(resp))
        }
      )
    )
  }

  // Basically anything else
  d(
    'handleSingleResponse: processing direct value response for %s: %o',
    rq.requestId,
    retVal
  )
  const resp: IpcResponse = {
    requestId: rq.requestId,
    type: 'reply',
    object: retVal,
  }

  return from(serverMessage.reply(JSON.stringify(resp)))
}
