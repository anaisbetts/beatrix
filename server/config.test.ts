import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'fs/promises'
import path from 'path'

import { OpenAIProviderConfig } from '../shared/types'
import { AppConfig } from '../shared/types'
import { loadConfig, saveConfig } from './config'

// Define a reusable path for the temp file
const tempConfigPath = path.resolve(__dirname, '../mocks/temp.config.test.toml')

// Cleanup function to remove the temp file
const cleanupTempFile = async () => {
  try {
    await fs.unlink(tempConfigPath)
  } catch (error: any) {
    // Ignore error if file doesn't exist (e.g., test failed before creating it)
    if (error.code !== 'ENOENT') {
      console.error('Error cleaning up temp config file:', error)
    }
  }
}

// Ensure cleanup runs after each test in this suite
afterEach(async () => {
  await cleanupTempFile()
})

describe('loadConfig', () => {
  it('should correctly parse the mock TOML config file', async () => {
    const mockConfigPath = path.resolve(__dirname, '../mocks/mock.config.toml')
    const config = await loadConfig(mockConfigPath)

    // Check top-level fields
    expect(config.haBaseUrl).toBe('https://foo')
    expect(config.haToken).toBe('token')
    expect(config.timezone).toBe('America/Los_Angeles')
    expect(config.automationModel).toBe('anthropic/claude-3-5-sonnet-20240620')
    expect(config.visionModel).toBe('openai/gpt-4o')

    // Check nested fields
    expect(config.anthropicApiKey).toBe('wiefjef')
    expect(config.ollamaHost).toBe('weofijwef')

    // Check OpenAI providers array
    expect(config.openAIProviders).toBeDefined()
    expect(config.openAIProviders?.length).toBe(3)

    // Check default OpenAI provider (from [openai] key)
    const defaultOpenAI = config.openAIProviders?.find(
      (p) => p.providerName === 'openai'
    )
    expect(defaultOpenAI).toBeDefined()
    expect(defaultOpenAI?.apiKey).toBe('woefj')
    expect(defaultOpenAI?.baseURL).toBeUndefined() // No base_url specified for default

    // Check google OpenAI provider
    const googleOpenAI = config.openAIProviders?.find(
      (p) => p.providerName === 'google'
    )
    expect(googleOpenAI).toBeDefined()
    expect(googleOpenAI?.apiKey).toBe('woefj')
    expect(googleOpenAI?.baseURL).toBe('https://efoiwejf')

    // Check scaleway OpenAI provider
    const scalewayOpenAI = config.openAIProviders?.find(
      (p) => p.providerName === 'scaleway'
    )
    expect(scalewayOpenAI).toBeDefined()
    expect(scalewayOpenAI?.apiKey).toBe('woefj')
    expect(scalewayOpenAI?.baseURL).toBe('https://efoiwejf')
  })

  it('should return default structure if the file does not exist', async () => {
    const nonExistentPath = path.resolve(__dirname, '../mocks/nonexistent.toml')
    const config = await loadConfig(nonExistentPath)
    expect(config).toEqual({ automationModel: '', visionModel: '' })
  })

  it('should return default structure for invalid TOML', async () => {
    // Create a temporary invalid TOML file for this test
    const invalidTomlPath = path.resolve(__dirname, '../mocks/invalid.toml')
    // Ensure cleanup for this specific file too
    try {
      await fs.writeFile(invalidTomlPath, 'invalid toml content ===')
      const config = await loadConfig(invalidTomlPath)
      expect(config).toEqual({ automationModel: '', visionModel: '' })
    } finally {
      try {
        await fs.unlink(invalidTomlPath)
      } catch {}
    }
  })
})

