import { createConfigViaEnv } from '../server/config'
import { LiveHomeAssistantApi } from '../server/lib/ha-ws-api'
import { LiveAutomationRuntime } from '../server/workflow/automation-runtime'

export default async function go() {
  // XXX: Normally hard-coding this is Bad but we know that this
  // is only used in development
  const cfg = await createConfigViaEnv('./notebook')

  return LiveAutomationRuntime.createViaConfig(
    cfg,
    await LiveHomeAssistantApi.createViaConfig(cfg),
    './notebook'
  )
}
