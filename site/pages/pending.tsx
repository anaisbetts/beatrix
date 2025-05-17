import { useCommand } from '@anaisbetts/commands'
import { Calendar, ChevronDown, ChevronUp, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { firstValueFrom } from 'rxjs'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { SignalHandlerInfo } from '../../shared/types'
import { useWebSocket } from '../components/ws-provider'

export default function PendingAutomations() {
  const { api } = useWebSocket()

  // Define a command to fetch scheduled signals
  const [fetchSignalsCmd, fetchSignalsResult] = useCommand(async () => {
    if (!api) return []
    const result = await firstValueFrom(api.getScheduledSignals())
    return result
  }, [api])

  // Fetch signals on component mount if API is available
  useEffect(() => {
    if (api) {
      void fetchSignalsCmd()
    }
  }, [api, fetchSignalsCmd])

  const signalsContent = fetchSignalsResult.mapOrElse({
    pending: () => (
      <div className="flex justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    ),
    ok: (result) =>
      result?.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">
          No pending automations found
        </div>
      ) : (
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {result?.map((signal, index) => (
            <SignalCard key={index} signal={signal} />
          ))}
        </div>
      ),
    err: (error) => (
      <div className="p-8 text-center text-destructive">
        Error loading automations: {error.message}
      </div>
    ),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-border border-b p-4">
        <h2 className="font-semibold text-lg">Pending Automations</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void fetchSignalsCmd()}
          >
            <RotateCw size={18} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">{signalsContent}</div>
    </div>
  )
}

interface SignalCardProps {
  signal: SignalHandlerInfo
}

function SignalCard({ signal }: SignalCardProps) {
  const [expanded, setExpanded] = useState(false)
  const automationText = signal.automation.contents
  const truncatedText =
    automationText.length > 30
      ? `${automationText.substring(0, 30)}...`
      : automationText

  return (
    <Card
      className={`transition-all ${signal.isValid ? 'border-primary/40' : 'border-destructive/40'}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="truncate text-base">
            {signal.automation.fileName}
          </CardTitle>
          <Badge
            variant={signal.isValid ? 'outline' : 'destructive'}
            className="ml-2 shrink-0"
          >
            {signal.isValid ? 'Valid' : 'Invalid'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="mb-1 font-medium text-sm">Next Run:</div>
        <div className="flex items-center">
          <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{signal.friendlySignalDescription}</span>
        </div>
      </CardContent>

      <CardFooter className="flex w-full flex-col items-start pt-0">
        <div className="flex w-full items-center">
          <Button
            variant="ghost"
            size="sm"
            className="mr-1 h-6 w-6 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
          <div className="flex-1 truncate text-muted-foreground text-xs">
            {truncatedText}
          </div>
        </div>

        {expanded && (
          <div className="mt-2 max-h-40 w-full overflow-y-auto rounded bg-gray-50 p-2 pr-2 pl-7 text-muted-foreground text-xs">
            <pre className="whitespace-pre-wrap break-words font-mono">
              {automationText}
            </pre>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
