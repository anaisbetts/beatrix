import { Kysely, sql } from 'kysely'
import path from 'node:path'
import { Subject, bufferTime, concatMap, from } from 'rxjs'

import { Schema } from './db-schema'
import Logger from './logger/logger'
import { getDataDir, isProdMode, repoRootDir } from './paths'

let logger: Logger | null = new Logger()
logger.enableConsole()

logger.enable('info')
logger.enable('warn')
logger.enable('error')

export async function startLogger(db: Kysely<Schema>) {
  if (isProdMode) {
    await logger?.initFileLogger(path.join(getDataDir(), 'logs'), {
      rotate: true,
      maxBytes: 32 * 1048576,
      maxBackupCount: 10,
    })
  } else {
    await logger?.initFileLogger(repoRootDir())
  }

  const subj = new Subject<{ msg: string; type: string }>()
  subj
    .pipe(
      bufferTime(750),
      concatMap((msgs) => {
        if (msgs.length < 1) {
          return from([])
        }

        const toInsert = msgs.map((msg) => {
          const lvl = msg.type === 'error' ? 30 : msg.type === 'warn' ? 20 : 10

          return {
            message: msg.msg,
            level: lvl,
            createdAt: Date.now(), // Use absolute timestamp
          }
        })

        return from(db.insertInto('logs').values(toInsert).execute())
      })
    )
    .subscribe({
      error: (err) => {
        console.error('Error inserting logs into database:', err)
      },
    })

  logger?.initSubjLogger(subj)
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000

  try {
    await cleanupOldLogs(db, TWO_WEEKS_MS)
  } catch (err) {
    console.error('Error cleaning up old logs:', err)
  }
}

/**
 * Deletes log entries older than the specified age
 */
async function cleanupOldLogs(
  db: Kysely<Schema>,
  maxAgeMs: number
): Promise<void> {
  const cutoffTimestamp = Date.now() - maxAgeMs
  await db.deleteFrom('logs').where('createdAt', '<', cutoffTimestamp).execute()

  await sql`VACUUM`.execute(db)
}

export function disableLogging() {
  logger = null
}

export function i(...args: unknown[]) {
  void logger?.info(...args)
}

export function w(...args: unknown[]) {
  void logger?.warn(...args)
}

export function e(...args: unknown[]) {
  void logger?.error(...args)
}
