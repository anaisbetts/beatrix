import { Logger } from '@denodnt/logger'

const logger = new Logger()

export async function startLogger() {
  await logger.initFileLogger('./logs', {
    rotate: true,
    maxBackupCount: 10,
  })

  logger.enable('info')
  logger.enable('warn')
  logger.enable('error')

  logger.enableConsole()
  logger.enableFile()
}

export function i(...args: unknown[]) {
  void logger.warn(...args)
}

export function w(...args: unknown[]) {
  void logger.warn(...args)
}

export function e(...args: unknown[]) {
  void logger.error(...args)
}
