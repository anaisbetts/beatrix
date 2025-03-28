import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'
import { Observable } from 'rxjs'

export interface ServerWebsocketApi {
  handlePromptRequest(prompt: string): Observable<MessageParam>
}

export function messagesToString(
  msgs: MessageParam[],
  annotateSides: boolean = false
) {
  return msgs
    .reduce((acc, msg) => {
      const side = annotateSides ? `${msg.role}: ` : ''

      if (msg.content instanceof Array) {
        msg.content.forEach((subMsg) => {
          switch (subMsg.type) {
            case 'text':
              acc.push(side + subMsg.text)
              break
            case 'tool_use':
              acc.push(
                `Running tool: ${subMsg.name}, ${JSON.stringify(subMsg.input)}\n`
              )
              break
            case 'tool_result':
              acc.push(`${JSON.stringify(subMsg.content)}\n`)
              break
          }
        })
      } else {
        acc.push(side + msg.content)
      }

      return acc
    }, [] as string[])
    .join('\n\n---\n\n')
}
