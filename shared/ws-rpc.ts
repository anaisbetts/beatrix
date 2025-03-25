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
