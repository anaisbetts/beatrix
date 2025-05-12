import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

export type SignalType =
  | 'cron'
  | 'state'
  | 'event'
  | 'offset'
  | 'time'
  | 'range'

export type LLMFactoryType = 'automation' | 'vision'

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
  metadata?: Record<string, any>
}

export type StateRegexSignal = {
  type: 'state'
  entityIds: string[]
  regex: string
  delay?: number
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

export type StateRangeSignal = {
  type: 'range'
  entityId: string
  min: number
  max: number
  durationSeconds: number
}

export type SignalData =
  | CronSignal
  | StateRegexSignal
  | RelativeTimeSignal
  | AbsoluteTimeSignal
  | StateRangeSignal

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
  createdAt: string
  service: string
  data: string
  target: string
}

export interface AutomationLogEntry {
  createdAt: string
  automation: Automation | null
  type: AutomationType
  messages: MessageParam[]
  images: string[] // base64 bytes

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

  /**
   * IANA/Olsen timezone identifier (e.g., "America/New_York", "Europe/London")
   * See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones for valid values
   */
  timezone?: string

  automationModel?: string
  visionModel?: string

  anthropicApiKey?: string
  ollamaHost?: string

  openAIProviders?: OpenAIProviderConfig[] // Array for multiple OpenAI configs
}

export interface OpenAIProviderConfig {
  providerName?: string // Name for this provider configuration, the default is 'openai'
  baseURL?: string
  apiKey?: string
}

/**
 * Represents the data captured for a bug report.
 */
export interface BugReportData {
  /** The timezone setting when the report was captured. */
  timezone?: string

  /** List of cues active at the time of the report. */
  cues: Automation[]

  /** List of automations active at the time of the report. */
  automations: Automation[]

  /** The root directory of the notebook. */
  notebookRoot?: string

  /** The Home Assistant services data. */
  services: any // Consider defining a more specific type if the structure is known

  /** The Home Assistant states data. */
  states: any // Consider defining a more specific type if the structure is known
}
