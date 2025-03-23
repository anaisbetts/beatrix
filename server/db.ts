import * as path from 'path'
import { promises as fs } from 'fs'

import {
  Generated,
  Insertable,
  Selectable,
  Kysely,
  Migrator,
  FileMigrationProvider,
  ColumnType,
  sql,
} from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'
import debug from 'debug'

const d = debug('ha:db')

export type Timestamp = ColumnType<Date, Date | string, Date | string>

export interface Schema {
  signals: SignalTable
}

export interface SignalTable {
  id: Generated<number>
  createdAt: Generated<Timestamp>
  automationHash: string
}

export type Signal = Selectable<SignalTable>
export type NewSignal = Insertable<SignalTable>

export async function createDatabase() {
  const dbPath = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'app.db') : './app.db'
  
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

export async function test() {
  const db = await createDatabase()
  await db
    .insertInto('signals')
    .values({ automationHash: 'foo' })
    .executeTakeFirst()
}
