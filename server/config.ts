import toml from '@iarna/toml'
import fs from 'fs/promises'

// Interface for a single OpenAI provider configuration
export interface OpenAIProviderConfig {
  providerName?: string // Name for this provider configuration
  baseURL?: string
  apiKey?: string
}

// Main application configuration interface
export interface AppConfig {
  anthropicApiKey?: string
  ollamaHost?: string
  openAIProviders?: OpenAIProviderConfig[] // Array for multiple OpenAI configs
  haBaseUrl?: string
  haToken?: string
}

// Function to load and parse configuration from a TOML file
export async function loadConfig(filePath: string): Promise<AppConfig> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')
    // Parse using @iarna/toml. It returns a structured object or throws on error.
    // We might need to cast if types aren't perfectly aligned, but @iarna/toml has decent types.
    const parsedToml = toml.parse(fileContent) as any // Cast to any for easier access initially

    // Initialize the AppConfig object
    const config: AppConfig = {}

    // Map top-level fields
    config.haBaseUrl = parsedToml.ha_base_url
    config.haToken = parsedToml.ha_token

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

    return config
  } catch (error) {
    console.error(`Error loading or parsing config file at ${filePath}:`, error)
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
