import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AnthropicLargeLanguageProvider,
  OllamaLargeLanguageProvider,
} from './execute-prompt-with-tools'

export interface LargeLanguageProvider {
  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[]
  ): Promise<MessageParam[]>
}

export function createDefaultLLMProvider() {
  let llm: LargeLanguageProvider

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Found Anthropic API key, using Anthropic as provider')
    llm = new AnthropicLargeLanguageProvider(process.env.ANTHROPIC_API_KEY)
  } else if (process.env.OLLAMA_HOST) {
    console.log('Found Ollama host, using Ollama as provider')
    llm = new OllamaLargeLanguageProvider(process.env.OLLAMA_HOST)
  } else {
    throw new Error(
      "Can't find valid LLM provider. Set either ANTHROPIC_API_KEY or OLLAMA_HOST"
    )
  }

  return llm
}
