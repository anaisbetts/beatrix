import path from 'node:path'

import Logger from './logger/logger'
import { getDataDir, isProdMode, repoRootDir } from './utils'

let logger: Logger | null = new Logger()
logger.enableConsole()

logger.enable('info')
logger.enable('warn')
logger.enable('error')

export async function startLogger() {
  if (isProdMode) {
    await logger?.initFileLogger(path.join(getDataDir(), 'logs'), {
      rotate: true,
      maxBytes: 32 * 1048576,
      maxBackupCount: 10,
    })
  } else {
    await logger?.initFileLogger(repoRootDir())
  }
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
