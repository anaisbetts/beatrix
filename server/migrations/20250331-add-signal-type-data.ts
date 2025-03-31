import { Kysely } from 'kysely'
import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .alterTable('signals')
    .addColumn('type', 'varchar(64)', (c) => c.notNull().defaultTo('cron'))
    .addColumn('data', 'text', (c) => c.notNull().defaultTo(''))
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .alterTable('signals')
    .dropColumn('data')
    .dropColumn('type')
    .execute()
}