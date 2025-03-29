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
  coverControlEval,
  climateControlModeEval,
  climateControlTemperatureEval,
  lightBrightnessEval,
  lightColorEval,
  lightControlEval,
  listServicesEval,
  mediaPlayerControlEval,
  multipleEntityControlEval,
  sceneActivationEval as callServiceSceneEval,
} from './evals/call-service'

import {
  actionableNotificationEval,
  listNotifyTargetsEval,
  listPeopleEval,
  notifyByLocationEval,
  notifyEveryoneEval,
  notifyMultiplePeopleEval,
  notifyNonexistentPersonEval,
  notifyPersonEval,
  notifySpecificDeviceEval,
  notifyWithTitleEval,
} from './evals/notify'

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
    coverControlEval(llm),
    callServiceSceneEval(llm),

    // Notification specific evals
    listNotifyTargetsEval(llm),
    listPeopleEval(llm),
    notifyPersonEval(llm),
    notifyWithTitleEval(llm),
    notifyMultiplePeopleEval(llm),
    notifyEveryoneEval(llm),
    notifySpecificDeviceEval(llm),
    notifyNonexistentPersonEval(llm),
    actionableNotificationEval(llm),
    notifyByLocationEval(llm),
  ])
}
