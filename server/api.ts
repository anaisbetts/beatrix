import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LargeLanguageProvider } from './llm'
import { Kysely } from 'kysely'
import { Schema } from './db-schema'
import { ServerWebsocketApi } from '../shared/prompt'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { concatMap, from, generate, mergeMap, Observable, toArray } from 'rxjs'
import { ScenarioResult } from '../shared/types'
import { runAllEvals } from './run-all-evals'
import { createLLMDriver } from './eval-framework'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private db: Kysely<Schema>,
    private llm: LargeLanguageProvider,
    private tools: McpServer[]
  ) {}

  handlePromptRequest(prompt: string): Observable<MessageParam> {
    const resp = this.llm.executePromptWithTools(prompt, this.tools)

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
