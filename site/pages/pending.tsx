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
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
      </div>
    ),
    ok: (result) =>
      result?.length === 0 ? (
        <div className="text-muted-foreground p-8 text-center">
          No pending automations found
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr">
          {result?.map((signal, index) => (
            <SignalCard key={index} signal={signal} />
          ))}
        </div>
      ),
    err: (error) => (
      <div className="text-destructive p-8 text-center">
        Error loading automations: {error.message}
      </div>
    ),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Pending Automations</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={(e) => fetchSignalsCmd()}
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
        <div className="flex justify-between items-center">
          <CardTitle className="text-base truncate">
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
        <div className="text-sm font-medium mb-1">Next Run:</div>
        <div className="flex items-center">
          <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
          <span className="text-sm">{signal.friendlySignalDescription}</span>
        </div>
      </CardContent>

      <CardFooter className="pt-0 flex flex-col items-start w-full">
        <div className="flex items-center w-full">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 mr-1"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
          <div className="text-xs text-muted-foreground flex-1 truncate">
            {truncatedText}
          </div>
        </div>

        {expanded && (
          <div className="text-xs text-muted-foreground mt-2 pl-7 pr-2 w-full max-h-40 overflow-y-auto bg-gray-50 rounded p-2">
            <pre className="whitespace-pre-wrap break-words font-mono">
              {automationText}
            </pre>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
