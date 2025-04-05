import { Kysely, sql } from 'kysely'
import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .createTable('callServiceLogs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('createdAt', 'datetime', (c) =>
      c.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('service', 'varchar(255)', (col) => col.notNull())
    .addColumn('data', 'text', (col) => col.notNull())
    .addColumn('target', 'varchar(255)', (col) => col.notNull())
    .addColumn('automationLogId', 'integer', (col) =>
      col.notNull().references('automationLogs.id').onDelete('cascade')
    )
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  await db.schema.dropTable('callServiceLogs').execute()
}
