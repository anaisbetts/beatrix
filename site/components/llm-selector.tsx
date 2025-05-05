import { usePromise, useResult } from '@anaisbetts/commands'
import { Check, Copy } from 'lucide-react'
import { useCallback, useState } from 'react'
import { firstValueFrom } from 'rxjs'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { parseModelWithDriverString } from '../../shared/utility'
import { Button } from './ui/button'
import { useWebSocket } from './ws-provider'

interface DriverSelectorProps {
  driver: string
  onDriverChange: (value: string) => void
  disabled?: boolean
}

export function DriverSelector({
  driver,
  onDriverChange,
  disabled,
}: DriverSelectorProps) {
  const { api } = useWebSocket()

  const driverList = usePromise(async () => {
    if (!api) return { defaultDriver: '', drivers: [] }
    const { automationModelWithDriver, drivers } = await firstValueFrom(
      api.getDriverList()
    )

    const { driver } = parseModelWithDriverString(automationModelWithDriver)

    onDriverChange(driver)
    return { defaultDriver: driver, drivers }
  }, [api])

  return useResult(
    driverList,
    {
      ok: ({ drivers }) => {
        const sortedDrivers = [...drivers].sort((a, b) => a.localeCompare(b))
        return (
          <Select
            value={driver}
            onValueChange={onDriverChange}
            disabled={disabled || sortedDrivers.length === 0}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select driver" />
            </SelectTrigger>
            <SelectContent>
              {sortedDrivers.map((d) => (
                <SelectItem key={d} value={d}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      },
      err: () => (
        <div className="text-sm text-red-500">Failed to load drivers</div>
      ),
      pending: () => (
        <div className="flex h-10 w-[180px] items-center justify-center">
          <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
        </div>
      ),
      null: () => <div className="text-sm italic">Select a driver</div>,
    },
    [driver]
  )
}

interface ModelSelectorProps {
  driver: string
  model: string
  onModelChange: (newModel: string) => void
  className?: string
  triggerClassName?: string
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ModelSelector({
  driver,
  model,
  onModelChange,
  className = 'flex items-center gap-2',
  triggerClassName = 'w-64',
  disabled = false,
  onOpenChange,
}: ModelSelectorProps) {
  const { api } = useWebSocket()
  const [isCopied, setIsCopied] = useState(false)

  const modelList = usePromise(async () => {
    if (!api || !driver) return { defaultModel: '', models: [] }
    const ret = await firstValueFrom(api.getModelListForDriver(driver))

    return ret
  }, [api, driver])

  const handleCopy = useCallback(async () => {
    if (!model) return
    try {
      await navigator.clipboard.writeText(model)
      console.log(`Model name "${model}" copied to clipboard.`)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy model name: ', err)
    }
  }, [model])

  return useResult(
    modelList,
    {
      ok: ({ models }) => {
        const sortedModels = [...models].sort((a, b) => a.localeCompare(b))
        return (
          <div className={className}>
            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={disabled || sortedModels.length === 0}
              onOpenChange={onOpenChange}
            >
              <SelectTrigger className={triggerClassName}>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {sortedModels.length === 0 ? (
                  <SelectItem value="no-models" disabled>
                    No models available for {driver}
                  </SelectItem>
                ) : (
                  sortedModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleCopy()}
              disabled={!model || disabled || isCopied}
              aria-label="Copy model name"
            >
              {isCopied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        )
      },
      err: () => (
        <div
          className={`flex h-10 items-center ${triggerClassName} text-sm text-red-500`}
        >
          Failed to load models
        </div>
      ),
      pending: () => (
        <div
          className={`flex h-10 items-center justify-center ${triggerClassName}`}
        >
          <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
        </div>
      ),
      null: () => (
        <div
          className={`flex h-10 items-center ${triggerClassName} text-sm italic`}
        >
          Select a driver
        </div>
      ),
    },
    [
      className,
      disabled,
      driver,
      handleCopy,
      isCopied,
      model,
      modelList,
      onModelChange,
      onOpenChange,
      triggerClassName,
    ]
  )
}
