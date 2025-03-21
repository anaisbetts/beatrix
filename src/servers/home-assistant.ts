import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Connection } from 'home-assistant-js-websocket'
import {
  connectToHAWebsocket,
  fetchStates,
  filterUncommonEntities,
} from '../ha-ws-api'
import { configDotenv } from 'dotenv'
import { z } from 'zod'
import debug from 'debug'

const d = debug('ha:home-assistant')

export function createHomeAssistantServer(
  connection: Connection,
  opts?: { testMode: boolean }
) {
  const testMode = opts?.testMode ?? false
  d('go away linter', testMode)
  const server = new McpServer({
    name: 'home-assistant',
    version: pkg.version,
  })

  server.tool(
    'get-entities-by-prefix',
    'List all Home Assistant entities that match a given prefix',
    {
      prefix: z
        .string()
        .describe(
          'The entity prefix to match (e.g. "light.", "switch.", "person.")'
        ),
    },
    async ({ prefix }) => {
      try {
        const states = filterUncommonEntities(await fetchStates(connection))

        const matchingStates = states
          .filter((state) => state.entity_id.startsWith(prefix))
          .map((x) => x.entity_id)

        d('get-entities-by-prefix: %o', matchingStates)
        return {
          content: [{ type: 'text', text: JSON.stringify(matchingStates) }],
        }
      } catch (err: any) {
        d('get-entities-by-prefix Error: %s', err)
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'get-state-for-entity',
    'Get the full state including all attributes for a specific Home Assistant entity',
    {
      entity_id: z
        .string()
        .describe(
          'The entity ID to get state for (e.g. "light.living_room", "person.john")'
        ),
    },
    async ({ entity_id }) => {
      try {
        const states = await fetchStates(connection)
        const entityState = states.find(
          (state) => state.entity_id === entity_id
        )

        if (!entityState) {
          throw new Error(
            `Entity ${entity_id} not found. Please check the entity ID and try again.`
          )
        }

        d('get-state-for-entity: %o', entityState)
        return {
          content: [{ type: 'text', text: JSON.stringify(entityState) }],
        }
      } catch (err: any) {
        d('get-state-for-entity Error: %s', err)
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'get-all-entities',
    'Get a filtered list of all Home Assistant entities, excluding uncommon or utility entities',
    async () => {
      try {
        const allStates = await fetchStates(connection)
        const states = filterUncommonEntities(allStates).map((x) => x.entity_id)

        d('get-all-entities: %d entities', states.length)
        return {
          content: [{ type: 'text', text: JSON.stringify(states) }],
        }
      } catch (err: any) {
        d('get-all-entities Error: %s', err)
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
  const server = createHomeAssistantServer(connection)

  await server.connect(new StdioServerTransport())
}

if (isMainModule) {
  configDotenv()

  main().catch((err) => {
    console.log('Error:', err)
    process.exit(1)
  })
}
