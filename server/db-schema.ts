import { Generated, Insertable, Selectable } from 'kysely'

import { AutomationType } from '../shared/types'

export type Timestamp = string // This is ALWAYS an iso8601 date with timezone

export interface Schema {
  signals: SignalTable
  automationLogs: AutomationLogTable
  callServiceLogs: CallServiceLogTable
  logs: LogTable
}

export interface LogTable {
  createdAt: Timestamp
  level: number
  message: string
}

export interface SignalTable {
  id: Generated<number>
  createdAt: Timestamp
  automationHash: string
  type: string
  data: string
  executionNotes: string
  isDead: boolean
}

export interface CallServiceLogTable {
  id: Generated<number>
  createdAt: Timestamp
  service: string
  data: string
  target: string
  automationLogId: number
}

export interface AutomationLogTable {
  id: Generated<number>
  type: AutomationType
  createdAt: Timestamp
  messageLog: string

  automationHash?: string // if type = 'determine-signal', the automation that we read through
  signalId?: number // if type = 'execute-signal', the signal ID that triggered
}

export type Signal = Selectable<SignalTable>
export type NewSignal = Insertable<SignalTable>
export type AutomationLog = Selectable<AutomationLogTable>
export type NewAutomationLog = Insertable<AutomationLogTable>
export type CallServiceLog = Selectable<CallServiceLogTable>
export type NewCallServiceLog = Insertable<CallServiceLogTable>
