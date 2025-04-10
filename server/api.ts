import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import path from 'node:path'
import {
  Observable,
  concatMap,
  from,
  generate,
  mergeMap,
  of,
  share,
  toArray,
} from 'rxjs'

import { MessageParamWithExtras, ServerWebsocketApi } from '../shared/prompt'
import {
  Automation,
  AutomationLogEntry,
  ScenarioResult,
  SignalHandlerInfo,
} from '../shared/types'
import { AppConfig } from '../shared/types'
import { pick } from '../shared/utility'
import { fetchAutomationLogs } from './db'
import { createBuiltinServers, createDefaultLLMProvider } from './llm'
import { runAllEvals, runQuickEvals } from './run-evals'
import {
  AutomationRuntime,
  LiveAutomationRuntime,
} from './workflow/automation-runtime'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private config: AppConfig,
    private runtime: AutomationRuntime,
    private testMode: boolean,
    private evalMode: boolean
  ) {}

  getDriverList(): Observable<string[]> {
    const list = []
    if (this.config.anthropicApiKey) {
      list.push('anthropic')
    }
    if (this.config.ollamaHost) {
      list.push('ollama')
    }

    if (this.config.openAIProviders && this.config.openAIProviders.length > 0) {
      list.push(
        ...this.config.openAIProviders.map((x) => x.providerName ?? 'openai')
      )
    }

    return of(list)
  }

  getModelListForDriver(driver: string): Observable<string[]> {
    const llm = createDefaultLLMProvider(this.config, driver)
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

  getAutomations(): Observable<Automation[]> {
    return of(this.runtime.automationList)
  }

  getScheduledSignals(): Observable<SignalHandlerInfo[]> {
    return of(
      // NB: If we don't do this, we will end up trying to serialize an Observable
      // which obvs won't work
      this.runtime.scheduledSignals.map((x) => {
        const ret = pick(x, [
          'automation',
          'friendlySignalDescription',
          'isValid',
          'signal',
        ])

        // Make the filenames relative to the automation dir when returning them
        ret.automation.fileName = ret.automation.fileName.replace(
          `${this.runtime.notebookDirectory}${path.sep}`,
          ''
        )

        return ret
      })
    )
  }

  getConfig(): Observable<AppConfig> {
    return of(this.config)
  }

  setConfig(config: AppConfig): Observable<void> {
    // XXX: Implement this later, we need to reload the config
    return of(undefined)
  }

  handlePromptRequest(
    prompt: string,
    model: string,
    driver: string,
    previousConversationId?: number
  ): Observable<MessageParamWithExtras> {
    const llm = createDefaultLLMProvider(this.config, driver, model)
    const rqRuntime = new LiveAutomationRuntime(
      this.runtime.api,
      llm,
      this.runtime.db
    )

    const tools = createBuiltinServers(rqRuntime, null, {
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
    let previousMessages: MessageParam[] = []

    const resp = convo.pipe(
      mergeMap((prevMsgs) => {
        const msgs: MessageParam[] = prevMsgs.map((msg) =>
          pick(msg, ['content', 'role'])
        )
        previousMessages = msgs

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
        mergeMap(async (newMsgs) => {
          const filteredNewMsgs: MessageParam[] = newMsgs.map((msg: any) =>
            pick(msg, ['content', 'role'])
          )

          const fullMessageLog = [...previousMessages, ...filteredNewMsgs]

          await this.runtime.db
            .updateTable('automationLogs')
            .set({
              type: 'manual',
              messageLog: JSON.stringify(fullMessageLog),
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
    driver: string,
    type: 'all' | 'quick',
    count: number
  ): Observable<ScenarioResult> {
    const llm = createDefaultLLMProvider(this.config, driver, model)

    const counter = generate({
      initialState: 0,
      iterate: (x) => x + 1,
      condition: (x) => x < count,
    })

    const runEvals = type === 'all' ? runAllEvals : runQuickEvals
    return from(counter.pipe(concatMap(() => runEvals(llm))))
  }
}
