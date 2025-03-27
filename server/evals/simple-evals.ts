import { gradeViaSearchForContent, runScenario } from '../eval-framework'
import { LargeLanguageProvider } from '../llm'

export async function smokeTestEval(llm: LargeLanguageProvider) {
  return await runScenario(
    llm,
    'What is the capital of France?',
    [],
    'No tools',
    [gradeViaSearchForContent('Paris', 'France', 'capital of France')]
  )
}
