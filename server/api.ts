import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LargeLanguageProvider } from './llm'
import { BunRequest } from 'bun'
import { Kysely } from 'kysely'
import { Schema } from './db-schema'

export async function handlePromptRequest(
  db: Kysely<Schema>,
  llm: LargeLanguageProvider,
  tools: McpServer[],
  req: BunRequest<'/api/prompt'>
): Promise<Response> {
  const { prompt } = await req.json()
  try {
    const resp = await llm.executePromptWithTools(prompt, tools)
    await db
      .insertInto('automationLogs')
      .values({
        type: 'manual',
        messageLog: JSON.stringify(resp),
      })
      .execute()

    return Response.json({ prompt, messages: resp })
  } catch (e) {
    console.error(e)
    return Response.json({ prompt, error: JSON.stringify(e) })
  }
}
