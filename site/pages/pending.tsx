import { useCommand } from '@anaisbetts/commands'
import { Calendar, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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

import { Automation, SignalHandlerInfo } from '../../shared/types'
import { useWebSocket } from '../components/ws-provider'

export default function PendingAutomations() {
  const [signals, setSignals] = useState<SignalHandlerInfo[]>([])
  const { api } = useWebSocket()

  // Define a command to fetch scheduled signals
  const [fetchSignalsCmd, fetchSignalsResult, resetFetchSignals] =
    useCommand(async () => {
      if (!api) return []
      const result = await firstValueFrom(api.getScheduledSignals())
      setSignals(result)
      return result
    }, [api])

  // Fetch signals on component mount if API is available
  useEffect(() => {
    if (api) {
      fetchSignalsCmd()
    }
  }, [api, fetchSignalsCmd])

  const refreshSignals = () => {
    fetchSignalsCmd()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Pending Automations</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={refreshSignals}>
            <RotateCw size={18} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {fetchSignalsResult.isPending() ? (
          <div className="flex justify-center p-8">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
          </div>
        ) : signals.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center">
            No pending automations found
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr">
            {signals.map((signal, index) => (
              <SignalCard key={index} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SignalCardProps {
  signal: SignalHandlerInfo
}

function SignalCard({ signal }: SignalCardProps) {
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
      <CardFooter className="pt-0">
        <div className="text-xs text-muted-foreground font-mono w-full truncate">
          #{signal.automation.hash}
        </div>
      </CardFooter>
    </Card>
  )
}
