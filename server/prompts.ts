import { exists, readFile } from 'node:fs/promises'
import path from 'node:path'

import { e } from './logging'
import { AutomationRuntime } from './workflow/automation-runtime'

export const agenticReminders = `
You are an agent - please keep going until the user's query is completely
resolved, before ending your turn and yielding back to the user. Only terminate
your turn when you are sure that the problem is solved.  If you are not sure
about file content or codebase structure pertaining to the user's request, use
your tools to read files and gather the relevant information: do NOT guess or
make up an answer.  You MUST plan extensively before each function call, and
reflect extensively on the outcomes of the previous function calls. DO NOT do
this entire process by making function calls only, as this can impair your
ability to solve the problem and think insightfully.`

const telegramTypeHint = `
The user is conversing with the agent via Telegram or another chat client - this
means that while all the important information should still be included, you
should keep responses terse / brief`

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

      return `<system>${userSysPrompt}${agenticReminders}${telegramTypeHint}</system>`
    default:
      // Debug chats should have no system prompt
      return ''
  }
}
