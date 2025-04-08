import { asyncMap } from '@anaisbetts/commands'
import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'fs'

import { createDatabase } from './db'
import { NewAutomationLog, NewSignal } from './db-schema'

async function tryUnlink(file: string) {
  try {
    await fs.unlink(file)
  } catch {
    // dontcare
  }
}

describe('database', () => {
  it('should create a database with migrations', async () => {
    const testDbPath = 'test.db'

    try {
      // First ensure we start fresh
      await asyncMap(
        [
          testDbPath,
          testDbPath.replace('.db', '.db-wal'),
          testDbPath.replace('.db', '.db-shm'),
        ],
        tryUnlink
      )

      const db = await createDatabase(testDbPath)

      // Verify database was created
      const fileExists = await fs.stat(testDbPath)
      expect(fileExists).toBeDefined()

      // 1. Insert a test signal to verify the signals table has both columns from migrations
      const testSignal: NewSignal = {
        automationHash: 'test-hash-123',
        type: 'state', // From second migration
        data: '{"state": "on"}', // From second migration
        isDead: false,
      }

      const insertedSignalResult = await db
        .insertInto('signals')
        .values(testSignal)
        .executeTakeFirstOrThrow()

      // 2. Retrieve the signal to verify the schema
      const insertedId = Number((insertedSignalResult as any).insertId)
      expect(insertedId).toBeGreaterThan(0)

      const retrievedSignal = await db
        .selectFrom('signals')
        .selectAll()
        .where('id', '=', insertedId)
        .executeTakeFirst()

      expect(retrievedSignal).toBeDefined()
      expect(retrievedSignal?.automationHash).toBe(testSignal.automationHash)
      expect(retrievedSignal?.type).toBe(testSignal.type) // Verify column from second migration
      expect(retrievedSignal?.data).toBe(testSignal.data) // Verify column from second migration

      // 3. Insert an automationLog referencing the signal to test foreign key relationships
      const testLog: NewAutomationLog = {
        type: 'execute-signal',
        messageLog: 'Test automation executed',
        automationHash: 'test-hash-123',
        signalId: insertedId,
      }

      const insertedLogResult = await db
        .insertInto('automationLogs')
        .values(testLog)
        .execute()

      expect(insertedLogResult).toBeDefined()

      // 4. Verify automationLogs table has expected schema
      const logs = await db
        .selectFrom('automationLogs')
        .selectAll()
        .where('signalId', '=', insertedId)
        .execute()

      expect(logs.length).toBe(1)
      expect(logs[0].type).toBe(testLog.type)
      expect(logs[0].messageLog).toBe(testLog.messageLog)
      expect(logs[0].automationHash).toBe(testLog.automationHash!)
      expect(logs[0].signalId).toBe(testLog.signalId!)

      // Clean up
      await db.destroy()
    } finally {
      // Cleanup files
      await asyncMap(
        [
          testDbPath,
          testDbPath.replace('.db', '.db-wal'),
          testDbPath.replace('.db', '.db-shm'),
        ],
        tryUnlink
      )
    }
  })
})
