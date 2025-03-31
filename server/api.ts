import { createBuiltinServers } from './llm'
import { Kysely } from 'kysely'
import { Schema } from './db-schema'
import { ServerWebsocketApi } from '../shared/prompt'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  concatMap,
  from,
  generate,
  mergeMap,
  Observable,
  of,
  toArray,
} from 'rxjs'
import { ModelDriverType, ScenarioResult } from '../shared/types'
import { runAllEvals } from './run-all-evals'
import { createDefaultMockedTools, createLLMDriver } from './eval-framework'
import { HomeAssistantApi } from './lib/ha-ws-api'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private db: Kysely<Schema>,
    private api: HomeAssistantApi,
    private testMode: boolean,
    private evalMode: boolean
  ) {}

  getDriverList(): Observable<string[]> {
    const list = []
    if (process.env.ANTHROPIC_API_KEY) {
      list.push('anthropic')
    }
    if (process.env.OLLAMA_HOST) {
      list.push('ollama')
    }
    if (process.env.OPENAI_API_KEY) {
      list.push('openai')
    }

    return of(list)
  }

  getModelListForDriver(driver: ModelDriverType): Observable<string[]> {
    const llm = createLLMDriver('', driver)

    return from(llm.getModelList())
  }

  handlePromptRequest(
    prompt: string,
    model: string,
    driver: string
  ): Observable<MessageParam> {
    const llm = createLLMDriver(model, driver)
    const tools = this.evalMode
      ? createDefaultMockedTools(llm)
      : createBuiltinServers(this.api, llm, {
          testMode: this.testMode,
        })

    const resp = llm.executePromptWithTools(prompt, tools)

    resp.pipe(
      toArray(),
      mergeMap(async (msgs) => {
        await this.db
          .insertInto('automationLogs')
          .values({
            type: 'manual',
            messageLog: JSON.stringify(msgs),
          })
          .execute()
      })
    )

    return resp
  }

  runAllEvals(
    model: string,
    driver: 'ollama' | 'anthropic' | 'openai',
    count: number
  ): Observable<ScenarioResult> {
    const llm = createLLMDriver(model, driver)

    const counter = generate({
      initialState: 0,
      iterate: (x) => x + 1,
      condition: (x) => x < count,
    })

    return from(counter.pipe(concatMap(() => runAllEvals(llm))))
  }
}
