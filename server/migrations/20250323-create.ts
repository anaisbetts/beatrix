import { Kysely, sql } from 'kysely'
import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .createTable('signals')
    .addColumn('id', 'integer', (c) => c.primaryKey())
    .addColumn('createdAt', 'datetime', (c) =>
      c.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('automationHash', 'varchar(64)')
    .execute()

  await db.schema
    .createTable('automationLogs')
    .addColumn('id', 'integer', (c) => c.primaryKey())
    .addColumn('createdAt', 'datetime', (c) =>
      c.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('messageLog', 'text')
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  await db.schema.dropTable('automationLogs').execute()
  await db.schema.dropTable('signals').execute()
}
