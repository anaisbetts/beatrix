import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import debug from 'debug'
import { Kysely } from 'kysely'
import { Schema } from '../db-schema'
import { z } from 'zod'
import {
  StateRegexTrigger,
  CronTrigger,
  RelativeTimeTrigger,
  AbsoluteTimeTrigger,
} from '../../shared/types'

const d = debug('ha:scheduler')

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
      d(
        'creating relative time trigger for automation hash: %s, offset: %d seconds, repeat: %s',
        automationHash,
        offset_in_seconds
      )
      try {
        const data: RelativeTimeTrigger = {
          type: 'offset',
          offsetInSeconds: offset_in_seconds,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            type: 'offset',
            data: JSON.stringify(data),
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Trigger created' }],
        }
      } catch (e: any) {
        d('error creating relative time trigger: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
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
      d(
        'creating absolute time trigger for automation hash: %s, times: %o',
        automationHash,
        time
      )
      try {
        const times = Array.isArray(time) ? time : [time]

        const values = times.map((iso8601Time) => ({
          automationHash,
          type: 'time',
          data: JSON.stringify({
            type: 'time',
            iso8601Time,
          } as AbsoluteTimeTrigger),
        }))

        await db.insertInto('signals').values(values).execute()

        return {
          content: [
            {
              type: 'text',
              text: `Trigger${times.length > 1 ? 's' : ''} created`,
            },
          ],
        }
      } catch (e: any) {
        d('error creating absolute time trigger: %o', e)
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
