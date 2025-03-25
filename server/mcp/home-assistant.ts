import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Connection } from 'home-assistant-js-websocket'
import {
  connectToHAWebsocket,
  fetchStates,
  filterUncommonEntities,
} from '../lib/ha-ws-api'
import { configDotenv } from 'dotenv'
import { z } from 'zod'
import debug from 'debug'
import { createDefaultLLMProvider, LargeLanguageProvider } from '../llm'
import { createCallServiceServer } from './call-service'
import { messagesToString } from '../../shared/prompt'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { firstValueFrom, toArray } from 'rxjs'

const d = debug('ha:home-assistant')

export function createHomeAssistantServer(
  connection: Connection,
  llm: LargeLanguageProvider,
  opts?: { testMode: boolean }
) {
  const testMode = opts?.testMode ?? false

  const server = new McpServer({
    name: 'home-assistant',
    version: pkg.version,
  })

  server.tool(
    'get-entities-by-prefix',
    'List all Home Assistant entities that match a given prefix or array of prefixes',
    {
      prefixes: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity prefix or array of prefixes to match (e.g. "light.", "switch.", "person.")'
        ),
    },
    async ({ prefixes }) => {
      try {
        const prefixMap = Object.fromEntries(
          (Array.isArray(prefixes) ? prefixes : [prefixes]).map((k) => [
            k.replace('.', ''),
            true,
          ])
        )

        const states = filterUncommonEntities(await fetchStates(connection))

        const matchingStates = states
          .filter((state) => prefixMap[state.entity_id.replace(/\..*$/, '')])
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
    'Get the full state including all attributes for a specific Home Assistant entity or array of entities',
    {
      entity_ids: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity ID or array of IDs to get state for (e.g. "light.living_room", "person.john")'
        ),
    },
    async ({ entity_ids }) => {
      try {
        const ids = Object.fromEntries(
          (Array.isArray(entity_ids) ? entity_ids : [entity_ids]).map((k) => [
            k,
            true,
          ])
        )
        const states = await fetchStates(connection)
        const entityState = states.filter((state) => ids[state.entity_id])

        if (entityState.length !== Object.keys(ids).length) {
          throw new Error(
            `Entity not found. Please check the entity ID and try again.`
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

  server.tool(
    'call-service',
    'Asks an entity or multiple entities to do a specific task in plain English',
    {
      prompt: z
        .string()
        .describe(
          'An english description of what operation the entity should perform'
        ),
      entity_id: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity ID or array of entity IDs to perform the action on (e.g. "light.living_room", ["light.living_room", "light.kitchen"])'
        ),
    },
    async ({ prompt, entity_id }) => {
      let msgs: MessageParam[] | undefined = undefined

      try {
        let serviceCalledCount = 0
        const tools = [
          createCallServiceServer(connection, () => serviceCalledCount++, {
            testMode,
          }),
        ]
        msgs = await firstValueFrom(
          llm
            .executePromptWithTools(callServicePrompt(prompt, entity_id), tools)
            .pipe(toArray())
        )

        if (serviceCalledCount < 1) {
          throw new Error('callService not called!')
        }

        return {
          content: [
            { type: 'text', text: 'The operation completed successfully' },
          ],
        }
      } catch (err: any) {
        d('call-service Error: %s', err)
        d('msgs: %s', messagesToString(msgs ?? []))

        const lastMsg = msgs
          ? messagesToString([msgs[msgs.length - 1]])
          : '(no messages)'

        return {
          content: [
            {
              type: 'text',
              text: `${err.toString()}\n${lastMsg}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  return server
}

export const callServicePrompt = (
  prompt: string,
  entity_id: string | string[]
) => `
# Home Assistant Entity Control Assistant

You are an assistant specialized in controlling Home Assistant entities through natural language requests. Your goal is to translate user requests into the appropriate Home Assistant service calls using the MCP server tools available to you.

## Your Task

You will receive:
- A natural language request in <task>...</task> tags
- One or more Home Assistant entity IDs in <entity_id>...</entity_id> tags

<task>Turn the living room lights to 50% brightness and make them warm white</task>
<entity_id>light.living_room</entity_id>

## Understanding Your Tools

You have access to the following tools:

1. 'list-services-for-entity' - Lists all available services for a specific entity domain
2. 'call-service' - Executes a specific service on one or multiple Home Assistant entities

## Your Process Flow

For the task and entity/entities provided within the XML tags, follow these steps:

1. **Extract the entity domain** from the entity_id(s) (the part before the period)
   - Example: "light" from "light.living_room"
   - If multiple entities are provided, identify if they share the same domain

2. **List available services** for the entity domain using 'list-services-for-entity'
   - Use the entity domain as the prefix (e.g., "light.", "switch.", "climate.")

3. **Analyze the task description** to identify:
   - The desired action (turn on, turn off, change color, etc.)
   - Any specific parameters (brightness level, color, temperature, etc.)

4. **Identify the appropriate service** based on the task
   - Match the desired action to available services (e.g., "turn_on", "turn_off", "set_temperature")

5. **Execute the service call** using 'call-service' with the correct parameters:
   - domain: The entity domain extracted from the entity_id
   - service: The specific service to call
   - entity_id: The entity ID or array of entity IDs provided
   - service_data: Any additional parameters required for the service

6. **For multiple entities:**
   - If the entities are of the same domain, you can pass them as an array to a single call-service operation
   - If the entities are of different domains, make separate service calls for each domain

## Input

<entity_id>${JSON.stringify(entity_id)}</entity_id>

<task>
${prompt}
</task>
`

const prefix = process.platform === 'win32' ? 'file:///' : 'file://'
const isMainModule =
  import.meta.url === `${prefix}${process.argv[1].replaceAll('\\', '/')}`

async function main() {
  const connection = await connectToHAWebsocket()
  const llm = createDefaultLLMProvider()
  const server = createHomeAssistantServer(connection, llm)

  await server.connect(new StdioServerTransport())
}

if (isMainModule) {
  configDotenv()

  main().catch((err) => {
    console.log('Error:', err)
    process.exit(1)
  })
}
