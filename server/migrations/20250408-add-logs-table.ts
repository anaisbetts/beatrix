import { Kysely } from 'kysely'

import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .createTable('logs')
    .addColumn('createdAt', 'integer')
    .addColumn('level', 'integer')
    .addColumn('message', 'text')
    .execute()

  await db.schema
    .createIndex('idx_logs_created_at')
    .on('logs')
    .column('createdAt')
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  await db.schema.dropIndex('idx_logs_created_at').execute()
  await db.schema.dropTable('logs').execute()
}
