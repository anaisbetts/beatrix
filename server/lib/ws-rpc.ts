import debug from 'debug'
import {
  Observable,
  catchError,
  concat,
  concatMap,
  defer,
  from,
  mergeMap,
  throwError,
} from 'rxjs'

import { getAllProperties } from '../../shared/utility'
import { IpcRequest, IpcResponse, ServerMessage } from '../../shared/ws-rpc'
import { isProdMode } from '../paths'

const d = debug('b:ws')

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
          d('handleWebsocketRpc: error handling request:', err)
          if (rq && rq.requestId) {
            d(
              'handleWebsocketRpc: sending error response for request %s',
              rq.requestId
            )
            const resp: IpcResponse = {
              requestId: rq?.requestId ?? '',
              type: 'error',
              object: stringifyError(err),
            }

            return from(sm.reply(JSON.stringify(resp)))
          }

          d('handleWebsocketRpc: no valid request ID, propagating error')
          return throwError(() => err)
        }
      })
    )
    .subscribe({
      error: (err) => {
        d('handleWebsocketRpc: socket subscription failed:', err)
        console.error('Socket has failed!', err)
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
      catchError((err: any) => {
        d(
          'handleSingleResponse: error in observable for %s: %o',
          rq.requestId,
          err
        )
        const resp: IpcResponse = {
          requestId: rq.requestId,
          type: 'error',
          object: stringifyError(err),
        }

        return from(serverMessage.reply(JSON.stringify(resp)))
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
        (err) => {
          d('handleSingleResponse: promise rejected for %s:', rq.requestId, err)
          const resp: IpcResponse = {
            requestId: rq.requestId,
            type: 'error',
            object: stringifyError(err),
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

/**
 * Serializes an error object into a plain object suitable for JSON stringification.
 * Captures message, stack, and any other own properties.
 */
export function objectifyError(error: any): Record<string, any> {
  if (error instanceof Error) {
    const output: Record<string, any> = {
      message: error.message,
      // stack: error.stack, // Omit stack trace for security
      name: error.name,
    }

    if (!isProdMode || process.env.DEBUG) {
      output.stack = error.stack
    }

    // Include any additional own properties, excluding 'stack' if it exists
    Object.keys(error).forEach((key) => {
      if (key !== 'stack') {
        output[key] = (error as any)[key]
      }
    })
    return output
  }

  // If it's not an Error instance, try to return it as is,
  // or convert to string if it's a primitive.
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) }
  }

  // For generic objects, just return them.
  return error
}

export function stringifyError(error: any): string {
  return JSON.stringify(objectifyError(error))
}
