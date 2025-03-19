import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Connection, HassServices } from 'home-assistant-js-websocket'
import { connectToHAWebsocket, fetchServices } from '../ha-ws-api'
import { configDotenv } from 'dotenv'
import { z } from 'zod'
import debug from 'debug'

const prefix = process.platform === 'win32' ? 'file:///' : 'file://'
const check = `${prefix}${process.argv[1].replaceAll('\\', '/')}`
const isMainModule = import.meta.url === check

const d = debug('ha:notify')

export async function extractNotifiers(svcs: HassServices) {
  return Object.keys(svcs.notify).reduce(
    (acc, k) => {
      if (k === 'persistent_notification' || k === 'send_message') {
        return acc
      }

      const service = svcs.notify[k]
      acc.push({ name: k, description: service.name! })
      return acc
    },
    [] as { name: string; description: string }[]
  )
}

export function createNotifyServer(connection: Connection) {
  const server = new McpServer({
    name: 'notify',
    version: pkg.version,
  })

  server.tool(
    'list-notify-targets',
    'List all Home Assistant devices that can receive notifications',
    {},
    async () => {
      try {
        const svcs = await fetchServices(connection)
        const resp = await extractNotifiers(svcs)

        d('list-notify-targets: %o', resp)
        return {
          content: [{ type: 'text', text: JSON.stringify(resp) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'send-notification',
    'Send a notification to a Home Assistant device',
    { target: z.string(), message: z.string(), title: z.string().optional() },
    async ({ target, message, title }) => {
      try {
        d('send-notification: %s %s', target, message)
        await connection.sendMessagePromise({
          type: 'call_service',
          domain: 'notify',
          service: target,
          service_data: { message, ...(title ? { title } : {}) },
        })

        return {
          content: [{ type: 'text', text: 'Notification sent' }],
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}

async function main() {
  const connection = await connectToHAWebsocket()
  const server = createNotifyServer(connection)

  server.connect(new StdioServerTransport())
}

if (isMainModule) {
  configDotenv()

  main().catch((err) => {
    console.log('Error:', err)
    process.exit(1)
  })
}
