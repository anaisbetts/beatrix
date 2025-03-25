import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LargeLanguageProvider } from './llm'
import { Kysely } from 'kysely'
import { Schema } from './db-schema'
import { ServerWebsocketApi } from '../shared/prompt'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private db: Kysely<Schema>,
    private llm: LargeLanguageProvider,
    private tools: McpServer[]
  ) {}

  async handlePromptRequest(prompt: string): Promise<MessageParam[]> {
    const resp = await this.llm.executePromptWithTools(prompt, this.tools)
    await this.db
      .insertInto('automationLogs')
      .values({
        type: 'manual',
        messageLog: JSON.stringify(resp),
      })
      .execute()

    return resp
  }
}
