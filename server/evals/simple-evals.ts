import {
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
      gradeViaSearchForContent('Paris', 'France', 'capital of France'),
      gradeContentViaPrompt(
        'Did the assistant answer Paris concisely and without additional info?'
      ),
    ]
  )

  yield await runScenario(
    llm,
    'What is the capital of Germany?',
    [],
    'No tools',
    [
      gradeViaSearchForContent('Berlin', 'Germany', 'capital of Germany'),
      gradeContentViaPrompt(
        'Did the assistant answer Germany concisely and without additional info?'
      ),
    ]
  )
}
