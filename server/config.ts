import toml from '@iarna/toml'
import debug from 'debug'
import fs from 'fs/promises'
import path from 'path'

import { getDataDir } from './utils'

const d = debug('b:config')

// Interface for a single OpenAI provider configuration
export interface OpenAIProviderConfig {
  providerName?: string // Name for this provider configuration, the default is 'openai'
  baseURL?: string
  apiKey?: string
}

// Main application configuration interface
export interface AppConfig {
  haBaseUrl?: string
  haToken?: string

  llm?: string // either 'anthropic', 'ollama', or a provider name in openAIProviders

  anthropicApiKey?: string
  ollamaHost?: string
  openAIProviders?: OpenAIProviderConfig[] // Array for multiple OpenAI configs
}

export async function createConfigViaEnv() {
  // Provide a default llm to satisfy the type, migration will fix it
  let config: AppConfig = {}
  let cfgPath = path.join(getDataDir(), 'config.toml')

  if (await fs.exists(cfgPath)) {
    config = await loadConfig(cfgPath)
  }

  migrateConfig(config)
  await saveConfig(config, cfgPath)

  return config
}

// Function to load and parse configuration from a TOML file
export async function loadConfig(filePath: string): Promise<AppConfig> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')
    // Parse using @iarna/toml. It returns a structured object or throws on error.
    // We might need to cast if types aren't perfectly aligned, but @iarna/toml has decent types.
    const parsedToml = toml.parse(fileContent) as any // Cast to any for easier access initially

    // Initialize the AppConfig object with a default llm to satisfy type
    const config: AppConfig = { llm: 'openai' }

    // Map top-level fields
    config.haBaseUrl = parsedToml.ha_base_url
    config.haToken = parsedToml.ha_token
    // Load the primary LLM provider choice
    config.llm = parsedToml.llm

    // Map nested fields safely
    config.anthropicApiKey = parsedToml.anthropic?.key
    config.ollamaHost = parsedToml.ollama?.host

    // Transform the OpenAI configuration
    config.openAIProviders = []
    if (parsedToml.openai) {
      for (const key in parsedToml.openai) {
        if (Object.prototype.hasOwnProperty.call(parsedToml.openai, key)) {
          const providerData = parsedToml.openai[key]
          if (key === 'key' && typeof providerData === 'string') {
            // Handle the default [openai] key
            config.openAIProviders.push({
              providerName: 'openai', // Default name
              apiKey: providerData,
            })
          } else if (
            typeof providerData === 'object' &&
            providerData !== null
          ) {
            // Handle named providers like [openai.google]
            config.openAIProviders.push({
              providerName: key,
              baseURL: providerData.base_url,
              apiKey: providerData.key,
            })
          }
        }
      }
    }
    // Ensure the array is not empty before assigning, or assign undefined
    if (config.openAIProviders.length === 0) {
      config.openAIProviders = undefined
    }

    // Validate the loaded LLM config if llm field exists
    if (config.llm) {
      validateLlmConfig(config, 'loadConfig')
    }

    return config
  } catch (error) {
    console.error(`Error loading or parsing config file at ${filePath}:`, error)
    // Return a default config structure on error to satisfy type, migration will handle env vars
    return {}
  }
}

// Function to serialize AppConfig and save to a TOML file
export async function saveConfig(
  config: AppConfig,
  filePath: string
): Promise<void> {
  try {
    // Create the structure expected by the TOML format
    const tomlStructure: any = {}

    if (config.haBaseUrl) {
      tomlStructure.ha_base_url = config.haBaseUrl
    }
    if (config.haToken) {
      tomlStructure.ha_token = config.haToken
    }
    if (config.llm) {
      tomlStructure.llm = config.llm
    }
    if (config.anthropicApiKey) {
      tomlStructure.anthropic = { key: config.anthropicApiKey }
    }
    if (config.ollamaHost) {
      tomlStructure.ollama = { host: config.ollamaHost }
    }

    // Handle OpenAI providers
    if (config.openAIProviders && config.openAIProviders.length > 0) {
      tomlStructure.openai = {}
      for (const provider of config.openAIProviders) {
        if (provider.providerName === 'openai') {
          // Default OpenAI key
          if (provider.apiKey) {
            tomlStructure.openai.key = provider.apiKey
          }
          // Note: A default provider might also have a base_url, handle if needed
        } else if (provider.providerName) {
          // Named provider [openai.providerName]
          const providerSection: any = {}
          if (provider.baseURL) {
            providerSection.base_url = provider.baseURL
          }
          if (provider.apiKey) {
            providerSection.key = provider.apiKey
          }
          // Only add the section if it has content
          if (Object.keys(providerSection).length > 0) {
            tomlStructure.openai[provider.providerName] = providerSection
          }
        }
      }
      // If the openai section ended up empty, remove it
      if (Object.keys(tomlStructure.openai).length === 0) {
        delete tomlStructure.openai
      }
    }

    // Stringify using @iarna/toml
    const tomlString = toml.stringify(tomlStructure)

    // Write the file
    await fs.writeFile(filePath, tomlString, 'utf-8')
  } catch (error) {
    console.error(`Error saving config file to ${filePath}:`, error)
    // Rethrow or handle as appropriate for your application
    throw error
  }
}

