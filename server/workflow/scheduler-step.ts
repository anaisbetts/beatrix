import { Kysely } from 'kysely'
import { HomeAssistantApi } from '../lib/ha-ws-api'
import { LargeLanguageProvider } from '../llm'
import { Schema } from '../db-schema'
import { Automation } from './parser'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createHomeAssistantServer } from '../mcp/home-assistant'
import { createSchedulerServer } from '../mcp/scheduler'
import { lastValueFrom } from 'rxjs'

export async function runSchedulerForAutomation(
  api: HomeAssistantApi,
  llm: LargeLanguageProvider,
  db: Kysely<Schema>,
  automation: Automation
) {
  const tools = createDefaultSchedulerTools(api, llm, db, automation)
  await lastValueFrom(
    llm.executePromptWithTools(schedulerPrompt(automation.contents), tools)
  )
}

export function createDefaultSchedulerTools(
  api: HomeAssistantApi,
  llm: LargeLanguageProvider,
  db: Kysely<Schema>,
  automation: Automation
): McpServer[] {
  return [
    createHomeAssistantServer(api, llm, { schedulerMode: true }),
    createSchedulerServer(db, automation.hash),
  ]
}

export const schedulerPrompt = (automation: string) => `
<task>
You are an automation scheduling assistant for Home Assistant. Your job is to analyze the current automation instructions and determine the appropriate scheduling actions needed.

Your primary responsibility is to ensure that automations run at the correct times or in response to the right triggers based on the instructions.
</task>

<automation_instructions>
${automation}
</automation_instructions>

<current_date_time>${new Date().toISOString()}</current_date_time>

<instructions>
Please follow these steps:

1. First, use the list-scheduled-triggers tool to see what schedules are currently active for this automation.
2. Carefully analyze the automation instructions to understand:
   - When the automation should run (time-based triggers)
   - What conditions should trigger the automation (state-based triggers)
   - Any patterns or recurring schedules mentioned
   - Any one-time events that require absolute time scheduling

3. Based on your analysis, determine if:
   - The current triggers are appropriate and sufficient
   - Any triggers need to be removed (using cancel-all-scheduled-triggers)
   - New triggers need to be added

4. If new triggers are needed, select the most appropriate trigger type:
   - For recurring time patterns, use create-cron-trigger
   - For state changes, use create-state-regex-trigger
   - For delays or offsets, use create-relative-time-trigger
   - For specific future times, use create-absolute-time-trigger

5. Provide a clear explanation of your decision process and actions taken
</instructions>

Based on the current date and time, and the automation instructions provided above, please analyze the current scheduling configuration and make any necessary adjustments.

First, use the list-scheduled-triggers tool to see what's currently configured, then determine what changes (if any) are needed.
`
