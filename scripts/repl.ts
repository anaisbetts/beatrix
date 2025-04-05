import { createDatabaseViaEnv } from '../server/db'
import { LiveHomeAssistantApi } from '../server/lib/ha-ws-api'
import { createDefaultLLMProvider } from '../server/llm'
import { LiveAutomationRuntime } from '../server/workflow/automation-runtime'

export default async function go() {
  return new LiveAutomationRuntime(
    await LiveHomeAssistantApi.createViaEnv(),
    createDefaultLLMProvider(),
    await createDatabaseViaEnv()
  )
}
