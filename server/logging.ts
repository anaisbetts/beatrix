import { Logger } from '@denodnt/logger'

let logger: Logger | null = new Logger()
logger.enableConsole()

logger.enable('info')
logger.enable('warn')
logger.enable('error')

export async function startLogger() {
  await logger?.initFileLogger('./logs', {
    rotate: true,
    maxBackupCount: 10,
    maxBytes: 32 * 1048576,
  })

  logger?.enableFile()
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
