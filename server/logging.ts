import { Kysely } from 'kysely'
import path from 'node:path'
// import { performance } from 'node:perf_hooks' // Use Date.now() instead
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

  const subj = new Subject<{ msg: string; type: string }>()
  subj.subscribe({
    next: () => console.log('NEXT'),
  })

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
