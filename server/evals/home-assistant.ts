import {
  createEvalRuntime,
  failureGrader,
  gradeContentViaPrompt,
  gradeViaSearchForContent,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider, createBuiltinServers } from '../llm'

// Basic Home Assistant entity listing eval
export async function* listEntitiesEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'List all the light entities in the living room. Give me their friendly names only.',
    createBuiltinServers(runtime, null),
    'Entity listing',
    [
      failureGrader(),
      gradeViaSearchForContent(
        'Bookshelf Light',
        'Overhead Light',
        'TV Lightstrip'
      ),
      gradeContentViaPrompt(
        'Did the assistant list only the six living room lights with their friendly names? It should not include other rooms or entity types.'
      ),
    ]
  )
}

// Bulk operations on lights eval
export async function* bulkLightOperationsEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'Turn off all the lights in the kitchen.',
    createBuiltinServers(runtime, null),
    'Bulk light operations',
    [
      failureGrader(),
      gradeViaSearchForContent(
        'light.turn_off',
        'kitchen_dining_room_chandelier'
      ),
      gradeContentViaPrompt(
        'Did the assistant correctly identify all kitchen lights and turn them off using a single bulk operation or multiple service calls? It should not affect lights in other rooms.'
      ),
    ]
  )
}

// Status checking across multiple entity types
export async function* multiEntityStatusEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'Tell me about all the lights and media players that are currently on.',
    createBuiltinServers(runtime, null),
    'Multi-entity status checking',
    [
      failureGrader(),
      gradeViaSearchForContent(
        'nVidia Shield',
        'Living Room Sonos Arc',
        'playing',
        'Maya Fairy Lights'
      ),
      gradeContentViaPrompt(
        'Did the assistant correctly identify all lights and media players that are in the "on" state? The response should include friendly names and possibly room locations.'
      ),
    ]
  )
}

// Climate control evaluation
export async function* climateControlEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    "Set all thermostats to 72 degrees and make sure they're in heat mode.",
    createBuiltinServers(runtime, null),
    'Climate control operations',
    [
      failureGrader(),
      gradeViaSearchForContent(
        'call-service',
        'get-entities-by-domain',
        'climate'
      ),
      gradeContentViaPrompt(
        'Did the assistant correctly set all thermostats to 72 degrees and switch them to heat mode? It should have used the appropriate climate services.'
      ),
    ]
  )
}

// Scene activation evaluation
export async function* sceneActivationEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'Activate the night mode opening scene.',
    createBuiltinServers(runtime, null),
    'Scene activation',
    [
      failureGrader(),
      gradeViaSearchForContent('scene.night_mode_opening_scene'),
      gradeContentViaPrompt(
        'Did the assistant correctly activate the movie night scene? It should have used the scene.turn_on service with the appropriate scene entity.'
      ),
    ]
  )
}

// Entity attribute querying
export async function* entityAttributeQueryEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    'What is the current temperature and humidity in each room?',
    createBuiltinServers(runtime, null),
    'Entity attribute querying',
    [
      failureGrader(),
      gradeViaSearchForContent('temperature', 'humidity'),
      gradeContentViaPrompt(
        'Did the assistant correctly report the temperature and humidity values for each room? The response should include all rooms that have temperature/humidity sensors.'
      ),
    ]
  )
}

// Complex multi-step automation
export async function* complexAutomationEval(
  llmFactory: () => LargeLanguageProvider
) {
  const runtime = await createEvalRuntime(llmFactory)
  const llm = llmFactory()
  yield await runScenario(
    llm,
    "I'm leaving the house. Turn off all lights and make sure all media players are off.",
    createBuiltinServers(runtime, null),
    'Complex multi-step automation',
    [
      failureGrader(),
      gradeViaSearchForContent('light.turn_off', 'media_player.turn_off'),
      gradeContentViaPrompt(
        'Did the assistant execute both requested actions? It should have turned off all lights and turned off all media players.'
      ),
    ]
  )
}

// Advanced filtering and querying
/*
export async function* advancedFilteringEval(llm: LargeLanguageProvider) {
  yield await runScenario(
    llm,
    'Which rooms have lights that are on but no motion has been detected in the last 30 minutes?',
    createDefaultMockedTools(llm),
    'Advanced filtering and querying',
    [
      failureGrader(),
      gradeViaSearchForContent('light', 'on', 'motion', 'last_changed'),
      gradeContentViaPrompt(
        'Did the assistant correctly identify rooms with lights on but no recent motion? This requires checking light states and comparing with motion sensor timestamps.'
      ),
    ]
  )
}
*/
