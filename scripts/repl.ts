import { createConfigViaEnv } from '../server/config'
import { createDatabaseViaEnv } from '../server/db'
import { LiveHomeAssistantApi } from '../server/lib/ha-ws-api'
import { createDefaultLLMProvider } from '../server/llm'
import { LiveAutomationRuntime } from '../server/workflow/automation-runtime'

export default async function go() {
  // XXX: Normally hard-coding this is Bad but we know that this
  // is only used in development
  const cfg = await createConfigViaEnv('./notebook')

  return new LiveAutomationRuntime(
    await LiveHomeAssistantApi.createViaConfig(cfg),
    createDefaultLLMProvider(cfg),
    await createDatabaseViaEnv()
  )
}
