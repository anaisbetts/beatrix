import { useCommand, usePromise } from '@anaisbetts/commands'
import { Check, Save } from 'lucide-react'
import { useCallback, useState } from 'react'
import { firstValueFrom } from 'rxjs'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

import { AppConfig, OpenAIProviderConfig } from '../../shared/types'
import { useWebSocket } from '../components/ws-provider'

const timezones = Intl.supportedValuesOf('timeZone')

export default function Config() {
  const { api } = useWebSocket()
  const [config, setConfig] = useState<AppConfig>({})
  const [isSaved, setIsSaved] = useState(false)

  // Fetch initial config
  const [fetchConfig, configResult] = useCommand(async () => {
    if (!api) return {}
    return await firstValueFrom(api.getConfig())
  }, [api])

  // Fetch config on component mount
  usePromise(async () => {
    if (!api) return

    const result = await fetchConfig()
    if (result) setConfig(result)
  }, [api, fetchConfig])

  // Handle form submission
  const [saveConfig, saveResult] = useCommand(async () => {
    if (!api) throw new Error('Not connected!')

    await firstValueFrom(api.setConfig(config))
    setIsSaved(true)
    setTimeout(() => setIsSaved(false), 1500)
    return { success: true }
  }, [config, api])

  // Handle basic field changes
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setConfig((prev) => ({ ...prev, [name]: value }))
  }, [])

  // Handle timezone change
  const handleTimezoneChange = useCallback((value: string) => {
    setConfig((prev) => ({ ...prev, timezone: value }))
  }, [])

  // Handle OpenAI provider changes
  const handleOpenAIProviderChange = useCallback(
    (index: number, field: keyof OpenAIProviderConfig, value: string) => {
      setConfig((prev) => {
        const updatedProviders = [...(prev.openAIProviders || [])]

        // Ensure the provider exists
        if (!updatedProviders[index]) {
          updatedProviders[index] = {}
        }

        // Update the field
        updatedProviders[index] = {
          ...updatedProviders[index],
          [field]: value,
        }

        return {
          ...prev,
          openAIProviders: updatedProviders,
        }
      })
    },
    []
  )

  // Add a new OpenAI provider
  const addOpenAIProvider = useCallback(() => {
    setConfig((prev) => {
      const updatedProviders = [
        ...(prev.openAIProviders || []),
        { providerName: '' },
      ]
      return {
        ...prev,
        openAIProviders: updatedProviders,
      }
    })
  }, [])

  // Remove an OpenAI provider
  const removeOpenAIProvider = useCallback((index: number) => {
    setConfig((prev) => {
      const updatedProviders = [...(prev.openAIProviders || [])]
      updatedProviders.splice(index, 1)
      return {
        ...prev,
        openAIProviders: updatedProviders,
      }
    })
  }, [])

  // Show loading state
  if (configResult.isPending()) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
      </div>
    )
  }

  // Show error state
  if (configResult.isErr()) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">Failed to load configuration</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Configuration</h2>
        <SaveButton
          saveResult={saveResult}
          onClick={() => void saveConfig()}
          isSaved={isSaved}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Home Assistant Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Home Assistant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="haBaseUrl" className="text-sm font-medium">
                Base URL
              </label>
              <Input
                id="haBaseUrl"
                name="haBaseUrl"
                value={config.haBaseUrl || ''}
                onChange={handleChange}
                placeholder="https://homeassistant.local:8123"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="haToken" className="text-sm font-medium">
                Access Token
              </label>
              <Input
                id="haToken"
                name="haToken"
                value={config.haToken || ''}
                onChange={handleChange}
                type="password"
                placeholder="Long-Lived Access Token"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="timezone" className="text-sm font-medium">
                Timezone
              </label>
              <Select
                value={config.timezone || ''}
                onValueChange={handleTimezoneChange}
              >
                <SelectTrigger id="timezone" className="w-64">
                  <SelectValue placeholder="Select timezone..." />
                </SelectTrigger>

                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Select your local IANA timezone.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* LLM Selection */}
        <Card>
          <CardHeader>
            <CardTitle>LLM Provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="llm" className="text-sm font-medium">
                Default LLM Provider
              </label>
              <Input
                id="llm"
                name="llm"
                value={config.llm || ''}
                onChange={handleChange}
                placeholder="anthropic, ollama, or provider name"
              />
              <p className="text-xs text-gray-500">
                Enter 'anthropic', 'ollama', or a provider name from your OpenAI
                providers
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Anthropic Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Anthropic Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="anthropicApiKey" className="text-sm font-medium">
                API Key
              </label>
              <Input
                id="anthropicApiKey"
                name="anthropicApiKey"
                value={config.anthropicApiKey || ''}
                onChange={handleChange}
                type="password"
                placeholder="Anthropic API Key"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="anthropicModel" className="text-sm font-medium">
                Model
              </label>
              <Input
                id="anthropicModel"
                name="anthropicModel"
                value={config.anthropicModel || ''}
                onChange={handleChange}
                placeholder="claude-3-opus-20240229"
              />
            </div>
          </CardContent>
        </Card>

        {/* Ollama Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Ollama Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="ollamaHost" className="text-sm font-medium">
                Host
              </label>
              <Input
                id="ollamaHost"
                name="ollamaHost"
                value={config.ollamaHost || ''}
                onChange={handleChange}
                placeholder="http://localhost:11434"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="ollamaModel" className="text-sm font-medium">
                Model
              </label>
              <Input
                id="ollamaModel"
                name="ollamaModel"
                value={config.ollamaModel || ''}
                onChange={handleChange}
                placeholder="llama3"
              />
            </div>
          </CardContent>
        </Card>

        {/* OpenAI Providers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>OpenAI Providers</CardTitle>
            <Button variant="outline" onClick={addOpenAIProvider}>
              Add Provider
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {(config.openAIProviders || []).map((provider, index) => (
              <div key={index} className="space-y-4 pb-4">
                {index > 0 && <Separator className="my-4" />}
                <div className="flex justify-between items-center">
                  <h3 className="text-md font-medium">Provider {index + 1}</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeOpenAIProvider(index)}
                    className="text-red-500"
                  >
                    Remove
                  </Button>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Provider Name</label>
                  <Input
                    value={provider.providerName || ''}
                    onChange={(e) =>
                      handleOpenAIProviderChange(
                        index,
                        'providerName',
                        e.target.value
                      )
                    }
                    placeholder="openai, google, etc."
                  />
                  <p className="text-xs text-gray-500">
                    Default provider should be named 'openai'
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Base URL</label>
                  <Input
                    value={provider.baseURL || ''}
                    onChange={(e) =>
                      handleOpenAIProviderChange(
                        index,
                        'baseURL',
                        e.target.value
                      )
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                  <p className="text-xs text-gray-500">
                    Leave empty for official OpenAI API
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    value={provider.apiKey || ''}
                    onChange={(e) =>
                      handleOpenAIProviderChange(
                        index,
                        'apiKey',
                        e.target.value
                      )
                    }
                    type="password"
                    placeholder="API Key"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model</label>
                  <Input
                    value={provider.model || ''}
                    onChange={(e) =>
                      handleOpenAIProviderChange(index, 'model', e.target.value)
                    }
                    placeholder="gpt-4-turbo"
                  />
                </div>
              </div>
            ))}

            {(!config.openAIProviders ||
              config.openAIProviders.length === 0) && (
              <div className="text-center py-4 text-gray-500">
                No OpenAI providers configured. Click "Add Provider" to add one.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Result Status and Button */}
        <div className="flex items-center justify-end py-4">
          {saveResult.mapOrElse({
            ok: () => null,
            err: (error) => (
              <div className="text-red-500 mr-4">
                Failed to save: {error.message}
              </div>
            ),
            pending: () => null,
            null: () => null,
          })}
          <SaveButton
            saveResult={saveResult}
            onClick={() => void saveConfig()}
            isSaved={isSaved}
          />
        </div>
      </div>
    </div>
  )
}

interface SaveButtonProps {
  saveResult: ReturnType<typeof useCommand>[1]
  onClick: () => void
  isSaved: boolean
}

function SaveButton({ saveResult, onClick, isSaved }: SaveButtonProps) {
  const buttonContent = saveResult.mapOrElse({
    pending: () => (
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
        <span>Saving...</span>
      </div>
    ),
    ok: () =>
      isSaved ? (
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span>Saved!</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          <span>Save Configuration</span>
        </div>
      ),
    err: () => (
      <div className="flex items-center gap-2">
        <Save className="h-4 w-4" />
        <span>Save Configuration</span>
      </div>
    ),
    null: () => (
      <div className="flex items-center gap-2">
        <Save className="h-4 w-4" />
        <span>Save Configuration</span>
      </div>
    ),
  })

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={saveResult.isPending() || isSaved}
      className="min-w-28"
    >
      {buttonContent}
    </Button>
  )
}
