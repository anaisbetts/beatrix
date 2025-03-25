import { createContext, useContext, ReactNode, useEffect } from 'react'
import { ServerWebsocketApi } from '../../shared/prompt'
import { useObservable } from '@anaisbetts/commands'
import {
  EMPTY,
  fromEvent,
  map,
  mergeMap,
  Observable,
  of,
  retry,
  Subject,
} from 'rxjs'
import { createRemoteClient } from '@/lib/ws-rpc'
import { Asyncify, IpcResponse } from '../../shared/ws-rpc'

type WebSocketContextType = {
  api: Asyncify<ServerWebsocketApi> | undefined
}

const WebSocketContext = createContext<WebSocketContextType>({ api: undefined })

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }

  return context
}

function connectApiToWs() {
  return new Observable<Asyncify<ServerWebsocketApi>>((subj) => {
    const ws = new WebSocket('/api/ws')

    fromEvent(ws, 'open')
      .pipe(
        map(() => {
          const msgs: Subject<IpcResponse> = new Subject()

          fromEvent<MessageEvent>(ws, 'message')
            .pipe(
              mergeMap((msg) => {
                if (typeof msg.data !== 'string') {
                  return EMPTY
                }

                let resp: any
                try {
                  resp = JSON.parse(msg.data)
                } catch (e) {
                  return EMPTY
                }

                if (
                  !resp ||
                  typeof resp !== 'object' ||
                  !('requestId' in resp) ||
                  !('type' in resp)
                ) {
                  return EMPTY
                }

                return of(resp as IpcResponse)
              })
            )
            .subscribe(msgs)

          return createRemoteClient<ServerWebsocketApi>(
            (m) => Promise.resolve(ws.send(m)),
            msgs
          )
        })
      )
      .subscribe({ next: (x) => subj.next(x) })

    fromEvent(ws, 'error').subscribe({
      next: (e) => subj.error(new Error(JSON.stringify(e))),
    })

    fromEvent(ws, 'close').subscribe({ next: () => subj.complete() })
  })
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const api = useObservable(() => connectApiToWs().pipe(retry()), [])

  const apiValue = api.mapOrElse({
    ok: (v) => v,
    err: () => undefined,
    pending: () => undefined,
  })

  return (
    <WebSocketContext.Provider value={{ api: apiValue }}>
      {children}
    </WebSocketContext.Provider>
  )
}
