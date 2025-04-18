import debug from 'debug'
import { lastValueFrom, toArray } from 'rxjs'

import { Automation } from '../../shared/types'
import { formatDateForLLM } from '../lib/date-utils'
import { createBuiltinServers } from '../llm'
import { i } from '../logging'
import { agenticReminders } from '../prompts'
import { AutomationRuntime, now } from './automation-runtime'

const d = debug('b:execution-step')

export async function runExecutionForAutomation(
  runtime: AutomationRuntime,
  automation: Automation,
  signalId: number
) {
  const signal = await runtime.db
    .selectFrom('signals')
    .selectAll()
    .where('id', '==', signalId)
    .executeTakeFirst()

  if (!signal) {
    d('Signal not found: %d', signalId)
    throw new Error('Signal not found')
  }

  i(
    `Starting execution for automation ${automation.fileName}, signal ID: ${signalId}`,
    signal
  )

  const tools = createBuiltinServers(runtime, automation)

  const llm = runtime.llmFactory()
  const msgs = await lastValueFrom(
    llm
      .executePromptWithTools(
        prompt(
          runtime,
          signal.type,
          signal.data,
          automation.contents,
          signal.executionNotes ?? ''
        ),
        tools
      )
      .pipe(toArray())
  )

  await runtime.db
    .insertInto('automationLogs')
    .values({
      createdAt: now(runtime).toISO()!,
      type: 'execute-signal',
      signalId: signalId,
      messageLog: JSON.stringify(msgs),
    })
    .execute()

  i(
    `Execution completed for automation ${automation.fileName}, signal ID: ${signalId}`
  )
}

const prompt = (
  runtime: AutomationRuntime,
  triggerType: string,
  triggerInfo: string,
  automation: string,
  executionNotes: string
) => `
<task>
You are an AI automation executor for Home Assistant. Your job is to execute
appropriate actions based on the automation instructions when triggered. You
have full context of the home environment and can make intelligent decisions
about how to respond to events.
</task>

${agenticReminders}

<execution_context>
<current_datetime>${formatDateForLLM(now(runtime))}</current_datetime>
<trigger_reason>${triggerType}</trigger_reason>
<trigger_details>${triggerInfo}</trigger_details>
</execution_context>

<automation>
${automation}
</automation>

<execution_notes>
${executionNotes}
</execution_notes>

<instructions>
Follow these steps to execute this automation intelligently:

1. Analyze why the automation was triggered:
   - For time-based triggers: Consider the current time and day
   - For state-based triggers: Consider what state changed and its significance
   - For other triggers: Analyze the context of the trigger

2. Determine if action needs to be taken based on:
   - The automation instructions
   - Current conditions in the home
   - Historical patterns
   - User preferences mentioned in the instructions
   - Safety and comfort priorities
   - Execution notes passed in

3. If action is needed:
   - Decide which Home Assistant services to call
   - Execute them in the appropriate sequence via the appropriate tools. You must actually call tools to take actions!
   - Consider dependencies between actions
   - Avoid conflicting or redundant actions
   - Ensure all safety conditions are met

4. Explain your reasoning and actions clearly

5. If difficulties were encountered, **OPTIONALLY** use the save-observation tool to save observations or discoveries.
</instructions>

Based on the above information, please determine if this automation should take action right now, and if so, what actions to take. Think step by step about the context of the trigger, the current state of the home, and the intent of the automation.

<automation>
${automation}
</automation>
`
