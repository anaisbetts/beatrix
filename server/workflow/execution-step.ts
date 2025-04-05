import { createBuiltinServers } from '../llm'
import { Automation } from './parser'
import { lastValueFrom, toArray } from 'rxjs'
import { AutomationRuntime } from './automation-runtime'

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
    throw new Error('Signal not found')
  }

  const tools = createBuiltinServers(runtime)
  const msgs = await lastValueFrom(
    runtime.llm
      .executePromptWithTools(
        prompt(signal.type, signal.data, automation.contents),
        tools
      )
      .pipe(toArray())
  )

  await runtime.db
    .insertInto('automationLogs')
    .values({
      type: 'execute-signal',
      signalId: signalId,
      messageLog: JSON.stringify(msgs),
    })
    .execute()
}

const prompt = (
  triggerType: string,
  triggerInfo: string,
  automation: string
) => `
<task>
You are an AI automation executor for Home Assistant. Your job is to execute appropriate actions based on the automation instructions when triggered. You have full context of the home environment and can make intelligent decisions about how to respond to events.
</task>

<execution_context>
<current_datetime>${new Date().toISOString()}</current_datetime>
<trigger_reason>${triggerType}</trigger_reason>
<trigger_details>${triggerInfo}</trigger_details>
</execution_context>

<automation>
${automation}
</automation>

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

3. If action is needed:
   - Decide which Home Assistant services to call
   - Execute them in the appropriate sequence
   - Consider dependencies between actions
   - Avoid conflicting or redundant actions
   - Ensure all safety conditions are met

4. Explain your reasoning and actions clearly
</instructions>

Based on the above information, please determine if this automation should take action right now, and if so, what actions to take. Think step by step about the context of the trigger, the current state of the home, and the intent of the automation.
`
