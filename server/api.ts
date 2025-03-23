import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LargeLanguageProvider } from './llm'
import { BunRequest } from 'bun'

export async function handlePromptRequest(
  llm: LargeLanguageProvider,
  tools: McpServer[],
  req: BunRequest<'/api/prompt'>
): Promise<Response> {
  const { prompt } = await req.json()
  try {
    const resp = await llm.executePromptWithTools(prompt, tools)
    return Response.json({ prompt, messages: resp })
  } catch (e) {
    console.error(e)
    return Response.json({ prompt, error: JSON.stringify(e) })
  }
}
