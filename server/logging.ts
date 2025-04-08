import { Kysely } from 'kysely'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Subject, bufferTime, concatMap, from } from 'rxjs'

import { Schema } from './db-schema'
import Logger from './logger/logger'
import { getDataDir, isProdMode, repoRootDir } from './utils'

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

  const subj = new Subject<{ message: string; level: string }>()

  subj
    .pipe(
      bufferTime(750),
      concatMap((msgs) => {
        const toInsert = msgs.map((msg) => {
          const lvl =
            msg.level === 'error' ? 30 : msg.level === 'warn' ? 20 : 10

          return {
            message: msg.message,
            level: lvl,
            createdAt: performance.now(),
          }
        })

        return from(db.insertInto('logs').values(toInsert).execute())
      })
    )
    .subscribe()
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
