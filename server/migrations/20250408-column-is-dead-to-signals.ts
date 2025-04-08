import { Kysely } from 'kysely'

import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .alterTable('signals')
    .addColumn('isDead', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  // Note: Dropping columns in SQLite is complex and often avoided.
  // Standard practice might involve creating a new table, copying data,
  // dropping the old table, and renaming the new one.
  // However, for simplicity in this context, we'll use the dropColumn syntax,
  // acknowledging it might not work directly in older SQLite versions or
  // without specific PRAGMA settings.
  await db.schema.alterTable('signals').dropColumn('isDead').execute()
}
