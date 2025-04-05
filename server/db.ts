import * as path from 'node:path'
import { Kysely, Migrator, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'
import { Schema, Timestamp } from './db-schema'
import { migrator } from './migrations/this-sucks'
import { Automation } from '../shared/types'

const d = debug('ha:db')

export async function createDatabaseViaEnv() {
  const dbPath = path.join(
    process.env.DATA_DIR ?? path.resolve(path.dirname(process.execPath)),
    'app.db'
  )

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
