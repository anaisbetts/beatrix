import { Kysely } from 'kysely'

import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  // Create images table
  await db.schema
    .createTable('images')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('automationLogId', 'integer')
    .addColumn('createdAt', 'varchar(30)')
    .addColumn('bytes', 'blob')
    .execute()

  // Add index on automationLogId
  await db.schema
    .createIndex('idx_images_automation_log_id')
    .on('images')
    .column('automationLogId')
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  // Drop the index on automationLogId
  await db.schema.dropIndex('idx_images_automation_log_id').execute()

  // Drop the images table
  await db.schema.dropTable('images').execute()
}
