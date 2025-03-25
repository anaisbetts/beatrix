import { firstValueFrom, Observable, of, timer } from 'rxjs'
import {
  handleWebsocketRpc,
  IpcRequest,
  IpcResponse,
  ServerMessage,
} from './ws-rpc'
import { describe, expect, it } from 'bun:test'

class TestHandler {
  itReturnsAValue() {
    return 5
  }
}

describe('handleWebsocketRpc', () => {
  it('The simplest thing that can possibly work', async () => {
    const rq: IpcRequest = {
      requestId: '1',
      method: 'itReturnsAValue',
      args: [],
    }

    const replies: string[] = []
    const input: Observable<ServerMessage> = of({
      message: JSON.stringify(rq),
      reply: (msg: string | Buffer) => {
        if (typeof msg !== 'string') return Promise.reject(new Error('wat'))
        replies.push(msg)

        return Promise.resolve()
      },
    })

    handleWebsocketRpc(new TestHandler(), input)

    // XXX: We have to do this because ServerMessage.reply returns a promise
    await firstValueFrom(timer(100))

    expect(replies.length).toBe(1)

    const resp = JSON.parse(replies[0]) as IpcResponse
    expect(resp.requestId).toBe('1')
    expect(JSON.parse(resp.object)).toBe(5)
    expect(resp.type).toBe('reply')
  })
})
