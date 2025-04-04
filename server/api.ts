import { createBuiltinServers } from './llm'
import { MessageParamWithExtras, ServerWebsocketApi } from '../shared/prompt'
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
import { runAllEvals, runQuickEvals } from './run-evals'
import { createDefaultMockedTools, createLLMDriver } from './eval-framework'
import { pick } from '../shared/utility'
import { ServiceCore } from './workflow/service-core'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private core: ServiceCore,
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
  ): Observable<MessageParamWithExtras> {
    const llm = createLLMDriver(model, driver)
    const tools = this.evalMode
      ? createDefaultMockedTools(llm)
      : createBuiltinServers(this.core.api, llm, {
          testMode: this.testMode,
        })

    const convo = previousConversationId
      ? from(
          this.core.db
            .selectFrom('automationLogs')
            .select('messageLog')
            .where('id', '=', previousConversationId)
            .executeTakeFirst()
            .then((x) => JSON.parse(x?.messageLog ?? '[]') as MessageParam[])
        )
      : of([])

    let serverId: bigint | undefined
    const resp = convo.pipe(
      mergeMap((prevMsgs) => {
        const msgs: MessageParam[] = prevMsgs.map((msg) =>
          pick(msg, ['content', 'role'])
        )

        return llm.executePromptWithTools(prompt, tools, msgs)
      }),
      mergeMap((msg) => {
        // NB: We insert into the database twice so that the caller can get
        // the ID faster even though it's a little hamfisted
        if (!serverId) {
          const insert = this.core.db
            .insertInto('automationLogs')
            .values({
              type: 'manual',
              messageLog: JSON.stringify([msg]),
            })
            .execute()
            .then((x) => {
              serverId = x[0].insertId
              return x
            })

          return from(
            insert.then((x) =>
              Object.assign({}, msg, { serverId: Number(x[0].insertId) })
            )
          )
        } else {
          return of(Object.assign({}, msg, { serverId: Number(serverId) }))
        }
      }),
      share()
    )

    resp
      .pipe(
        toArray(),
        mergeMap(async (msgs) => {
          const filteredMsgs: MessageParam[] = msgs.map((msg: any) =>
            pick(msg, ['content', 'role'])
          )

          await this.core.db
            .updateTable('automationLogs')
            .set({
              type: 'manual',
              messageLog: JSON.stringify(filteredMsgs),
            })
            .where('id', '=', Number(serverId!))
            .execute()
        })
      )
      .subscribe()

    return resp
  }

  runEvals(
    model: string,
    driver: 'ollama' | 'anthropic' | 'openai',
    type: 'all' | 'quick',
    count: number
  ): Observable<ScenarioResult> {
    const llm = createLLMDriver(model, driver)

    const counter = generate({
      initialState: 0,
      iterate: (x) => x + 1,
      condition: (x) => x < count,
    })

    const runEvals = type === 'all' ? runAllEvals : runQuickEvals

    return from(counter.pipe(concatMap(() => runEvals(llm))))
  }
}
