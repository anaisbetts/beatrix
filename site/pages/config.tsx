import { useCommand, usePromise, useResult } from '@anaisbetts/commands'
import { Check, Save } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { firstValueFrom } from 'rxjs'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  const [config, setConfig] = useState<AppConfig>({
    automationModel: '',
    visionModel: '',
  })
  const [isSaved, setIsSaved] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showCompletionDialog, setShowCompletionDialog] = useState(false)
  const [debugReportError, setDebugReportError] = useState<string | null>(null)

  // Fetch initial config
  const [fetchConfig, configResult] = useCommand(async () => {
    if (!api) return { automationModel: '', visionModel: '' }
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

  // Command for generating debug report
  const [generateDebugReport, debugReportResult] = useCommand(async () => {
    if (!api) throw new Error('Not connected!')
    setDebugReportError(null)
    try {
      await firstValueFrom(api.captureBugReport())
      setShowCompletionDialog(true)
      return { success: true }
    } catch (error) {
      setDebugReportError(
        error instanceof Error ? error.message : 'An unknown error occurred'
      )
      throw error
    }
  }, [api])

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
    (
      index: number,
      field: keyof Omit<OpenAIProviderConfig, 'model'>,
      value: string
    ) => {
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

  const handleGenerateDebugReportClick = useCallback(() => {
    setShowConfirmDialog(true)
  }, [])

  const handleConfirmDebugReport = useCallback(() => {
    setShowConfirmDialog(false)
    generateDebugReport().catch((error) => {
      // Error is already handled within the useCommand hook and state is updated
      console.error('Error generating debug report:', error)
    })
  }, [generateDebugReport])

  const handleCancelDebugReport = useCallback(() => {
    setShowConfirmDialog(false)
  }, [])

  const handleCloseCompletionDialog = useCallback(() => {
    setShowCompletionDialog(false)
  }, [])

  const saveResultContent = useResult(saveResult, {
    ok: () => null,
    err: (error) => (
      <div className="text-red-500">
        Failed to save configuration: {error.message}
      </div>
    ),
    pending: () => null,
    null: () => null,
  })

  const timezonesSelectContent = useMemo(() => {
    return timezones.map((tz) => (
      <SelectItem key={tz} value={tz}>
        {tz}
      </SelectItem>
    ))
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
          onClick={saveConfig}
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

                <SelectContent>{timezonesSelectContent}</SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Select your local IANA timezone.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Model Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="automationModel" className="text-sm font-medium">
                Automation Model
              </label>
              <Input
                id="automationModel"
                name="automationModel"
                value={config.automationModel || ''}
                onChange={handleChange}
                placeholder="anthropic/claude-3-5-sonnet-20240620"
              />
              <p className="text-xs text-gray-500">
                Format: driver/model (e.g.,
                anthropic/claude-3-5-sonnet-20240620, openai/gpt-4-turbo,
                ollama/llama3)
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="visionModel" className="text-sm font-medium">
                Vision Model
              </label>
              <Input
                id="visionModel"
                name="visionModel"
                value={config.visionModel || ''}
                onChange={handleChange}
                placeholder="openai/gpt-4o"
              />
              <p className="text-xs text-gray-500">
                Format: driver/model (e.g., openai/gpt-4o,
                anthropic/claude-3-5-sonnet-20240620)
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

        {/* Debug Report Section */}
        <Card>
          <CardHeader>
            <CardTitle>Debugging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Generate a debug report containing automation configurations and
              Home Assistant details. This can be helpful for troubleshooting.
            </p>
            <Button
              variant="outline"
              onClick={handleGenerateDebugReportClick}
              disabled={debugReportResult.isPending()}
            >
              {debugReportResult.isPending()
                ? 'Generating Report...'
                : 'Generate Debug Report'}
            </Button>
            {debugReportError && (
              <p className="text-sm text-red-500">
                Error generating report: {debugReportError}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Save Result Status and Button */}
        <div className="flex items-center justify-end py-4">
          {saveResultContent}

          <SaveButton
            saveResult={saveResult}
            onClick={saveConfig}
            isSaved={isSaved}
          />
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate Debug Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will capture your list of automations and details about your
              Home Assistant installation (excluding sensitive tokens) into the{' '}
              <code>app.db</code> file. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDebugReport}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDebugReport}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Completion Dialog */}
      <AlertDialog
        open={showCompletionDialog}
        onOpenChange={setShowCompletionDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Debug Report Generated</AlertDialogTitle>
            <AlertDialogDescription>
              The debug report has been successfully generated and saved to{' '}
              <code>app.db</code>. Please send this file to the developer for
              analysis.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseCompletionDialog}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface SaveButtonProps {
  saveResult: ReturnType<typeof useCommand>[1]
  onClick: () => void
  isSaved: boolean
}

function SaveButton({ saveResult, onClick, isSaved }: SaveButtonProps) {
  const buttonContent = useResult(saveResult, {
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
