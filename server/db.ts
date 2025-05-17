import * as path from 'node:path'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import debug from 'debug'
import { Kysely, Migrator, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import { DateTime } from 'luxon'

import {
  AbsoluteTimeSignal,
  Automation,
  AutomationLogEntry,
  CallServiceLogEntry,
  CronSignal,
  RelativeTimeSignal,
  StateRegexSignal,
} from '../shared/types'
import { Schema } from './db-schema'
import { migrator } from './migrations/this-sucks'
import { getDataDir } from './paths'

const d = debug('b:db')

export async function createDatabaseViaEnv() {
  const dbPath = path.join(getDataDir(), 'app.db')
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
  const db = new Kysely<Schema>({
    dialect: new BunSqliteDialect(dbPath ? { url: dbPath } : {}),
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
  beforeTimestamp?: DateTime,
  limit = 100
): Promise<AutomationLogEntry[]> {
  let q = db
    .selectFrom('automationLogs as a')
    .leftJoin('signals as s', 's.id', 'a.signalId')
    .orderBy('a.createdAt', 'desc')
    .limit(limit)

  if (beforeTimestamp) {
    q = q.where('a.createdAt', '<', `datetime(${beforeTimestamp.toISO()!})`)
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

  // Fetch the images for each automation log
  const images = await db
    .selectFrom('images')
    .where('automationLogId', 'in', automationLogIds)
    .selectAll()
    .execute()

  // Group service logs by automation log ID using a Map
  const serviceLogsByAutomationId = serviceLogs.reduce((acc, x) => {
    if (!acc.has(x.automationLogId)) {
      acc.set(x.automationLogId, [])
    }

    acc.get(x.automationLogId)?.push({
      createdAt: x.createdAt,
      service: x.service,
      target: x.target,
      data: x.data, // Keep as string as per type definition
    })
    return acc
  }, new Map<number, CallServiceLogEntry[]>())

  // Group images by automation log ID using a Map
  const imagesByAutomationId = images.reduce((acc, img) => {
    if (img.automationLogId && !acc.has(img.automationLogId)) {
      acc.set(img.automationLogId, [])
    }

    if (img.automationLogId) {
      // Convert Buffer to base64 string
      const base64Image = Buffer.from(img.bytes).toString('base64')
      acc.get(img.automationLogId)?.push(base64Image)
    }
    return acc
  }, new Map<number, string[]>())

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

    // Get images for this log
    const imageData = imagesByAutomationId.get(row.id) || []

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
            } as CronSignal
            break
          case 'state':
            signaledBy = {
              type: 'state',
              entityIds: signalData.entityIds,
              regex: signalData.regex,
            } as StateRegexSignal
            break
          case 'offset':
            signaledBy = {
              type: 'offset',
              offsetInSeconds: signalData.offsetInSeconds,
            } as RelativeTimeSignal
            break
          case 'time':
            signaledBy = {
              type: 'time',
              iso8601Time: signalData.iso8601Time,
            } as AbsoluteTimeSignal
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
      createdAt: row.createdAt,
      messages: messageLog,
      servicesCalled,
      automation: matchingAutomation || null,
      signaledBy,
      images: imageData, // Include the images
    }
  })
}
