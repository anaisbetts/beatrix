import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { exists, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import pkg from '../../package.json'
import { w } from '../logging'
import {
  AutomationRuntime,
  getCueDirectory,
} from '../workflow/automation-runtime'

const d = debug('b:cue')

const desc = `
If a user's instructions appear to be referencing the future, or would be
suitable to create a future automation, use this tool to create a new one-time
automation since it cannot be done immediately. If an action can be performed
immediately, do NOT USE this tool.

An example of these instructions would be something like, "The next time Jane gets home,
tell her that she got a letter"
`

export function createCueServer(
  runtime: AutomationRuntime,
  opts: {
    testMode?: boolean
    megaServer?: McpServer
  } = {}
) {
  if (!runtime.notebookDirectory) {
    throw new Error('Cannot create cue server without notebook!')
  }

  const cueDir = getCueDirectory(runtime)
  d('creating cue server with path %s', cueDir)

  const server =
    opts.megaServer ??
    new McpServer({
      name: 'cue',
      version: pkg.version,
    })

  server.tool(
    'create-automation-cue',
    desc,
    {
      automation: z
        .string()
        .describe('The home automation to create, in English text'),
    },
    async ({ automation }) => {
      try {
        const targetFile = path.join(cueDir, 'via-chat.md')

        if (!opts.testMode) {
          if (await exists(targetFile)) {
            await writeFile(targetFile, `\n---\n${automation}`, {
              flag: 'a',
              encoding: 'utf8',
            })
          } else {
            await writeFile(targetFile, automation, 'utf8')
          }
        } else {
          w(
            `Would've created automation, but we are in test mode: ${automation}`
          )
        }

        return {
          content: [{ type: 'text', text: 'Automation successfully created' }],
        }
      } catch (err: any) {
        w('create-automation-cue Error:', err)

        return {
          content: [{ type: 'text', text: err.toString() }],
          isError: true,
        }
      }
    }
  )

  return server
}
