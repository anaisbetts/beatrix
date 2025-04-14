import { exists, readFile } from 'node:fs/promises'
import path from 'node:path'

import { e } from './logging'
import { AutomationRuntime } from './workflow/automation-runtime'

export async function getSystemPrompt(
  runtime: AutomationRuntime,
  typeHint: string
) {
  switch (typeHint) {
    case 'chat':
      let userSysPrompt = ''
      const userSysPromptPath = path.join(
        runtime.notebookDirectory ?? '',
        'system.md'
      )

      try {
        if (runtime.notebookDirectory && (await exists(userSysPromptPath))) {
          userSysPrompt = (await readFile(userSysPromptPath, 'utf8')) + '\n'
        }
      } catch (err: any) {
        e(`Failed to read custom system prompt ${userSysPromptPath}`, err)
      }

      return `<system>${userSysPrompt}${telegramTypeHint}</system>`
    default:
      // Debug chats should have no system prompt
      return ''
  }
}

const telegramTypeHint = `
The user is conversing with the agent via Telegram or another chat client - this
means that while all the important information should still be included, you
should keep responses terse / brief`
