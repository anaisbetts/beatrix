import {
  createDefaultMockedTools,
  failureGrader,
  gradeContentViaPrompt,
  gradeViaSearchForContent,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider } from '../llm'

// Basic notification target listing eval
export async function* listNotifyTargetsEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'What are all the possible notification targets in my Home Assistant setup?',
    createDefaultMockedTools(llm),
    'List notification targets',
    [
      failureGrader(),
      gradeViaSearchForContent('notify.mobile_app', 'notify.persistent'),
      gradeContentViaPrompt(
        'Did the assistant correctly list all notify targets available in Home Assistant? The response should include mobile_app devices and any other notification services.'
      ),
    ]
  )
}

// List people with notification capabilities
export async function* listPeopleEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Which people in my Home Assistant setup can receive notifications?',
    createDefaultMockedTools(llm),
    'List people for notifications',
    [
      failureGrader(),
      gradeViaSearchForContent('Ani', 'Ulrike', 'Effie'),
      gradeContentViaPrompt(
        'Did the assistant correctly identify all three people (Ani, Ulrike, and Effie) who can receive notifications?'
      ),
    ]
  )
}

// Send notification to specific person
export async function* notifyPersonEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification to Ani saying "Dinner is ready!"',
    createDefaultMockedTools(llm),
    'Notify specific person',
    [
      failureGrader(),
      gradeViaSearchForContent('ani', 'list-people', 'send-notification-to-person'),
      gradeContentViaPrompt(
        'Did the assistant correctly send a notification specifically to Ani (not to other people) with the message "Dinner is ready!"? It should have used the send-notification-to-person tool with the correct target parameter.'
      ),
    ]
  )
}

// Send notification with title
export async function* notifyWithTitleEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification to Ulrike with the title "Urgent" and the message "Please call me back."',
    createDefaultMockedTools(llm),
    'Notify with title',
    [
      failureGrader(),
      gradeViaSearchForContent('ulrike', 'Urgent', 'Please call me back'),
      gradeContentViaPrompt(
        'Did the assistant correctly send a notification to Ulrike with both the specified title "Urgent" and message "Please call me back"? The title parameter should have been used properly.'
      ),
    ]
  )
}

// Send to multiple people
export async function* notifyMultiplePeopleEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Let both Ani and Effie know that "The movie is starting in 5 minutes."',
    createDefaultMockedTools(llm),
    'Notify multiple people',
    [
      failureGrader(),
      gradeViaSearchForContent('ani', 'effie', 'movie is starting'),
      gradeContentViaPrompt(
        'Did the assistant correctly send the notification to both Ani and Effie (but not Ulrike)? It should have used separate calls to send-notification-to-person for each recipient.'
      ),
    ]
  )
}

// Notify everyone
export async function* notifyEveryoneEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification to everyone in the house saying "Fire alarm test in 10 minutes."',
    createDefaultMockedTools(llm),
    'Notify everyone',
    [
      failureGrader(),
      gradeViaSearchForContent('ani', 'ulrike', 'effie', 'Fire alarm test'),
      gradeContentViaPrompt(
        'Did the assistant correctly send the notification to all three people (Ani, Ulrike, and Effie)? It should have used list-people to identify everyone and then sent the notification to each person.'
      ),
    ]
  )
}

// Notify specific device
export async function* notifySpecificDeviceEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification specifically to Ani\'s iPhone saying "Don\'t forget to bring your charger."',
    createDefaultMockedTools(llm),
    'Notify specific device',
    [
      failureGrader(),
      gradeViaSearchForContent('list-notify-targets', 'send-notification', 'iPhone', 'charger'),
      gradeContentViaPrompt(
        'Did the assistant correctly send the notification specifically to Ani\'s iPhone device rather than to all of Ani\'s devices? It should have used list-notify-targets to identify the specific device and then used send-notification with that target.'
      ),
    ]
  )
}

// Error handling for nonexistent person
export async function* notifyNonexistentPersonEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send a notification to Bob saying "Meeting in 5 minutes."',
    createDefaultMockedTools(llm),
    'Notify nonexistent person',
    [
      failureGrader(),
      gradeViaSearchForContent('list-people', 'Bob', 'not found'),
      gradeContentViaPrompt(
        'Did the assistant properly handle the error case of attempting to notify a non-existent person? It should have checked the available people first and informed the user that Bob is not found in the system.'
      ),
    ]
  )
}

// Advanced notification with actionable content
export async function* actionableNotificationEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Send an actionable notification to Ulrike asking if she wants to order pizza for dinner with yes/no options.',
    createDefaultMockedTools(llm),
    'Actionable notification',
    [
      failureGrader(),
      gradeViaSearchForContent('ulrike', 'pizza', 'yes', 'no'),
      gradeContentViaPrompt(
        'Did the assistant attempt to send an actionable notification with yes/no options? It should have either successfully sent such a notification or explained that actionable notifications require special formatting or may not be supported by all notification targets.'
      ),
    ]
  )
}

// Group notification by room
export async function* notifyByLocationEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Notify everyone who is currently in the living room that the snacks are ready.',
    createDefaultMockedTools(llm),
    'Notify by location',
    [
      failureGrader(),
      gradeViaSearchForContent('list-people', 'location', 'living room', 'snacks'),
      gradeContentViaPrompt(
        'Did the assistant attempt to determine who is in the living room and only notify those people? It should have tried to check person locations and then send notifications only to those in the living room.'
      ),
    ]
  )
}

// TODO: Add expected results for each eval as they might vary based on mock data