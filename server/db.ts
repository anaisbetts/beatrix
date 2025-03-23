import * as path from 'path'
import { promises as fs } from 'fs'

import {
  Generated,
  Insertable,
  Selectable,
  Kysely,
  Migrator,
  FileMigrationProvider,
} from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-worker/normal'

export interface Schema {
  signals: SignalTable
}

export interface SignalTable {
  id: Generated<number>
  automationHash: string
}

export type Signal = Selectable<SignalTable>
export type NewSignal = Insertable<SignalTable>

export async function createDatabase() {
  const db = new Kysely<Schema>({
    dialect: new BunSqliteDialect({ url: './test.db' }),
  })
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
