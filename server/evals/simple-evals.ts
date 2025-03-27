import {
  createDefaultMockedTools,
  failureGrader,
  gradeContentViaPrompt,
  gradeViaSearchForContent,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider } from '../llm'

export async function* smokeTestEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'What is the capital of France?',
    [],
    'No tools',
    [
      failureGrader(),
      gradeViaSearchForContent('Paris', 'France', 'capital of France'),
      gradeContentViaPrompt(
        'Did the assistant answer Paris concisely and without additional info?'
      ),
    ]
  )
}

export async function* smokeTestToolsEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'What lights are in the foyer? Tell me the friendly names of each light.',
    createDefaultMockedTools(llm),
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
