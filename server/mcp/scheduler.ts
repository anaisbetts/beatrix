import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { Kysely } from 'kysely'
import { z } from 'zod'

import pkg from '../../package.json'
import {
  AbsoluteTimeSignal,
  CronSignal,
  RelativeTimeSignal,
  StateRegexSignal,
} from '../../shared/types'
import { Schema } from '../db-schema'
import { i, w } from '../logging'

const d = debug('b:scheduler')

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
      i(
        `Creating state regex trigger for automation ${automationHash}: entities ${JSON.stringify(entity_ids)}, regex /${regex}/i`
      )
      try {
        const ids = Object.fromEntries(
          (Array.isArray(entity_ids) ? entity_ids : [entity_ids]).map((k) => [
            k,
            true,
          ])
        )

        const data: StateRegexSignal = {
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
            isDead: false,
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Signal created' }],
        }
      } catch (err: any) {
        w('error creating state regex signal:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
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
      i(
        `Creating cron trigger for automation ${automationHash}: cron "${cron}"`
      )
      try {
        const data: CronSignal = {
          type: 'cron',
          cron,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            type: 'cron',
            data: JSON.stringify(data),
            isDead: false,
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Signal created' }],
        }
      } catch (err: any) {
        w('error creating cron trigger:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
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
      i(`Listing scheduled triggers for automation ${automationHash}`)
      try {
        const rows = await db
          .selectFrom('signals')
          .where('automationHash', '=', automationHash)
          .select(['id', 'type', 'data'])
          .execute()

        i(
          `Found ${rows.length} scheduled triggers for automation ${automationHash}`
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(rows) }],
        }
      } catch (err: any) {
        w('error listing scheduled triggers:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
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
      i(`Cancelling all scheduled triggers for automation ${automationHash}`)
      try {
        const rows = await db
          .deleteFrom('signals')
          .where('automationHash', '=', automationHash)
          .execute()

        i(
          `Cancelled ${rows.length} scheduled triggers for automation ${automationHash}`
        )
        return {
          content: [
            {
              type: 'text',
              text: `Cancelled ${rows.length} scheduled triggers`,
            },
          ],
        }
      } catch (err: any) {
        w('error cancelling scheduled triggers:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'create-relative-time-trigger',
    'Create a new trigger for an automation that fires after a specified time offset.',
    {
      offset_in_seconds: z
        .number()
        .describe(
          'The time offset in seconds after which the trigger will fire'
        ),
    },
    async ({ offset_in_seconds }) => {
      i(
        `Creating relative time trigger for automation ${automationHash}: offset ${offset_in_seconds} seconds`
      )
      try {
        const data: RelativeTimeSignal = {
          type: 'offset',
          offsetInSeconds: offset_in_seconds,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            type: 'offset',
            data: JSON.stringify(data),
            isDead: false,
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Signal created' }],
        }
      } catch (err: any) {
        w('error creating relative time trigger:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'create-absolute-time-trigger',
    'Create a new trigger for an automation that fires at specified ISO 8601 date and time(s).',
    {
      time: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The ISO 8601 date and time(s) when the trigger should fire (e.g. "2025-04-01T18:30:00Z" or ["2025-04-02T08:00:00Z", "2025-04-03T17:30:00Z"])'
        ),
    },
    async ({ time }) => {
      const times = Array.isArray(time) ? time : [time]
      i(
        `Creating absolute time trigger for automation ${automationHash}: times ${JSON.stringify(times)}`
      )

      try {
        const values = times.map((iso8601Time) => ({
          automationHash,
          type: 'time',
          isDead: false,
          data: JSON.stringify({
            type: 'time',
            iso8601Time,
          } as AbsoluteTimeSignal),
        }))

        await db.insertInto('signals').values(values).execute()

        return {
          content: [
            {
              type: 'text',
              text: `${times.length} Signals created`,
            },
          ],
        }
      } catch (err: any) {
        w('error creating absolute time signal:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
