import {
  runScenario,
  createDefaultMockedTools,
  failureGrader,
  gradeViaSearchForContent,
  gradeContentViaPrompt,
} from '../eval-framework'
import { LargeLanguageProvider } from '../llm'

// Notification sending

export async function* notificationEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification to everyone that dinner is ready.',
    createDefaultMockedTools(llm),
    'Notification sending',
    [
      failureGrader(),
      gradeViaSearchForContent('notify', 'dinner is ready'),
      gradeContentViaPrompt(
        'Did the assistant correctly send a notification to all users with the message that dinner is ready?'
      ),
    ]
  )
}
