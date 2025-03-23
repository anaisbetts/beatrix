import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'

export function messagesToString(msgs: MessageParam[]) {
  return msgs
    .reduce((acc, msg) => {
      if (msg.content instanceof Array) {
        msg.content.forEach((subMsg) => {
          switch (subMsg.type) {
            case 'text':
              acc.push(subMsg.text)
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
        acc.push(msg.content)
      }

      return acc
    }, [] as string[])
    .join('\n\n---\n\n')
}
