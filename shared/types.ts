import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

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
