import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { firstValueFrom, toArray } from 'rxjs'
import { z } from 'zod'

import pkg from '../../package.json'
import { messagesToString } from '../../shared/api'
import { w } from '../logging'
import { agenticReminders } from '../prompts'
import { AutomationRuntime } from '../workflow/automation-runtime'
import { createCallServiceServer } from './call-service'

const d = debug('b:home-assistant')

export function createHomeAssistantServer(
  runtime: AutomationRuntime,
  opts: {
    testMode?: boolean
    schedulerMode?: boolean
    megaServer?: McpServer
  } = {}
) {
  const testMode = opts?.testMode ?? false
  const schedulerMode = opts?.schedulerMode ?? false

  const server =
    opts?.megaServer ??
    new McpServer({
      name: 'home-assistant',
      version: pkg.version,
    })

  server.tool(
    'get-entities-by-domain',
    'List all Home Assistant entities that match a given domain or array of domains',
    {
      domains: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity domain or array of domains to match (e.g. "light", "switch", "person")'
        ),
    },
    async ({ domains }) => {
      try {
        const prefixMap = Object.fromEntries(
          (Array.isArray(domains) ? domains : [domains]).map((k) => [
            k.replace('.', ''),
            true,
          ])
        )

        const states = runtime.api.filterUncommonEntities(
          await runtime.api.fetchStates()
        )

        const matchingStates = Object.keys(states).filter(
          (id) => prefixMap[id.replace(/\..*$/, '')]
        )

        d('get-entities-by-prefix: %o', matchingStates)
        return {
          content: [{ type: 'text', text: JSON.stringify(matchingStates) }],
        }
      } catch (err: any) {
        w('get-entities-by-prefix Error:', err)

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
        const ids = Array.isArray(entity_ids) ? entity_ids : [entity_ids]
        const states = await runtime.api.fetchStates()

        const entityState = ids.map((x) => states[x])

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
        w('get-state-for-entity Error:', err)

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
    {
      // Empty object with an optional dummy parameter to satisfy OpenAI requirements
      dummy: z.string().optional().describe('Unused parameter'),
    },
    async () => {
      try {
        const allStates = await runtime.api.fetchStates()
        const states = Object.keys(
          runtime.api.filterUncommonEntities(allStates)
        )

        d('get-all-entities: %d entities', states.length)
        return {
          content: [{ type: 'text', text: JSON.stringify(states) }],
        }
      } catch (err: any) {
        w('get-all-entities Error:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  // In scheduler mode, we cannot call services, only do read-only operations
  // on Home Assistant
  if (!schedulerMode) {
    server.tool(
      'call-service',
      'Asks an entity or multiple entities to do a specific task in plain English. The returned value will be the new entity states',
      {
        prompt: z
          .string()
          .describe(
            'An english description of what operation the entity should perform'
          ),
        entity_ids: z
          .union([z.string(), z.array(z.string())])
          .describe(
            'The entity ID or array of entity IDs to perform the action on (e.g. "light.living_room", ["light.living_room", "light.kitchen"])'
          ),
      },
      async ({ prompt, entity_ids }) => {
        let msgs: MessageParam[] | undefined = undefined
        const ids = Array.isArray(entity_ids) ? entity_ids : [entity_ids]

        try {
          let serviceCalledCount = 0
          const tools = [
            createCallServiceServer(runtime, () => serviceCalledCount++, {
              testMode,
            }),
          ]

          msgs = await firstValueFrom(
            runtime.llm
              .executePromptWithTools(
                callServicePrompt(prompt, entity_ids),
                tools
              )
              .pipe(toArray())
          )

          if (serviceCalledCount < 1) {
            throw new Error('callService not called!')
          }

          const newState = await runtime.api.fetchStates()
          const entityStates = ids.map((x) => newState[x])

          return {
            content: [{ type: 'text', text: JSON.stringify(entityStates) }],
          }
        } catch (err: any) {
          w('call-service Error:', err)
          w('msgs:', messagesToString(msgs ?? []))

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
  }

  return server
}

export const callServicePrompt = (
  prompt: string,
  entity_id: string | string[]
) => `
# Home Assistant Entity Control Assistant

You are an assistant specialized in controlling Home Assistant entities through natural language requests. Your goal is to translate user requests into the appropriate Home Assistant service calls using the MCP server tools available to you.

${agenticReminders}

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
