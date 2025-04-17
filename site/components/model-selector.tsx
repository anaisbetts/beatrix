import { usePromise } from '@anaisbetts/commands'
import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import React from 'react'
import { firstValueFrom } from 'rxjs'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useWebSocket } from './ws-provider'

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
    if (!api || !driver) return []
    const models = await firstValueFrom(api.getModelListForDriver(driver))
    if (models.length > 0 && (!model || !models.includes(model)) && !disabled) {
      onModelChange(models[0])
    }
    return models
  }, [api, driver, model, disabled])

  const handleCopy = async () => {
    if (!model) return
    try {
      await navigator.clipboard.writeText(model)
      console.log(`Model name "${model}" copied to clipboard.`)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy model name: ', err)
    }
  }

  return useMemo(
    () =>
      modelList.mapOrElse({
        ok: (models) => (
          <div className={className}>
            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={disabled || models.length === 0}
              onOpenChange={onOpenChange}
            >
              <SelectTrigger className={triggerClassName}>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {models.length === 0 ? (
                  <SelectItem value="no-models" disabled>
                    No models available for {driver}
                  </SelectItem>
                ) : (
                  models.map((m) => (
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
              onClick={handleCopy}
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
        ),
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
      }),
    [modelList]
  )
}
