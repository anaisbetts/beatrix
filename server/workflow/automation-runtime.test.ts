import { describe, expect, it } from 'bun:test'
import { firstValueFrom, timeout } from 'rxjs'

import { createInMemoryDatabase } from '../db'
import { EvalHomeAssistantApi } from '../eval-framework'
import { createDefaultLLMProvider } from '../llm'
import { LiveAutomationRuntime } from './automation-runtime'

describe('LiveAutomationRuntime', () => {
  it('reparseAutomations should emit immediately upon subscription', async () => {
    const api = new EvalHomeAssistantApi()
    const llm = createDefaultLLMProvider()

    // NB: We set the notebook dir so that reparseAutomations works
    // but we're not actually doing anything with it
    const runtime = new LiveAutomationRuntime(
      api,
      llm,
      await createInMemoryDatabase(),
      '.'
    )

    // Use timeout to ensure it emits quickly, otherwise firstValueFrom would hang
    const result = await firstValueFrom(
      runtime.reparseAutomations.pipe(timeout(100)) // Add a short timeout
    )

    // Expect the observable to emit void (represented as undefined in JS)
    expect(result).toBeUndefined()
  })
})
