import * as path from 'path'

import { Kysely,  sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'
import { Schema } from './db-schema'
import { migrations } from './migrations/this-sucks'

const d = debug('ha:db')

export async function createDatabase(dbPath?: string) {
  const dbFile =
    dbPath ??
    (process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, 'app.db')
      : './app.db')

  const db = new Kysely<Schema>({
    dialect: new BunSqliteDialect({ url: dbFile }),
    log(ev) {
      d('db: %o', ev)
    },
  })

  await sql`PRAGMA journal_mode = WAL`.execute(db)
  await sql`PRAGMA synchronous = NORMAL`.execute(db)
  await sql`PRAGMA foreign_keys = ON`.execute(db)
  await sql`PRAGMA temp_store = MEMORY`.execute(db)

  for (const migration of migrations) {
    await migration.up(db)
  }

  return db
}
