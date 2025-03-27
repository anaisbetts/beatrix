import { smokeTestEval } from './evals/simple-evals'
import { LargeLanguageProvider } from './llm'

async function* combine<T1, T2>(generators: AsyncGenerator<T1, T2, void>[]) {
  for (const generator of generators) {
    for await (const value of generator) {
      yield value
    }
  }
}

export function runAllEvals(llm: LargeLanguageProvider) {
  return combine([smokeTestEval(llm)])
}
