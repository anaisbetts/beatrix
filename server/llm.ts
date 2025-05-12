import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Observable } from 'rxjs'

import { Automation, LLMFactoryType } from '../shared/types'
import { AppConfig } from '../shared/types'
import { parseModelWithDriverString } from '../shared/utility'
import { AnthropicLargeLanguageProvider } from './anthropic'
import { createCueServer } from './mcp/cue'
import { createHomeAssistantServer } from './mcp/home-assistant'
import { createMemoryServer } from './mcp/memory'
import { createNotifyServer } from './mcp/notify'
import { createSchedulerServer } from './mcp/scheduler'
import { OllamaLargeLanguageProvider } from './ollama'
import { OpenAILargeLanguageProvider } from './openai'
import { AutomationRuntime, getMemoryFile } from './workflow/automation-runtime'

export type ModelSpecifier =
  | {
      modelWithDriver?: string
      type?: never
    }
  | {
      modelWithDriver?: never
      type?: LLMFactoryType
    }

export interface LargeLanguageProvider {
  executePromptWithTools(
    prompt: string,
    toolServers: McpServer[],
    previousMessages?: MessageParam[],
    images?: ArrayBufferLike[]
  ): Observable<MessageParam>

  getModelList(): Promise<string[]>

  getModelWithDriver(): string
}

export function createDefaultLLMProvider(
  config: AppConfig,
  modelSpec?: ModelSpecifier
): LargeLanguageProvider {
  let mwd = modelSpec?.modelWithDriver
  switch (modelSpec?.type) {
    case 'automation':
      mwd = config.automationModel
      break
    case 'vision':
      mwd = config.visionModel
      break
    default:
      break
  }

  if (!mwd) {
    throw new Error('No model provided')
  }

  const { driver, model } = parseModelWithDriverString(mwd)

  switch (driver) {
    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new Error(
          "LLM provider set to 'anthropic' but anthropic.key is missing."
        )
      }

      return new AnthropicLargeLanguageProvider(config.anthropicApiKey, model)
    case 'ollama':
      if (!config.ollamaHost) {
        throw new Error(
          "LLM provider set to 'ollama' but ollama.host is missing."
        )
      }

      return new OllamaLargeLanguageProvider(config.ollamaHost, model)
    default:
      // Assume it's an OpenAI-compatible provider name
      const openAIProviderConfig = config.openAIProviders?.find(
        (p) => p.providerName === driver
      )
      if (!openAIProviderConfig || !openAIProviderConfig.apiKey) {
        throw new Error(
          `LLM provider set to '${driver}' but no corresponding OpenAI provider configuration with an API key was found.`
        )
      }

      return new OpenAILargeLanguageProvider({
        apiKey: openAIProviderConfig.apiKey,
        baseURL: openAIProviderConfig.baseURL,
        driverName: driver,
        model,
      })
  }
}

export function createBuiltinServers(
  runtime: AutomationRuntime,
  automationForScheduling: Automation | null,
  opts?: {
    testMode?: boolean
    includeCueServer?: boolean
    megaServer?: McpServer
    onImageReferenced?: (name: string, bytes: ArrayBufferLike) => void
  }
) {
  const { testMode, megaServer } = opts ?? {}
  const ret = [
    createNotifyServer(runtime.api, megaServer),
    createHomeAssistantServer(runtime, {
      testMode: testMode ?? false,
      megaServer: megaServer,
      onImageReferenced: opts?.onImageReferenced,
    }),
  ]

  if (automationForScheduling) {
    ret.push(
      createSchedulerServer(
        runtime.db,
        automationForScheduling.hash,
        runtime.timezone,
        runtime.api // Pass API for state validation
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
