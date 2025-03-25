import {
  catchError,
  concat,
  defer,
  from,
  mergeMap,
  Observable,
  throwError,
} from 'rxjs'
import { getAllProperties } from '../shared/utility'
import debug from 'debug'

const d = debug('ha:ws-rpc')

interface ServerMessage {
  message: string | Buffer
  reply: (msg: string | Buffer) => Promise<void>
}

interface IpcRequest {
  requestId: string
  method: string
  args: any[] | null
}

interface IpcResponse {
  requestId: string
  type: 'reply' | 'item' | 'end' | 'error'
  object: any
}

function validateRequest(
  msg: any,
  validKeys: Record<string, boolean>
): IpcRequest {
  if (typeof msg !== 'string') {
    throw new Error('no buffers allowed')
  }

  const rq = JSON.parse(msg) as IpcRequest
  const keys = ['requestId', 'method', 'args']
  if (!rq) throw new Error('Invalid request')

  keys.forEach((k) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    if (!(k in rq!)) throw new Error('Invalid request')
  })

  if (!validKeys[rq.method]) {
    throw new Error('Invalid method')
  }

  return rq
}

function handleSingleResponse(
  rq: IpcRequest,
  serverMessage: ServerMessage,
  retVal: any
): Observable<void> {
  // If our handler returns Observable<T>
  if ('subscribe' in retVal) {
    const obs = retVal as Observable<any>

    const finished: IpcResponse = {
      requestId: rq.requestId,
      type: 'end',
      object: null,
    }
    const fobs = defer(() =>
      from(serverMessage.reply(JSON.stringify(finished)))
    )

    const items = obs.pipe(
      mergeMap((v) => {
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
        const err: IpcResponse = {
          requestId: rq.requestId,
          type: 'error',
          object: e,
        }

        return from(serverMessage.reply(JSON.stringify(err)))
      })
    )
  }

  // If our handler returns Promise<T>
  if ('then' in retVal) {
    const p = retVal as Promise<any>
    return from(
      p.then(
        (x) => {
          const resp: IpcResponse = {
            requestId: rq.requestId,
            type: 'reply',
            object: x,
          }
          return serverMessage.reply(JSON.stringify(resp))
        },
        (e) => {
          const resp: IpcResponse = {
            requestId: rq.requestId,
            type: 'error',
            object: e,
          }
          return serverMessage.reply(JSON.stringify(resp))
        }
      )
    )
  }

  // Basically anything else
  const resp: IpcResponse = {
    requestId: rq.requestId,
    type: 'reply',
    object: retVal,
  }

  return from(serverMessage.reply(JSON.stringify(resp)))
}

export function handleWebsocketRpc<
  T extends Record<string, (...args: any[]) => any>,
>(routes: T, socket: Observable<ServerMessage>) {
  const validKeys = Object.fromEntries(
    getAllProperties(routes).map((k) => [k, true])
  )

  return socket
    .pipe(
      mergeMap((sm) => {
        let rq: IpcRequest | null = null
        try {
          rq = validateRequest(sm.message, validKeys)
          const retVal = routes[rq.method as keyof T].apply(
            routes,
            rq.args ?? []
          )

          return handleSingleResponse(rq, sm, retVal)
        } catch (err) {
          if (rq && rq.requestId) {
            const resp: IpcResponse = {
              requestId: rq?.requestId ?? '',
              type: 'error',
              object: JSON.stringify(err),
            }

            return from(sm.reply(JSON.stringify(resp)))
          }

          return throwError(() => err)
        }
      })
    )
    .subscribe({ error: (e) => console.error('Socket has failed!', e) })
}
