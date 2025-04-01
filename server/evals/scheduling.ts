import { createDatabase } from '../db'
import {
  EvalHomeAssistantApi,
  failureGrader,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider } from '../llm'
import { automationFromString } from '../workflow/parser'
import {
  createDefaultSchedulerTools,
  schedulerPrompt,
} from '../workflow/scheduler-step'
import { CronTrigger } from '../mcp/scheduler'

export async function* simplestSchedulerEval(llm: LargeLanguageProvider) {
  const inputAutomation = automationFromString(
    'Every Monday at 8:00 AM, turn on the living room lights.',
    'test_automation.md'
  )

  const db = await createDatabase()
  const api = new EvalHomeAssistantApi()
  const tools = createDefaultSchedulerTools(api, llm, db, inputAutomation)

  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation.contents),
    tools,
    'Evaled scheduler tools',
    [
      failureGrader(),
      async () => {
        let points = 0
        const rows = await db.selectFrom('signals').selectAll().execute()
        if (rows.length === 1) {
          points += 1
        }

        if (rows[0].type === 'cron') {
          points += 1
        }

        const data: CronTrigger = JSON.parse(rows[0].data)
        if (data.cron === '0 8 * * 1') {
          points += 2
        }

        return {
          score: points,
          possibleScore: 4,
          graderInfo: `Found ${rows.length} signals, type: ${rows[0].type}, cron: ${data.cron}`,
        }
      },
    ]
  )
}