describe('saveConfig', () => {
  it('should correctly serialize an AppConfig object to a TOML file', async () => {
    const sampleConfig: AppConfig = {
      haBaseUrl: 'https://home.example.com',
      haToken: 'test-token-123',
      timezone: 'Europe/London',
      automationModel: 'openai/gpt-4-turbo',
      visionModel: 'openai/gpt-4o',
      anthropicApiKey: 'anthropic-key',
      ollamaHost: 'http://ollama.local:11434',
      openAIProviders: [
        {
          providerName: 'openai', // Default provider
          apiKey: 'openai-default-key',
        },
        {
          providerName: 'google',
          apiKey: 'google-api-key',
          baseURL: 'https://google.ai/api',
        },
        {
          providerName: 'custom', // Provider with only api key
          apiKey: 'custom-key',
        },
        {
          providerName: 'another', // Provider with only base url
          baseURL: 'https://another.com',
        },
      ],
    }

    // Save the config
    await saveConfig(sampleConfig, tempConfigPath)

    // Load the config back to verify
    const loadedConfig = await loadConfig(tempConfigPath)

    // Assert deep equality
    // Sort provider arrays before comparing to handle potential order differences
    const sortProviders = (
      providers: OpenAIProviderConfig[] | undefined
    ): OpenAIProviderConfig[] =>
      providers
        ? [...providers].sort((a, b) =>
            (a.providerName ?? '').localeCompare(b.providerName ?? '')
          )
        : []

    const expectedConfig = { ...sampleConfig } // Create a copy

    // Compare sorted arrays directly
    expect(sortProviders(loadedConfig.openAIProviders)).toEqual(
      sortProviders(expectedConfig.openAIProviders) // Compare against the original expected providers
    )

    // Compare the rest of the fields using toEqual against the literal expected values
    expect(loadedConfig.haBaseUrl).toEqual('https://home.example.com')
    expect(loadedConfig.haToken).toEqual('test-token-123')
    expect(loadedConfig.timezone).toEqual('Europe/London')
    expect(loadedConfig.automationModel).toEqual('openai/gpt-4-turbo')
    expect(loadedConfig.visionModel).toEqual('openai/gpt-4o')
    expect(loadedConfig.anthropicApiKey).toEqual('anthropic-key')
    expect(loadedConfig.ollamaHost).toEqual('http://ollama.local:11434')
  })

  it('should handle missing optional fields correctly when saving', async () => {
    const partialConfig: AppConfig = {
      automationModel: 'ollama/some-model',
      visionModel: '',
      haBaseUrl: 'https://partial.test',
      openAIProviders: [{ providerName: 'openai', apiKey: 'partial-key' }],
    }

    await saveConfig(partialConfig, tempConfigPath)
    const loadedConfig = await loadConfig(tempConfigPath)

    expect(loadedConfig.automationModel).toBe('ollama/some-model')
    expect(loadedConfig.visionModel).toBe('')
    expect(loadedConfig.haBaseUrl).toBe('https://partial.test')
    expect(loadedConfig.haToken).toBeUndefined()
    expect(loadedConfig.timezone).toBeUndefined()
    expect(loadedConfig.anthropicApiKey).toBeUndefined()
    expect(loadedConfig.ollamaHost).toBeUndefined()
    expect(loadedConfig.openAIProviders).toBeDefined()
    expect(loadedConfig.openAIProviders?.length).toBe(1)
    expect(loadedConfig.openAIProviders?.[0].providerName).toBe('openai')
    expect(loadedConfig.openAIProviders?.[0].apiKey).toBe('partial-key')
    expect(loadedConfig.openAIProviders?.[0].baseURL).toBeUndefined()
  })

  it('should create an empty file if config object only has empty required fields', async () => {
    const emptyRequiredConfig: AppConfig = {
      automationModel: '',
      visionModel: '',
    }
    await saveConfig(emptyRequiredConfig, tempConfigPath)

    const fileContent = await fs.readFile(tempConfigPath, 'utf-8')
    expect(fileContent.trim()).toBe('')

    const loadedConfig = await loadConfig(tempConfigPath)
    expect(loadedConfig).toEqual({ automationModel: '', visionModel: '' })
  })
})
