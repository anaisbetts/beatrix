import { Kysely, sql } from 'kysely'
import { DateTime } from 'luxon'
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

export async function startLogger(db: Kysely<Schema>, timezone: string) {
  if (isProdMode) {
    await logger?.initFileLogger(path.join(getDataDir(), 'logs'), {
      rotate: true,
      maxBytes: 32 * 1048576,
      maxBackupCount: 10,
    })
  } else {
    await logger?.initFileLogger(repoRootDir())
  }

  const subj = new Subject<{ msg: string; type: string; timestamp: DateTime }>()
  const sub = subj
    .pipe(
      bufferTime(500),
      concatMap((msgs) => {
        if (msgs.length < 1) {
          return from([])
        }

        const toInsert = msgs.map((msg) => {
          const lvl = msg.type === 'error' ? 30 : msg.type === 'warn' ? 20 : 10

          return {
            createdAt: msg.timestamp.setZone(timezone).toISO()!,
            message: msg.msg,
            level: lvl,
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
    await cleanupOldLogs(db, timezone, TWO_WEEKS_MS)
  } catch (err) {
    console.error('Error cleaning up old logs:', err)
  }

  return sub
}

/**
 * Deletes log entries older than the specified age
 */
async function cleanupOldLogs(
  db: Kysely<Schema>,
  timezone: string,
  maxAgeMs: number
): Promise<void> {
  const now = DateTime.now().setZone(timezone)
  const cutoffTimestamp = now.minus({ milliseconds: maxAgeMs }).toISO()!
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
