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
}

export interface AutomationLogTable {
  id: Generated<number>
  createdAt: Generated<Timestamp>
  messageLog: string
}

export type Signal = Selectable<SignalTable>
export type NewSignal = Insertable<SignalTable>
export type AutomationLog = Selectable<AutomationLogTable>
export type NewAutomationLog = Insertable<AutomationLogTable>
