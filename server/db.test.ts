import { promises as fs } from 'fs'
import { createDatabase } from './db'
import { describe, expect, it } from 'bun:test'
import { asyncMap } from '@anaisbetts/commands'

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
      const db = await createDatabase(testDbPath)

      // Verify database was created
      const fileExists = await fs.stat(testDbPath)
      expect(fileExists).toBeDefined()

      // Clean up
      await db.destroy()
    } finally {
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
