import * as path from 'node:path'
import { Kysely, Migrator, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'
import { Schema } from './db-schema'
import { migrator } from './migrations/this-sucks'
import {
  Automation,
  AutomationLogEntry,
  CallServiceLogEntry,
  CronTrigger,
  StateRegexTrigger,
} from '../shared/types'
import { repoRootDir } from './utils'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'

const d = debug('ha:db')

export async function createDatabaseViaEnv() {
  const dbPath = path.join(process.env.DATA_DIR ?? repoRootDir(), 'app.db')
  return await _createDatabase(dbPath)
}

export async function createDatabase(dbPath: string) {
  const db = await _createDatabase(dbPath)
  return db
}

export async function createInMemoryDatabase() {
  const db = await _createDatabase()
  return db
}

async function _createDatabase(dbPath?: string) {
  const dbFile =
    dbPath ??
    (process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, 'app.db')
      : './app.db')

  const db = new Kysely<Schema>({
    dialect: new BunSqliteDialect(dbPath ? { url: dbFile } : {}),
    log(ev) {
      d('db: %o', ev)
    },
  })

  await sql`PRAGMA journal_mode = WAL`.execute(db)
  await sql`PRAGMA synchronous = NORMAL`.execute(db)
  await sql`PRAGMA foreign_keys = ON`.execute(db)
  await sql`PRAGMA temp_store = MEMORY`.execute(db)

  const doit = new Migrator({
    db,
    provider: migrator,
  })

  await doit.migrateToLatest()
  return db
}

export async function fetchAutomationLogs(
  db: Kysely<Schema>,
  automations: Automation[],
  beforeTimestamp?: Date,
  limit = 30
): Promise<AutomationLogEntry[]> {
  let q = db
    .selectFrom('automationLogs as a')
    .leftJoin('signals as s', 's.id', 'a.signalId')
    .limit(limit)

  if (beforeTimestamp) {
    q = q.where(
      'a.createdAt',
      '<',
      `datetime(${dateToSqliteTimestamp(beforeTimestamp)})`
    )
  }

  const rows = await q
    .select(['s.data as signalData', 's.type as signalType'])
    .selectAll('a')
    .execute()

  if (rows.length < 1) {
    return []
  }

  // Fetch the call service logs for each automation log
  const automationLogIds = rows.map((r) => r.id)
  const serviceLogs = await db
    .selectFrom('callServiceLogs')
    .where('automationLogId', 'in', automationLogIds)
    .selectAll()
    .execute()

  // Group service logs by automation log ID using a Map
  const serviceLogsByAutomationId = serviceLogs.reduce((acc, x) => {
    if (!acc.has(x.automationLogId)) {
      acc.set(x.automationLogId, [])
    }

    acc.get(x.automationLogId)?.push({
      createdAt: parseSqliteTimestamp(x.createdAt),
      service: x.service,
      target: x.target,
      data: x.data, // Keep as string as per type definition
    })
    return acc
  }, new Map<number, CallServiceLogEntry[]>())

  // Process each automation log row and convert to AutomationLogEntry
  return rows.map((row) => {
    // Parse JSON string fields
    const messageLog = JSON.parse(row.messageLog) as MessageParam[]

    // Find matching automation from the provided automations array
    const matchingAutomation = row.automationHash
      ? automations.find((a) => a.hash === row.automationHash)
      : null

    // Parse service logs
    const callServiceLogs = serviceLogsByAutomationId.get(row.id) || []
    const servicesCalled = callServiceLogs.map((serviceLog) => {
      return {
        createdAt: serviceLog.createdAt,
        service: serviceLog.service,
        target: serviceLog.target,
        data: serviceLog.data, // Keep as string as per type definition
      }
    })

    // Parse signal data if it exists
    let signaledBy = null
    if (row.signalType && row.signalData) {
      try {
        const signalData = JSON.parse(row.signalData)

        switch (row.signalType) {
          case 'cron':
            signaledBy = {
              type: 'cron',
              cron: signalData.cron,
            } as CronTrigger
            break
          case 'state':
            signaledBy = {
              type: 'state',
              entityIds: signalData.entityIds,
              regex: signalData.regex,
            } as StateRegexTrigger
            break
          case 'event':
            // Handle event case if needed in the future
            break
        }
      } catch (e) {
        console.warn(`Failed to parse signalData for log ${row.id}: ${e}`)
      }
    }

    // Create and return the AutomationLogEntry
    return {
      type: row.type,
      createdAt: parseSqliteTimestamp(row.createdAt),
      messages: messageLog,
      servicesCalled,
      automation: matchingAutomation || null,
      signaledBy,
    }
  })
}

export function parseSqliteTimestamp(timestampStr: string): Date {
  const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  if (!regex.test(timestampStr)) {
    throw new Error(
      `Invalid timestamp format: ${timestampStr}. Expected format: YYYY-MM-DD HH:MM:SS`
    )
  }

  // Split the timestamp string into date and time parts
  const [datePart, timePart] = timestampStr.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes, seconds] = timePart.split(':').map(Number)

  // Create a new Date object (months are 0-indexed in JavaScript Date)
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
}

export function dateToSqliteTimestamp(date: Date): string {
  // Ensure we have a valid Date object
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Invalid Date object provided to formatTimestamp')
  }

  // Format the date components with padding
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0') // Months are 0-indexed
  const day = String(date.getUTCDate()).padStart(2, '0')

  // Format the time components with padding
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')

  // Combine into the final format
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
