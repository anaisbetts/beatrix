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

export function runAllEvals(llm: LargeLanguageProvider) {
  return combine([
    // Simple smoke tests
    smokeTestEval(llm),
    smokeTestToolsEval(llm),

    // Home Assistant general evals
    listEntitiesEval(llm),
    bulkLightOperationsEval(llm),
    multiEntityStatusEval(llm),
    climateControlEval(llm),
    sceneActivationEval(llm),
    entityAttributeQueryEval(llm),
    complexAutomationEval(llm),

    // Call service specific evals
    listServicesEval(llm),
    lightControlEval(llm),
    lightBrightnessEval(llm),
    lightColorEval(llm),
    multipleEntityControlEval(llm),
    mediaPlayerControlEval(llm),
    climateControlTemperatureEval(llm),
    climateControlModeEval(llm),

    // Notification specific evals
    listNotifyTargetsEval(llm),
    listPeopleEval(llm),
    notifyPersonEval(llm),
    notifyWithTitleEval(llm),
    notifyMultiplePeopleEval(llm),
    notifyEveryoneEval(llm),
    notifySpecificDeviceEval(llm),

    // Scheduler evals
    simplestSchedulerEval(llm),
    evalAbsoluteTimePrompts(llm),
    evalCronPrompts(llm),
    evalMixedPrompts(llm),
    evalRelativeTimePrompts(llm),
    evalStateRegexPrompts(llm),
  ])
}

export function runQuickEvals(llm: LargeLanguageProvider) {
  return combine([
    smokeTestToolsEval(llm),
    simplestSchedulerEval(llm),
    bulkLightOperationsEval(llm),
    lightBrightnessEval(llm),
    mediaPlayerControlEval(llm),
    notifyMultiplePeopleEval(llm),
  ])
}
