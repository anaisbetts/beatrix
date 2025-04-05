import * as path from 'node:path'
import { Kysely, Migrator, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'
import { Schema, Timestamp, CallServiceLog } from './db-schema'
import { migrator } from './migrations/this-sucks'
import { Automation } from '../shared/types'
import { repoRootDir } from './utils'

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
  beforeTimestamp?: Timestamp,
  limit = 30
) {
  let q = db
    .selectFrom('automationLogs as a')
    .leftJoin('signals as s', 's.id', 'a.signalId')
    .limit(limit)

  if (beforeTimestamp) {
    q = q.where('a.createdAt', '<', beforeTimestamp)
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

    acc.get(x.automationLogId)?.push(x)
    return acc
  }, new Map<number, CallServiceLog[]>())

  return rows
}
