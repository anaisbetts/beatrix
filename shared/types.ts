import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

export type SignalType = 'cron' | 'state' | 'event' | 'offset' | 'time'

export type AutomationType =
  | 'manual'
  | 'chat'
  | 'determine-signal'
  | 'execute-signal'

export type TypeHint = 'chat' | 'debug'

export interface Automation {
  hash: string
  contents: string
  fileName: string
  isCue?: boolean
}

export type StateRegexSignal = {
  type: 'state'
  entityIds: string[]
  regex: string
}

export type CronSignal = {
  type: 'cron'
  cron: string
}

export type RelativeTimeSignal = {
  type: 'offset'
  offsetInSeconds: number
}

export type AbsoluteTimeSignal = {
  type: 'time'
  iso8601Time: string // ISO 8601 date and time format
}

export type SignalData =
  | CronSignal
  | StateRegexSignal
  | RelativeTimeSignal
  | AbsoluteTimeSignal

export interface SignalEntry {
  createdAt: Date
  type: SignalType
  data: string
}

export interface SignalHandlerInfo {
  readonly automation: Automation
  readonly friendlySignalDescription: string
  readonly isValid: boolean
}

export interface CallServiceLogEntry {
  createdAt: Date
  service: string
  data: string
  target: string
}

export interface AutomationLogEntry {
  createdAt: Date
  automation: Automation | null
  type: AutomationType
  messages: MessageParam[]

  servicesCalled: CallServiceLogEntry[]

  signaledBy: SignalData | null
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
} // Interface for a single OpenAI provider configuration

// Main application configuration interface
export interface AppConfig {
  haBaseUrl?: string
  haToken?: string

  llm?: string // either 'anthropic', 'ollama', or a provider name in openAIProviders

  anthropicApiKey?: string
  anthropicModel?: string

  ollamaHost?: string
  ollamaModel?: string

  openAIProviders?: OpenAIProviderConfig[] // Array for multiple OpenAI configs
}

export interface OpenAIProviderConfig {
  providerName?: string // Name for this provider configuration, the default is 'openai'
  baseURL?: string
  apiKey?: string
  model?: string
}
