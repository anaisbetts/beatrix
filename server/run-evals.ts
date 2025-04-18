import {
  climateControlModeEval,
  climateControlTemperatureEval,
  lightBrightnessEval,
  lightColorEval,
  lightControlEval,
  listServicesEval,
  mediaPlayerControlEval,
  multipleEntityControlEval,
} from './evals/call-service'
import {
  bulkLightOperationsEval,
  climateControlEval,
  complexAutomationEval,
  entityAttributeQueryEval,
  listEntitiesEval,
  multiEntityStatusEval,
  sceneActivationEval,
} from './evals/home-assistant'
import {
  listNotifyTargetsEval,
  listPeopleEval,
  notifyEveryoneEval,
  notifyMultiplePeopleEval,
  notifyPersonEval,
  notifySpecificDeviceEval,
  notifyWithTitleEval,
} from './evals/notify'
import {
  evalAbsoluteTimePrompts,
  evalCronPrompts,
  evalMixedPrompts,
  evalRelativeTimePrompts,
  evalStateRegexPrompts,
  simplestSchedulerEval,
} from './evals/scheduling'
import { smokeTestEval, smokeTestToolsEval } from './evals/simple-evals'
import { LargeLanguageProvider } from './llm'

async function* combine<T1, T2>(generators: AsyncGenerator<T1, T2, void>[]) {
  for (const generator of generators) {
    for await (const value of generator) {
      yield value
    }
  }
}

export function runAllEvals(llmFactory: () => LargeLanguageProvider) {
  return combine([
    // Simple smoke tests
    smokeTestEval(llmFactory),
    smokeTestToolsEval(llmFactory),

    // Home Assistant general evals
    listEntitiesEval(llmFactory),
    bulkLightOperationsEval(llmFactory),
    multiEntityStatusEval(llmFactory),
    climateControlEval(llmFactory),
    sceneActivationEval(llmFactory),
    entityAttributeQueryEval(llmFactory),
    complexAutomationEval(llmFactory),

    // Call service specific evals
    listServicesEval(llmFactory),
    lightControlEval(llmFactory),
    lightBrightnessEval(llmFactory),
    lightColorEval(llmFactory),
    multipleEntityControlEval(llmFactory),
    mediaPlayerControlEval(llmFactory),
    climateControlTemperatureEval(llmFactory),
    climateControlModeEval(llmFactory),

    // Notification specific evals
    listNotifyTargetsEval(llmFactory),
    listPeopleEval(llmFactory),
    notifyPersonEval(llmFactory),
    notifyWithTitleEval(llmFactory),
    notifyMultiplePeopleEval(llmFactory),
    notifyEveryoneEval(llmFactory),
    notifySpecificDeviceEval(llmFactory),

    // Scheduler evals
    simplestSchedulerEval(llmFactory),
    evalAbsoluteTimePrompts(llmFactory),
    evalCronPrompts(llmFactory),
    evalMixedPrompts(llmFactory),
    evalRelativeTimePrompts(llmFactory),
    evalStateRegexPrompts(llmFactory),
  ])
}

export function runQuickEvals(llmFactory: () => LargeLanguageProvider) {
  return combine([
    smokeTestToolsEval(llmFactory),
    simplestSchedulerEval(llmFactory),
    bulkLightOperationsEval(llmFactory),
    lightBrightnessEval(llmFactory),
    mediaPlayerControlEval(llmFactory),
    notifyMultiplePeopleEval(llmFactory),
  ])
}
