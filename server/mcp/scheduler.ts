import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import debug from 'debug'
import { Kysely } from 'kysely'
import { Schema } from '../db-schema'

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
