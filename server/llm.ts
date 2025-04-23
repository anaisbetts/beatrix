import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Observable } from 'rxjs'

import { Automation } from '../shared/types'
import { AppConfig } from '../shared/types'
import { AnthropicLargeLanguageProvider } from './anthropic'
import { createCueServer } from './mcp/cue'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { createMemoryServer } from './mcp/memory'
import { createNotifyServer } from './mcp/notify'
import { createSchedulerServer } from './mcp/scheduler'
import { OllamaLargeLanguageProvider } from './ollama'
import { OpenAILargeLanguageProvider } from './openai'
import { AutomationRuntime, getMemoryFile } from './workflow/automation-runtime'

export interface LargeLanguageProvider {
  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[]
  ): Observable<MessageParam>

  getModelList(): Promise<string[]>
}

export function createDefaultLLMProvider(
  config: AppConfig,
  driver?: string,
  model?: string
): LargeLanguageProvider {
  const providerName = driver ?? config.llm
  if (!providerName) {
    throw new Error('No driver provided and no default config')
  }

  let effectiveModel = model ?? getDefaultModelForDriver(config, providerName)

  if (!providerName) {
    throw new Error(
      'LLM provider name (config.llm) is not configured. Please check your config file or environment variables.'
    )
  }

  switch (providerName) {
    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new Error(
          "LLM provider set to 'anthropic' but anthropic.key is missing."
        )
      }

      return new AnthropicLargeLanguageProvider(
        config.anthropicApiKey,
        effectiveModel
      )
    case 'ollama':
      if (!config.ollamaHost) {
        throw new Error(
          "LLM provider set to 'ollama' but ollama.host is missing."
        )
      }

      return new OllamaLargeLanguageProvider(config.ollamaHost, effectiveModel)
    default:
      // Assume it's an OpenAI-compatible provider name
      const openAIProviderConfig = config.openAIProviders?.find(
        (p) => p.providerName === providerName
      )
      if (!openAIProviderConfig || !openAIProviderConfig.apiKey) {
        throw new Error(
          `LLM provider set to '${providerName}' but no corresponding OpenAI provider configuration with an API key was found.`
        )
      }

      return new OpenAILargeLanguageProvider({
        apiKey: openAIProviderConfig.apiKey,
        baseURL: openAIProviderConfig.baseURL,
        model: effectiveModel,
      })
  }
}

export function getDefaultModelForDriver(
  config: AppConfig,
  driver: string
): string {
  switch (driver) {
    case 'anthropic':
      return config.anthropicModel ?? 'claude-3-7-sonnet-20250219'
    case 'ollama':
      return config.ollamaModel ?? 'qwen2.5:14b'
    case 'openai':
      return (
        config.openAIProviders?.find((p) => p.providerName === driver)?.model ??
        'gpt4.1'
      )
    default:
      throw new Error(`Unsupported driver: ${driver}`)
  }
}

export function createBuiltinServers(
  runtime: AutomationRuntime,
  automationForScheduling: Automation | null,
  opts?: {
    testMode?: boolean
    includeCueServer?: boolean
    megaServer?: McpServer
  }
) {
  const { testMode, megaServer } = opts ?? {}
  const ret = [
    createNotifyServer(runtime.api, megaServer),
    createHomeAssistantServer(runtime, {
      testMode: testMode ?? false,
      megaServer: megaServer,
    }),
  ]

  if (automationForScheduling) {
    ret.push(
      createSchedulerServer(
        runtime.db,
        automationForScheduling.hash,
        runtime.timezone
      )
    )
  }

  if (runtime.notebookDirectory) {
    ret.push(createMemoryServer(getMemoryFile(runtime)))
  }

  if (opts?.includeCueServer && runtime.notebookDirectory) {
    ret.push(createCueServer(runtime, { testMode: opts.testMode }))
  }

  return ret
}

export function connectServerToClient(client: Client, server: Server) {
  const [cli, srv] = InMemoryTransport.createLinkedPair()
  void client.connect(cli)
  void server.connect(srv)
}
