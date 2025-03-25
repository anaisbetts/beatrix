import { Observable } from 'rxjs'

export interface ServerMessage {
  message: string | Buffer
  reply: (msg: string | Buffer) => Promise<void>
}

export interface IpcRequest {
  requestId: string
  method: string
  args: any[] | null
}

export interface IpcResponse {
  requestId: string
  type: 'reply' | 'item' | 'end' | 'error'
  object: any
}

export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer R
    ? R extends Observable<infer U>
      ? (...args: Args) => Observable<U> // Already an Observable, preserve it
      : R extends Promise<infer U>
        ? (...args: Args) => Observable<U> // Unwrap Promise<U> and return Observable<U>
        : R extends void
          ? (...args: Args) => Observable<void> // void becomes Observable<void>
          : (...args: Args) => Observable<R> // Everything else becomes Observable<R>
    : T[K] // Non-function properties remain unchanged
}
