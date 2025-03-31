'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCommand, usePromise } from '@anaisbetts/commands'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Beaker, Play } from 'lucide-react'
import { useWebSocket } from './ws-provider'
import { firstValueFrom, share, toArray } from 'rxjs'
import { ScenarioResult, GradeResult } from '../../shared/types'

type DriverType = 'anthropic' | 'ollama' | 'openai'

export default function Evals() {
  const [model, setModel] = useState('')
  const [driver, setDriver] = useState<DriverType>('anthropic')
  const [count, setCount] = useState(1)
  const [results, setResults] = useState<ScenarioResult[]>([])
  const { api } = useWebSocket()

  const driverList = usePromise(async () => {
    if (!api) return []
    return await firstValueFrom(api.getDriverList())
  }, [api])

  const modelList = usePromise(async () => {
    if (!api) return []
    const models = await firstValueFrom(api.getModelListForDriver(driver))
    if (models.length > 0 && !model) {
      setModel(models[0])
    }
    return models
  }, [api, driver])

  const [runEvals, evalCommand, reset] = useCommand(async () => {
    if (!api) throw new Error('Not connected!')

    setResults([])
    const before = performance.now()

    const evalCall = api.runAllEvals(model, driver, count).pipe(share())
    const evalResults: ScenarioResult[] = []

    evalCall.subscribe({
      next: (result) => {
        evalResults.push(result)
        setResults([...evalResults])
      },
      error: (err) => console.error('Error running evals:', err),
    })

    try {
      await firstValueFrom(evalCall.pipe(toArray()))
    } catch (e) {
      console.error('Error completing eval run:', e)
    }

    return {
      results: evalResults,
      duration: performance.now() - before,
    }
  }, [model, driver, count])

  const resetEvals = useCallback(() => {
    reset()
    setResults([])
  }, [reset])

  const totalScore = useMemo(() => {
    if (results.length === 0) return { score: 0, possible: 0, percent: 0 }

    const { score, possible } = results.reduce(
      (acc, result) => {
        acc.score += result.finalScore
        acc.possible += result.finalScorePossible
        return acc
      },
      { score: 0, possible: 0 }
    )

    return {
      score,
      possible,
      percent: possible > 0 ? Math.round((score / possible) * 100) : 0,
    }
  }, [results])

  const summaryInfo = evalCommand.mapOrElse({
    ok: (val) => (
      <div className="pt-2 italic">
        Eval run completed in {Math.round((val?.duration || 0) / 1000)}s
      </div>
    ),
    err: (e) => <div className="text-red-500 italic">Error: {e.message}</div>,
    pending: () => <div className="text-gray-400 italic">Running evals...</div>,
    null: () => null,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Model Evaluations</h2>
        <Button variant="outline" size="sm" onClick={resetEvals}>
          Reset
        </Button>
      </div>

      <div className="border-border flex flex-wrap gap-4 border-b p-4">
        <div className="flex flex-col">
          <label className="mb-1 text-sm">Driver</label>
          <Select
            value={driver}
            onValueChange={(value) => {
              setDriver(value as DriverType)
            }}
            disabled={evalCommand.isPending()}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Select driver" />
            </SelectTrigger>
            <SelectContent>
              {driverList.mapOrElse({
                ok: (drivers) => (
                  drivers.map(d => (
                    <SelectItem key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </SelectItem>
                  ))
                ),
                err: () => (
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                ),
                pending: () => (
                  <SelectItem value="anthropic">Loading...</SelectItem>
                ),
                null: () => (
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                ),
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-sm">Model</label>
          <Select
            value={model}
            onValueChange={setModel}
            disabled={evalCommand.isPending()}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {modelList.mapOrElse({
                ok: (models) => (
                  models.map(m => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))
                ),
                err: () => (
                  <SelectItem value="error-fallback">Failed to load models</SelectItem>
                ),
                pending: () => (
                  <SelectItem value="loading-fallback">Loading models...</SelectItem>
                ),
                null: () => (
                  <SelectItem value="no-driver-fallback">Select a driver first</SelectItem>
                ),
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-sm">Repetitions</label>
          <Input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 1)}
            className="w-24"
            disabled={evalCommand.isPending()}
          />
        </div>

        <div className="flex items-end">
          <Button
            onClick={(e) => {
              e.preventDefault()
              runEvals()
            }}
            disabled={evalCommand.isPending() || !model.trim() || !driver}
            className="flex gap-2"
          >
            <Play size={18} />
            Run Evals
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {evalCommand.isPending() && (
          <div className="flex flex-col items-center justify-center p-12">
            <div className="relative mb-4">
              <div className="border-primary-200 border-t-primary-600 h-12 w-12 animate-spin rounded-full border-4"></div>
              <Beaker className="text-primary-600 absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 transform" />
            </div>
            <p className="text-primary-700 text-lg font-medium">
              Running evaluations...
            </p>
            <p className="text-sm text-gray-500">
              This may take a few minutes.
            </p>
            {results.length > 0 && (
              <div className="bg-primary-50 mt-6 rounded-lg p-4 text-center">
                <p className="text-sm font-medium">Results so far:</p>
                <div className="text-xl font-bold">
                  {totalScore.score}/{totalScore.possible} ({totalScore.percent}
                  %)
                </div>
              </div>
            )}
          </div>
        )}

        {!evalCommand.isPending() && results.length > 0 && (
          <div className="bg-primary-50 mb-4 rounded-lg p-4 text-center">
            <h3 className="mb-2 text-lg font-semibold">Overall Score</h3>
            <div className="text-3xl font-bold">
              {totalScore.score}/{totalScore.possible} ({totalScore.percent}%)
            </div>
          </div>
        )}

        <div className="space-y-6">
          {results.map((result, i) => (
            <EvalResult key={`eval-${i}`} result={result} />
          ))}
        </div>

        {!evalCommand.isPending() && summaryInfo}
      </div>
    </div>
  )
}

function EvalResult({ result }: { result: ScenarioResult }) {
  const percentScore =
    result.finalScorePossible > 0
      ? Math.round((result.finalScore / result.finalScorePossible) * 100)
      : 0

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between bg-gray-100 p-3">
        <div className="font-medium">{result.prompt}</div>
        <div className="flex items-center gap-2">
          <div className="text-sm">Tools: {result.toolsDescription}</div>
          <div className="bg-primary-100 text-primary-800 rounded px-2 py-1 font-semibold">
            {result.finalScore}/{result.finalScorePossible} ({percentScore}%)
          </div>
        </div>
      </div>

      <div className="p-3">
        <h4 className="mb-2 font-medium">Response:</h4>
        <div className="mb-4 rounded border bg-gray-50 p-2 text-sm whitespace-pre-wrap">
          {(() => {
            const content = result.messages[result.messages.length - 1]?.content
            if (typeof content === 'string') {
              return content
            } else if (Array.isArray(content)) {
              return content
                .filter((block: any) => block.type === 'text')
                .map((block: any) => (block.type === 'text' ? block.text : ''))
                .join('\n')
            }
            return ''
          })()}
        </div>

        <h4 className="mb-2 font-medium">Graders:</h4>
        <div className="space-y-2">
          {result.gradeResults.map((grade, i) => (
            <GraderResult key={`grade-${i}`} gradeResult={grade} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GraderResult({ gradeResult }: { gradeResult: GradeResult }) {
  const percentScore =
    gradeResult.possibleScore > 0
      ? Math.round((gradeResult.score / gradeResult.possibleScore) * 100)
      : 0

  return (
    <div className="flex items-center justify-between rounded border p-2">
      <div className="text-sm">{gradeResult.graderInfo}</div>
      <div className="bg-primary-50 text-primary-700 rounded px-2 py-1 text-sm font-medium">
        {gradeResult.score}/{gradeResult.possibleScore} ({percentScore}%)
      </div>
    </div>
  )
}
