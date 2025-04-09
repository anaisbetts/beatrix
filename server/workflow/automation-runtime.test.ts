import { describe, expect, it } from 'bun:test'
import { firstValueFrom, timeout } from 'rxjs'

import { createInMemoryDatabase } from '../db'
import { EvalHomeAssistantApi } from '../eval-framework'
import { LargeLanguageProvider, createDefaultLLMProvider } from '../llm'
import { LiveAutomationRuntime } from './automation-runtime'

describe('LiveAutomationRuntime', () => {
  it('reparseAutomations should emit immediately upon subscription', async () => {
    const api = new EvalHomeAssistantApi()

    let llm: LargeLanguageProvider
    try {
      llm = createDefaultLLMProvider()
    } catch {
      console.error('No LLM provider found, skipping test')
      return
    }

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
