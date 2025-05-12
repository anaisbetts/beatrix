import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { Kysely } from 'kysely'
import { DateTime } from 'luxon'
import { z } from 'zod'

import pkg from '../../package.json'
import {
  AbsoluteTimeSignal,
  CronSignal,
  RelativeTimeSignal,
  StateRangeSignal,
  StateRegexSignal,
} from '../../shared/types'
import { Schema } from '../db-schema'
import { formatDateForLLM, parseDateFromLLM } from '../lib/date-utils'
import { HomeAssistantApi } from '../lib/ha-ws-api'
import { i, w } from '../logging'

const d = debug('b:scheduler')

export function createSchedulerServer(
  db: Kysely<Schema>,
  automationHash: string,
  timezone: string,
  api?: HomeAssistantApi // Optional HA API for fetching entity states
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
      delay: z
        .number()
        .optional()
        .describe(
          'The amount of time that the trigger must stay in the matching state before the automation is triggered.'
        ),
      execution_notes: z
        .string()
        .optional()
        .describe(
          'Relevant information to pass along to the LLM when executing this automation. Only fill in directly relevant information from saved memory, and only if needed.'
        ),
    },
    async ({ entity_ids, regex, delay, execution_notes }) => {
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
          delay,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            createdAt: now(timezone).toISO()!,
            type: 'state',
            data: JSON.stringify(data),
            isDead: false,
            executionNotes: execution_notes ?? '',
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

  const currentTimeFormatted = formatDateForLLM(now(timezone))

  server.tool(
    'create-cron-trigger',
    `Create a new trigger for an automation based on a cron schedule. The current local time is ${currentTimeFormatted}. Use this as a reference if needed for calculating cron schedules.`,
    {
      cron: z
        .string()
        .describe(
          'The cron schedule to use. Note that extremely rapid firing jobs will be limited.'
        ),
      execution_notes: z
        .string()
        .optional()
        .describe(
          'Relevant information to pass along to the LLM when executing this automation. Only fill in directly relevant information from saved memory, and only if needed.'
        ),
    },
    async ({ cron, execution_notes }) => {
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
            createdAt: now(timezone).toISO()!,
            automationHash,
            type: 'cron',
            data: JSON.stringify(data),
            isDead: false,
            executionNotes: execution_notes ?? '',
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
          .where('isDead', '!=', true)
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
          .updateTable('signals')
          .where('automationHash', '=', automationHash)
          .set({ isDead: true })
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
      execution_notes: z
        .string()
        .optional()
        .describe(
          'Relevant information to pass along to the LLM when executing this automation. Only fill in directly relevant information from saved memory, and only if needed.'
        ),
    },
    async ({ offset_in_seconds, execution_notes }) => {
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
            createdAt: now(timezone).toISO()!,
            automationHash,
            type: 'offset',
            data: JSON.stringify(data),
            isDead: false,
            executionNotes: execution_notes ?? '',
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
    'Create a new trigger for an automation that fires at a specific date and time.',
    {
      time: z
        .union([z.string(), z.array(z.string())])
        .describe(
          'The local date and time(s) when the trigger should fire, in "YYYY-MM-DD HH:MM:SS" format (e.g., "2025-04-01 18:30:00" or ["2025-04-02 08:00:00", "2025-04-03 17:30:00"]). This time will be interpreted according to the user\'s configured timezone.'
        ),
      execution_notes: z
        .string()
        .optional()
        .describe(
          'Relevant information to pass along to the LLM when executing this automation. Only fill in directly relevant information from saved memory, and only if needed.'
        ),
    },
    async ({ time, execution_notes }) => {
      const times = Array.isArray(time) ? time : [time]
      i(
        `Creating absolute time trigger for automation ${automationHash}: times ${JSON.stringify(times)}`
      )

      try {
        const values = times.map((localTimeStr) => {
          // Parse the local time string using the user's timezone
          const date = parseDateFromLLM(localTimeStr, timezone)
          const iso8601Time = date.toISO() // Convert to ISO string for storage

          // Construct the data part first
          const signalData: AbsoluteTimeSignal = {
            type: 'time',
            iso8601Time: iso8601Time!, // Use the parsed and converted time
          }

          // Construct the full object for the database insert
          const dbValue = {
            createdAt: now(timezone).toISO()!,
            automationHash,
            type: 'time' as const,
            isDead: false,
            data: JSON.stringify(signalData),
            executionNotes: execution_notes ?? '',
          }
          return dbValue
        })

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

  server.tool(
    'create-state-range-trigger',
    "Create a new trigger for an automation based on a Home Assistant entity's numeric state staying within a specific range for a duration of time.",
    {
      entity_id: z
        .string()
        .describe(
          'The entity ID to monitor for numeric state values (e.g. "sensor.temperature", "input_number.brightness")'
        ),
      min: z
        .number()
        .describe('The minimum value (inclusive) of the range to monitor'),
      max: z
        .number()
        .describe('The maximum value (inclusive) of the range to monitor'),
      duration_seconds: z
        .number()
        .describe(
          'The number of seconds the state must continuously stay within the range before triggering'
        ),
      execution_notes: z
        .string()
        .optional()
        .describe(
          'Relevant information to pass along to the LLM when executing this automation. Only fill in directly relevant information from saved memory, and only if needed.'
        ),
    },
    async ({ entity_id, min, max, duration_seconds, execution_notes }) => {
      i(
        `Creating state range trigger for automation ${automationHash}: entity ${entity_id}, range [${min}, ${max}], duration ${duration_seconds}s`
      )
      try {
        if (min >= max) {
          throw new Error(
            `Invalid range: min (${min}) must be less than max (${max})`
          )
        }

        if (duration_seconds <= 0) {
          throw new Error(
            `Invalid duration: ${duration_seconds} seconds must be greater than 0`
          )
        }

        // Check if we can validate the current entity state
        if (api) {
          try {
            // Fetch the current states from Home Assistant
            const states = await api.fetchStates()
            const entityState = states[entity_id]

            // If the entity exists, validate that its state is a number
            if (entityState) {
              const numericValue = parseFloat(entityState.state)
              if (isNaN(numericValue)) {
                throw new Error(
                  `Entity ${entity_id} current state "${entityState.state}" is not a number. Cannot create a numeric range trigger for a non-numeric state.`
                )
              }

              // Log the current value to help with debugging
              i(`Current value for ${entity_id} is ${numericValue}`)

              // Optionally provide some guidance if the current value is outside the range
              if (numericValue < min || numericValue > max) {
                i(
                  `Note: Current value ${numericValue} is outside the specified range [${min}, ${max}]`
                )
              }
            } else {
              i(
                `Warning: Entity ${entity_id} not found in Home Assistant. Unable to validate if state is numeric.`
              )
            }
          } catch (stateErr) {
            // Just log the warning but don't prevent creating the trigger
            w(
              `Warning: Could not verify if ${entity_id} state is numeric:`,
              stateErr
            )
          }
        } else {
          i(
            `No Home Assistant API provided to scheduler, cannot validate entity ${entity_id} state`
          )
        }

        const data: StateRangeSignal = {
          type: 'range',
          entityId: entity_id,
          min,
          max,
          durationSeconds: duration_seconds,
        }

        await db
          .insertInto('signals')
          .values({
            automationHash,
            createdAt: now(timezone).toISO()!,
            type: 'range',
            data: JSON.stringify(data),
            isDead: false,
            executionNotes: execution_notes ?? '',
          })
          .execute()

        return {
          content: [{ type: 'text', text: 'Signal created' }],
        }
      } catch (err: any) {
        w('error creating state range signal:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}

export function now(timezone: string): DateTime {
  return DateTime.now().setZone(timezone)
}
