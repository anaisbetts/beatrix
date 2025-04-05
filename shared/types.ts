import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

export type ModelDriverType = 'anthropic' | 'ollama' | 'openai'

export type SignalType = 'cron' | 'state' | 'event'

export type AutomationType = 'manual' | 'determine-signal' | 'execute-signal'

export interface Automation {
  hash: string
  contents: string
  fileName: string
}

export type ScenarioResult = {
  prompt: string
  toolsDescription: string
  messages: MessageParam[]
  gradeResults: GradeResult[]
  finalScore: number
  finalScorePossible: number
}

export type GradeResult = {
  score: number
  possibleScore: number
  graderInfo: string
}
