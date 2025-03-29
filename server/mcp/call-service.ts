import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { configDotenv } from 'dotenv'
import { z } from 'zod'
import debug from 'debug'
import { HomeAssistantApi, LiveHomeAssistantApi } from '../lib/ha-ws-api'

const d = debug('ha:call-service')

export function createCallServiceServer(
  api: HomeAssistantApi,
  onCallService: (
    domain: string,
    service: string,
    target: string,
    data: any
  ) => unknown,
  opts: { testMode?: boolean } = {}
) {
  const testMode = opts?.testMode ?? false
  const server = new McpServer({
    name: 'call-service',
    version: pkg.version,
  })

  server.tool(
    'list-services-for-entities',
    'List all Home Assistant services that match a given entity or list of entities',
    {
      entity_ids: z
        .union([z.string(), z.array(z.string())])
        .describe('The entity to find services for (e.g. "light.living_room")'),
    },
    async ({ entity_ids }) => {
      try {
        const needles = Object.fromEntries(
          (Array.isArray(entity_ids) ? entity_ids : [entity_ids]).map((x) => [
            x.replace(/\..*$/, ''),
            true,
          ])
        )
        const services = await api.fetchServices()

        const matchingServices = Object.keys(services).reduce(
          (acc, k) => {
            if (!needles[k]) return acc

            acc[k] = services[k]
            return acc
          },
          {} as Record<string, any>
        )

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

  // NB: In test-mode so that we don't confuse evals that see that the state
  // didn't actually change, we're gonna return a simple "yep it worked"
  const callServiceDescription = testMode
    ? 'Call any Home Assistant service for a specific entity or a list of entities. Response will indicate success.'
    : 'Call any Home Assistant service for a specific entity or a list of entities. Response contains the new state of the entities.'

  server.tool(
    'call-service',
    callServiceDescription,
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

          await api.callService(
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

        if (testMode) {
          d('Returning faked value for call-service in test mode')
          return {
            content: [
              {
                type: 'text',
                text: 'The operation completed successfully.',
              },
            ],
          }
        }

        const states = await api.fetchStates()
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
  const api = await LiveHomeAssistantApi.createViaEnv()
  const server = createCallServiceServer(api, () => {})

  await server.connect(new StdioServerTransport())
}

if (isMainModule) {
  configDotenv()

  main().catch((err) => {
    console.log('Error:', err)
    process.exit(1)
  })
}
