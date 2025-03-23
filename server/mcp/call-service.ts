import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Connection } from 'home-assistant-js-websocket'
import {
  connectToHAWebsocket,
  callService,
  fetchServices,
  fetchStates,
} from '../lib/ha-ws-api'
import { configDotenv } from 'dotenv'
import { z } from 'zod'
import debug from 'debug'

const d = debug('ha:call-service')

export function createCallServiceServer(
  connection: Connection,
  onCallService: (
    domain: string,
    service: string,
    target: string,
    data: any
  ) => unknown,
  opts?: { testMode: boolean }
) {
  const testMode = opts?.testMode ?? false
  const server = new McpServer({
    name: 'call-service',
    version: pkg.version,
  })

  server.tool(
    'list-services-for-entity',
    'List all Home Assistant services that match a given entity prefix',
    {
      entity_prefix: z
        .string()
        .describe(
          'The entity prefix to match (e.g. "light.", "switch.", "climate.")'
        ),
    },
    async ({ entity_prefix }) => {
      try {
        const services = await fetchServices(connection)
        const matchingServices = Object.entries(services)
          .filter(([domain]) => domain === entity_prefix.replace('.', ''))
          .reduce((acc, [domain, services]) => {
            return {
              ...acc,
              [domain]: services,
            }
          }, {})

        d('list-services-for-entity: %o', matchingServices)
        return {
          content: [{ type: 'text', text: JSON.stringify(matchingServices) }],
        }
      } catch (err: any) {
        d('list-services-for-entity Error: %s', err)
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'call-service',
    'Call any Home Assistant service for a specific entity or a list of entities. Response contains the new state of the entities.',
    {
      domain: z
        .string()
        .describe(
          'The domain of the service (e.g. "light", "switch", "climate")'
        ),
      service: z
        .string()
        .describe(
          'The service to call (e.g. "turn_on", "turn_off", "set_temperature")'
        ),
      entity_id: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity ID or array of entity IDs to call the service on'
        ),
      service_data: z
        .record(z.any())
        .optional()
        .describe('Additional data to send with the service call'),
    },
    async ({ domain, service, entity_id, service_data }) => {
      try {
        const entityIds = Array.isArray(entity_id) ? entity_id : [entity_id]

        for (const id of entityIds) {
          let targetObj = { entity_id: id }

          d(
            'call-service: domain=%s, service=%s, target=%o, data=%o',
            domain,
            service,
            targetObj,
            service_data
          )

          await callService(
            connection,
            {
              domain,
              service,
              target: targetObj,
              service_data,
            },
            testMode
          )

          onCallService?.(domain, service, id, service_data)
        }

        const states = await fetchStates(connection)
        const needles = Object.fromEntries(entityIds.map((k) => [k, true]))
        const stateInfo = states.reduce(
          (acc, x) => {
            if (!needles[x.entity_id]) return acc

            acc[x.entity_id] = {
              state: x.state,
              attributes: x.attributes,
            }

            return acc
          },
          {} as Record<string, any>
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, states: stateInfo }),
            },
          ],
        }
      } catch (err: any) {
        d('call-service Error: %s', err)
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}

const prefix = process.platform === 'win32' ? 'file:///' : 'file://'
const isMainModule =
  import.meta.url === `${prefix}${process.argv[1].replaceAll('\\', '/')}`

async function main() {
  const connection = await connectToHAWebsocket()
  const server = createCallServiceServer(connection, () => {})

  await server.connect(new StdioServerTransport())
}

if (isMainModule) {
  configDotenv()

  main().catch((err) => {
    console.log('Error:', err)
    process.exit(1)
  })
}
