import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import debug from 'debug'
import { Kysely } from 'kysely'
import { Schema } from '../db-schema'
import { z } from 'zod'

const d = debug('ha:scheduler')

export type StateRegexTrigger = {
  type: 'state'
  entityIds: string[]
  regex: string
}

export type CronTrigger = {
  type: 'cron'
  cron: string
}

export function createSchedulerServer(
  db: Kysely<Schema>,
  automationHash: string
) {
  d('creating scheduler server for automation hash: %s', automationHash)
  const server = new McpServer({
    name: 'scheduler',
    version: pkg.version,
  })

  server.tool(
    'create-state-regex-trigger',
    "Create a new trigger for an automation based on a Home Assistant entity's state matching a regex.",
    {
      entity_ids: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The entity ID or array of IDs to get state for (e.g. "light.living_room", "person.john")'
        ),
      regex: z
        .string()
        .describe(
          'The regex to match against the entity state. Note that this will be a case-insensitive regex'
        ),
    },
    async ({ entity_ids, regex }) => {
      d(
        'creating state regex trigger for automation hash: %s %o => %s',
        automationHash,
        entity_ids,
        regex
      )
      try {
        const ids = Object.fromEntries(
          (Array.isArray(entity_ids) ? entity_ids : [entity_ids]).map((k) => [
            k,
            true,
          ])
        )

        const data: StateRegexTrigger = {
          type: 'state',
          entityIds: Object.keys(ids),
          regex,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            type: 'state',
            data: JSON.stringify(data),
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Trigger created' }],
        }
      } catch (e: any) {
        d('error creating state regex trigger: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  const currentTimeAsString = new Date().toISOString()

  server.tool(
    'create-cron-trigger',
    `Create a new trigger for an automation based on a cron schedule. The current time/date is ${currentTimeAsString}.`,
    {
      cron: z
        .string()
        .describe(
          'The cron schedule to use. Note that extremely rapid firing jobs will be limited.'
        ),
    },
    async ({ cron }) => {
      d(
        'creating cron trigger for automation hash: %s, %s',
        automationHash,
        cron
      )
      try {
        const data: CronTrigger = {
          type: 'cron',
          cron,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            type: 'cron',
            data: JSON.stringify(data),
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Trigger created' }],
        }
      } catch (e: any) {
        d('error creating cron trigger: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'list-scheduled-triggers',
    'List all current schedules that when triggered, will result in this automation being evaluated.',
    {},
    async () => {
      d('listing scheduled triggers for automation hash: %s', automationHash)
      try {
        const rows = await db
          .selectFrom('signals')
          .where('automationHash', '=', automationHash)
          .select(['id', 'type', 'data'])
          .execute()

        d('found %d scheduled triggers', rows.length)
        return {
          content: [{ type: 'text', text: JSON.stringify(rows) }],
        }
      } catch (e: any) {
        d('error listing scheduled triggers: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'cancel-all-scheduled-triggers',
    'Cancel all active triggers that have been created by this automation',
    {},
    async () => {
      d(
        'cancelling all scheduled triggers for automation hash: %s',
        automationHash
      )
      try {
        const rows = await db
          .deleteFrom('signals')
          .where('automationHash', '=', automationHash)
          .execute()

        d('cancelled %d scheduled triggers', rows.length)
        return {
          content: [
            {
              type: 'text',
              text: `Cancelled ${rows.length} scheduled triggers`,
            },
          ],
        }
      } catch (e: any) {
        d('error cancelling scheduled triggers: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
