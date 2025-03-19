import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Connection } from 'home-assistant-js-websocket'
import { connectToHAWebsocket, fetchServices } from '../ha-ws-api'
import { configDotenv } from 'dotenv'

const prefix = process.platform === 'win32' ? 'file:///' : 'file://'
const check = `${prefix}${process.argv[1].replaceAll('\\', '/')}`
const isMainModule = import.meta.url === check

export function createNotifyServer(connection: Connection) {
  const server = new McpServer({
    name: 'notify',
    version: pkg.version,
  })

  server.tool(
    'list-notify-targets',
    'List all devices that can receive notifications',
    {},
    async () => {
      const svcs = await fetchServices(connection)

      const result = Object.keys(svcs.notify.Services).reduce(
        (acc, k) => {
          if (k === 'persistent_notification' || k === 'send_message') {
            return acc
          }

          const service = svcs.notify.Services[k]

          acc[k] = { name: service.name, description: service.description }
          return acc
        },
        {} as Record<string, { name: string; description: string }>
      )

      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
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
