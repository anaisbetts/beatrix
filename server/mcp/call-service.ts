import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { z } from 'zod'

import pkg from '../../package.json'
import { w } from '../logging'
import { AutomationRuntime } from '../workflow/automation-runtime'

const d = debug('b:call-service')

export function createCallServiceServer(
  runtime: AutomationRuntime,
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
        const services = await runtime.api.fetchServices()

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
        w('list-services-for-entity Error:', err)

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

          await runtime.api.callService(
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

        const states = await runtime.api.fetchStates()
        const stateInfo = entityIds.reduce(
          (acc, id) => {
            acc[id] = {
              state: states[id].state,
              attributes: states[id].attributes,
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
        w('call-service Error:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
