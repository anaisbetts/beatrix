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
  share,
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
    driver: string,
    previousConversationId?: number
  ): Observable<MessageParam> {
    const llm = createLLMDriver(model, driver)
    const tools = this.evalMode
      ? createDefaultMockedTools(llm)
      : createBuiltinServers(this.api, llm, {
          testMode: this.testMode,
        })

    const convo = previousConversationId
      ? from(this.db
          .selectFrom('automationLogs')
          .select('messageLog')
          .where('id', '=', previousConversationId)
          .executeTakeFirst()
          .then(x => JSON.parse(x?.messageLog ?? "[]") as MessageParam[])
        )
      : of([])

    let automationId: bigint | undefined
    const resp = convo.pipe(
      mergeMap((prevMsgs) => llm.executePromptWithTools(prompt, tools, prevMsgs)),
      mergeMap((msg) => {
        // NB: We insert into the database twice so that the caller can get
        // the ID faster even though it's a little hamfisted
        if (!automationId) {
          const insert = this.db
            .insertInto('automationLogs')
            .values({
              type: 'manual',
              messageLog: JSON.stringify([msg]),
            })
            .execute()
            .then((x) => {
              automationId = x[0].insertId
              return x
            })

          return from(
            insert.then((x) =>
              Object.assign({}, msg, { serverId: x[0].insertId })
            )
          )
        } else {
          return of(Object.assign({}, msg, { serverId: automationId }))
        }
      }),
      share()
    )

    resp
      .pipe(
        toArray(),
        mergeMap(async (msgs) => {
          await this.db
            .updateTable('automationLogs')
            .set({
              type: 'manual',
              messageLog: JSON.stringify(msgs),
            })
            .where('id', '=', Number(automationId!))
            .execute()
        })
      )
      .subscribe()

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
