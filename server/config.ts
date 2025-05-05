import toml from '@iarna/toml'
import fs from 'fs/promises'

import { AppConfig } from '../shared/types'
import { getConfigFilePath } from './paths'

export async function createConfigViaEnv(notebookDirectory: string) {
  // Initialize with required fields, they might be overwritten by loaded config
  let config: AppConfig = { automationModel: '', visionModel: '' }
  let cfgPath = getConfigFilePath(notebookDirectory)

  if (await fs.exists(cfgPath)) {
    config = await loadConfig(cfgPath)
  }

  migrateConfig(config) // Keep migrateConfig for potential future use, but it's empty now
  await saveConfig(config, cfgPath)

  return config
}

// Function to load and parse configuration from a TOML file
export async function loadConfig(filePath: string): Promise<AppConfig> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const parsedToml = toml.parse(fileContent) as any // Cast to any for easier access initially

    // Initialize the AppConfig object with required fields
    const config: AppConfig = {
      automationModel: parsedToml.automation_model ?? '',
      visionModel: parsedToml.vision_model ?? '',
    }

    // Map top-level fields
    config.haBaseUrl = parsedToml.ha_base_url
    config.haToken = parsedToml.ha_token
    config.timezone = parsedToml.timezone

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
    // Return a default config structure on error
    return { automationModel: '', visionModel: '' }
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
    if (config.timezone) {
      tomlStructure.timezone = config.timezone
    }
    // Add the new model fields
    if (config.automationModel) {
      tomlStructure.automation_model = config.automationModel
    }
    if (config.visionModel) {
      tomlStructure.vision_model = config.visionModel
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
  // Migration logic is removed as requested.
  // Keep the function signature for potential future migrations.
  // Set a default timezone if none is provided
  config.timezone ??= 'Etc/UTC'
}

/* example file

ha_base_url = "https://foo"
ha_token = "token"
timezone = "America/Los_Angeles"
automation_model = "anthropic/claude-3-5-sonnet-20240620"
vision_model = "openai/gpt-4o"

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
