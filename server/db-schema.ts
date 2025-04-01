import { Generated, Insertable, Selectable, ColumnType } from 'kysely'

export type Timestamp = ColumnType<Date, Date | string, Date | string>

export interface Schema {
  signals: SignalTable
  automationLogs: AutomationLogTable
}

export interface SignalTable {
  id: Generated<number>
  createdAt: Generated<Timestamp>
  automationHash: string
  type: string
  data: string
}

export type SignalType = 'cron' | 'state' | 'event'

export type AutomationType = 'manual' | 'determine-signal' | 'execute-signal'

export interface AutomationLogTable {
  id: Generated<number>
  type: AutomationType
  createdAt: Generated<Timestamp>
  messageLog: string

  automationHash?: string // if type = 'determine-signal', the automation that we read through
  signalId?: number // if type = 'execute-signal', the signal ID that triggered
}

export type Signal = Selectable<SignalTable>
export type NewSignal = Insertable<SignalTable>
export type AutomationLog = Selectable<AutomationLogTable>
export type NewAutomationLog = Insertable<AutomationLogTable>
