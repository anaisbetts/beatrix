import {
  createEvalRuntime,
  failureGrader,
  gradeContentViaPrompt,
  gradeViaSearchForContent,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider, createBuiltinServers } from '../llm'

export async function* smokeTestEval(llmFactory: () => LargeLanguageProvider) {
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'What is the capital of France?',
    [],
    'No tools',
    [
      failureGrader(),
      gradeViaSearchForContent('Paris', 'France', 'capital of France'),
      gradeContentViaPrompt(
        'Did the assistant answer Paris relatively concisely? If it adds multiple sentences of extra information, it is a failure.'
      ),
    ]
  )
}

export async function* smokeTestToolsEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'What lights are in the foyer? Tell me the friendly names of each light.',
    createBuiltinServers(runtime, null),
    'Default mocked tools',
    [
      failureGrader(),
      gradeViaSearchForContent('Bird', 'Sconces', 'Floor', 'Overhead'),
      gradeContentViaPrompt(
        "The assistant should answer with three lights and *only* three lights. If they don't answer with lights, it's a failure"
      ),
    ]
  )
}
