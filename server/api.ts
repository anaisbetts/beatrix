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
import {
  AutomationLogEntry,
  ModelDriverType,
  ScenarioResult,
} from '../shared/types'
import { runAllEvals, runQuickEvals } from './run-evals'
import { createLLMDriver } from './eval-framework'
import { pick } from '../shared/utility'
import {
  AutomationRuntime,
  LiveAutomationRuntime,
} from './workflow/automation-runtime'
import { fetchAutomationLogs } from './db'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private runtime: AutomationRuntime,
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

  getAutomationLogs(beforeTimestamp?: Date): Observable<AutomationLogEntry[]> {
    return from(
      fetchAutomationLogs(
        this.runtime.db,
        this.runtime.automationList,
        beforeTimestamp
      )
    )
  }

  handlePromptRequest(
    prompt: string,
    model: string,
    driver: string,
    previousConversationId?: number
  ): Observable<MessageParamWithExtras> {
    const llm = createLLMDriver(model, driver)
    const rqRuntime = new LiveAutomationRuntime(
      this.runtime.api,
      llm,
      this.runtime.db
    )

    const tools = createBuiltinServers(rqRuntime, {
      testMode: this.testMode || this.evalMode,
    })

    const convo = previousConversationId
      ? from(
          this.runtime.db
            .selectFrom('automationLogs')
            .select('messageLog')
            .where('id', '=', previousConversationId)
            .executeTakeFirst()
            .then((x) => JSON.parse(x?.messageLog ?? '[]') as MessageParam[])
        )
      : of([])

    let serverId: bigint | undefined = previousConversationId
      ? BigInt(previousConversationId)
      : undefined

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
          const insert = this.runtime.db
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

          await this.runtime.db
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