export function migrateConfig(config: AppConfig) {
  // Migrate simple string fields if they are missing in the config
  config.haBaseUrl ??= process.env.HA_BASE_URL
  config.haToken ??= process.env.HA_TOKEN
  config.anthropicApiKey ??= process.env.ANTHROPIC_API_KEY
  config.ollamaHost ??= process.env.OLLAMA_HOST

  // Migrate the default OpenAI API key if it's missing
  const defaultOpenAIKey = process.env.OPENAI_API_KEY
  if (defaultOpenAIKey) {
    // Ensure the providers array exists
    config.openAIProviders ??= []

    // Find the default provider
    let defaultProvider = config.openAIProviders.find(
      (p) => p.providerName === 'openai'
    )

    if (defaultProvider) {
      // If default provider exists, update its key only if missing
      defaultProvider.apiKey ??= defaultOpenAIKey
    } else {
      // If default provider doesn't exist, add it
      config.openAIProviders.push({
        providerName: 'openai',
        apiKey: defaultOpenAIKey,
      })
    }
  }

  // Migrate the llm field if it's not set
  if (!config.llm) {
    d(
      'LLM provider ("llm") not specified, attempting to infer from configuration...'
    )
    if (config.anthropicApiKey) {
      config.llm = 'anthropic'
      d('Inferred LLM provider: anthropic (Anthropic API key found)')
    } else if (
      config.openAIProviders?.some(
        (p) => p.providerName === 'openai' && p.apiKey
      )
    ) {
      config.llm = 'openai'
      d('Inferred LLM provider: openai (Default OpenAI provider key found)')
    } else if (config.ollamaHost) {
      config.llm = 'ollama'
      d('Inferred LLM provider: ollama (Ollama host found)')
    } else {
      // Last resort default if nothing else is configured
      config.llm = 'openai'
      console.warn(
        'Could not infer LLM provider from config or environment variables. Defaulting to "openai". Ensure configuration is correct.'
      )
      d('Could not infer LLM provider, defaulted to "openai"')
    }
  }

  // Validate the final LLM configuration after migration
  validateLlmConfig(config, 'migrateConfig')
}

// Helper function for validation
function validateLlmConfig(config: AppConfig, context: string) {
  d('[%s] Validating config for LLM: %s', context, config.llm)
  if (config.llm === 'anthropic' && !config.anthropicApiKey) {
    console.warn(
      `[${context}] LLM is set to 'anthropic' but Anthropic API key is missing.`
    )
  } else if (config.llm === 'ollama' && !config.ollamaHost) {
    console.warn(
      `[${context}] LLM is set to 'ollama' but Ollama host is missing.`
    )
  } else if (config.llm !== 'anthropic' && config.llm !== 'ollama') {
    // Check if it's a named OpenAI provider
    const providerExists = config.openAIProviders?.some(
      (p) => p.providerName === config.llm && p.apiKey
    )
    if (!providerExists) {
      console.warn(
        `[${context}] LLM is set to '${config.llm}', but no corresponding OpenAI provider with that name and an API key was found.`
      )
    }
  }
}

/* example file

ha_base_url = "https://foo"
ha_token = "token"

[anthropic]
key = "wiefjef"

[ollama]
host = "weofijwef"

[openai]
key = "woefj"

[openai.google]
base_url = "https://efoiwejf"
key = "woefj"

[openai.scaleway]
base_url = "https://efoiwejf"
key = "woefj"

*/
