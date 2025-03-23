import * as path from 'path'
import { promises as fs } from 'fs'

import { Kysely, Migrator, FileMigrationProvider, sql } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'
import { Schema } from './db-schema'

const d = debug('ha:db')

export async function createDatabase() {
  const dbPath = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'app.db')
    : './app.db'

  const db = new Kysely<Schema>({
    dialect: new BunSqliteDialect({ url: dbPath }),
    log(ev) {
      d('database: %o', ev)
    },
  })

  await sql`PRAGMA journal_mode = WAL`.execute(db)
  await sql`PRAGMA synchronous = NORMAL`.execute(db)
  await sql`PRAGMA foreign_keys = ON`.execute(db)
  await sql`PRAGMA temp_store = MEMORY`.execute(db)

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  })

  await migrator.migrateToLatest()
  return db
}
