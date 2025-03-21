import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'

export function messagesToString(msgs: MessageParam[]) {
  return msgs.reduce((acc, msg) => {
    if (msg.content instanceof Array) {
      msg.content.forEach((subMsg) => {
        switch (subMsg.type) {
          case 'text':
            acc += subMsg.text
            break
          case 'tool_use':
            acc += `Running tool: ${subMsg.name}, ${JSON.stringify(subMsg.input)}\n`
            break
          case 'tool_result':
            acc += `${JSON.stringify(subMsg.content)}\n`
            break
        }
      })
    } else {
      acc += msg.content
    }

    acc += '\n\n---\n\n'
    return acc
  }, '')
}
