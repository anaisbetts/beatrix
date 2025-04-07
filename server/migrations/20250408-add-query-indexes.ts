import { Kysely } from 'kysely'

import { Schema } from '../db-schema'

export async function up(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .createIndex('idx_signals_automation_hash')
    .on('signals')
    .column('automationHash')
    .execute()

  await db.schema
    .createIndex('idx_automation_logs_created_at')
    .on('automationLogs')
    .column('createdAt')
    .execute()

  await db.schema
    .createIndex('idx_automation_logs_signal_id')
    .on('automationLogs')
    .column('signalId')
    .execute()

  await db.schema
    .createIndex('idx_call_service_logs_automation_log_id')
    .on('callServiceLogs')
    .column('automationLogId')
    .execute()
}

export async function down(db: Kysely<Schema>): Promise<void> {
  await db.schema.dropIndex('idx_signals_automation_hash').execute()
  await db.schema.dropIndex('idx_automation_logs_created_at').execute()
  await db.schema.dropIndex('idx_automation_logs_signal_id').execute()
  await db.schema.dropIndex('idx_call_service_logs_automation_log_id').execute()
}
