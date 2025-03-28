import {
  bulkLightOperationsEval,
  climateControlEval,
  complexAutomationEval,
  entityAttributeQueryEval,
  listEntitiesEval,
  multiEntityStatusEval,
  sceneActivationEval,
} from './evals/home-assistant'
import { notificationEval } from './evals/notify'
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
    smokeTestEval(llm),
    smokeTestToolsEval(llm),
    listEntitiesEval(llm),
    bulkLightOperationsEval(llm),
    multiEntityStatusEval(llm),
    climateControlEval(llm),
    sceneActivationEval(llm),
    entityAttributeQueryEval(llm),
    complexAutomationEval(llm),
    notificationEval(llm),
  ])
}
