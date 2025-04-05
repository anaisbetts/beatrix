import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json'
import {
  extractNotifiers,
  fetchHAUserInformation,
  HomeAssistantApi,
} from '../lib/ha-ws-api'
import { z } from 'zod'
import debug from 'debug'

const d = debug('ha:notify')

export function createNotifyServer(
  api: HomeAssistantApi,
  megaServer?: McpServer
) {
  const server =
    megaServer ??
    new McpServer({
      name: 'notify',
      version: pkg.version,
    })

  server.tool(
    'list-notify-targets',
    'List all Home Assistant devices that can receive notifications. Always call this before calling send-notification.',
    {},
    async () => {
      try {
        const svcs = await api.fetchServices()
        const resp = await extractNotifiers(svcs)

        d('list-notify-targets: %o', resp)
        return {
          content: [{ type: 'text', text: JSON.stringify(resp) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'list-people',
    'List all people registered in Home Assistant with their friendly names, as well as their list of notifiers that can be used to notify them',
    {},
    async () => {
      try {
        const info = await fetchHAUserInformation(api)
        d('list-people: %o', info)

        return {
          content: [{ type: 'text', text: JSON.stringify(info) }],
        }
      } catch (err: any) {
        d('list-people Error: %s', err)
        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'send-notification-to-person',
    'Send a notification to all the devices a person owns. Get the list of people via the list-people tool first',
    {
      target: z
        .string()
        .describe(
          'The name (NOT friendly_name) returned by the list-people tool'
        ),
      message: z.string(),
      title: z.string().optional(),
    },
    async ({ target, message, title }) => {
      try {
        d('send-notification: %s %s', target, message)
        const info = await fetchHAUserInformation(api)

        if (!info[target]) {
          throw new Error(
            `Person ${target} not found. Use the list-people tool to get the list of people`
          )
        }

        const notifiers = info[target].notifiers
        if (notifiers.length === 0) {
          throw new Error("Person doesn't have any notifiers, sorry")
        }

        for (const notifier of notifiers) {
          let lastErr: any
          let errCount = 0

          try {
            await api.sendNotification(notifier, message, title)
          } catch (e) {
            lastErr = e
            errCount++
          }

          // NB: Sometimes people have stale device trackers / notifiers on their
          // account, we should fail if we didn't send a notification to any of them
          if (errCount == notifiers.length) {
            throw lastErr
          }
        }

        return {
          content: [{ type: 'text', text: 'Notifications sent' }],
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify(e) }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'send-notification',
    'Send a notification to a specific Home Assistant device rather than a person. Get the list of devices via the list-notify-targets tool first',
    { target: z.string(), message: z.string(), title: z.string().optional() },
    async ({ target, message, title }) => {
      try {
        d('send-notification: %s %s', target, message)
        await api.sendNotification(target, message, title)

        return {
          content: [{ type: 'text', text: 'Notification sent' }],
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: e.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
