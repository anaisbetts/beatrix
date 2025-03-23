import { promises as fs } from 'fs'
import { createDatabase } from './db'
import { afterEach, describe, expect, it } from 'bun:test'

describe('database', () => {
  const testDbPath = './app.db'

  afterEach(async () => {
    try {
      await fs.unlink(testDbPath)
      await fs.unlink(testDbPath.replace('.db', '.db-shm'))
      await fs.unlink(testDbPath.replace('.db', '.db-wal'))
    } catch {
      // Ignore errors if file doesn't exist
    }
  })

  it('should create a database with migrations', async () => {
    // Override the database path for testing
    process.env.DATA_DIR = '.'

    const db = await createDatabase()

    // Verify database was created
    const fileExists = await fs
      .stat(testDbPath)
      .then(() => true)
      .catch(() => false)

    expect(fileExists).toBe(true)

    // Clean up
    await db.destroy()
  })
})
