import { Connection as HAConnection } from 'home-assistant-js-websocket'
import { createNotifyServer } from './servers/notify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { asyncReduce } from './promise-extras'
import debug from 'debug'

const d = debug('ha:anthropic')

export function connectBuiltinServers(
  client: Client,
  connection: HAConnection
) {
  const servers = [createNotifyServer(connection)]

  servers.forEach((server) => {
    const [cli, srv] = InMemoryTransport.createLinkedPair()
    client.connect(cli)
    server.connect(srv)
  })
}

export function messagesToString(msgs: MessageParam[]) {
  return msgs.reduce((acc, msg) => {
    if (msg.content instanceof Array) {
      msg.content.forEach((subMsg) => {
        switch (subMsg.type) {
          case 'text':
            acc += subMsg.text
            break
          case 'tool_use':
            acc += `Running tool: ${subMsg.name}\n`
            break
          case 'tool_result':
            acc += JSON.stringify(subMsg.content)
            break
        }
      })
    } else {
      acc += msg.content
    }

    return acc
  }, '')
}

export async function executePromptWithTools(
  connection: HAConnection,
  prompt: string,
  model?: string
) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const client = new Client({
    name: pkg.name,
    version: pkg.version,
  })

  connectBuiltinServers(client, connection)
  const toolList = await client.listTools()

  const anthropicTools = toolList.tools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema,
    }
  })

  const msgs: MessageParam[] = [
    {
      role: 'user',
      content: prompt,
    },
  ]

  // We're gonna keep looping until there are no more tool calls to satisfy
  while (true) {
    d('Prompting: %s', JSON.stringify(msgs))

    const response = await anthropic.messages.create({
      model: model ?? 'claude-3-7-sonnet-20250219',
      max_tokens: 4000,
      messages: msgs,
      tools: anthropicTools,
      tool_choice: { type: 'auto' },
    })

    msgs.push({
      role: response.role,
      content: response.content,
    })

    if (!response.content.find((msg) => msg.type === 'tool_use')) {
      break
    }

    const toolCalls = response.content.filter((msg) => msg.type === 'tool_use')

    const toolResults = await asyncReduce(
      toolCalls,
      async (acc, toolCall) => {
        d('Calling tool: %o', toolCall)
        const toolResp = await client.callTool({
          name: toolCall.name,
          arguments: toolCall.input as Record<string, any>,
        })

        acc.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: (toolResp.content as string) ?? [],
        })
        return acc
      },
      [] as ContentBlockParam[]
    )

    msgs.push({ role: 'user', content: toolResults })
  }

  return msgs
}
