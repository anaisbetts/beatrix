import { DateTime } from 'luxon'
import { mkdirSync } from 'node:fs'
import { Observer } from 'rxjs'

import Dater from './date.ts'
import { cyan, exists, green, red, stripAnsi, yellow } from './deps.ts'
import eol from './eol.ts'
import type { LoggerWriteOptions, fileLoggerOptions } from './interface.ts'
import stdout from './stdout.ts'
import Types from './types.ts'
import Writer from './writer.ts'

const { inspect } = require('node:util')

const noop = async () => {}

export type LoggerType = 'debug' | 'info' | 'log' | 'warn' | 'error'

/**
 * Logger class
 */
export default class Logger {
  private stdout = stdout
  private encoder = new TextEncoder()
  private writer?: Writer
  private rotate = false
  private dir?: string
  private filename?: string
  private sink: Observer<{
    msg: string
    type: string
    timestamp: DateTime
  }> | null = null

  #debug = this.debug
  #info = this.info
  #log = this.log
  #warn = this.warn
  #error = this.error
  #write = this.write

  private format(...args: unknown[]): Uint8Array {
    const msg = args
      .map((arg) =>
        typeof arg === 'string'
          ? arg
          : inspect(arg, { colors: true, depth: null })
      )
      .join(' ')
    return this.encoder.encode(stripAnsi(msg) + eol)
  }

  /**
   * Log message with debug level
   * @param args data to log
   */
  async debug(...originalArgs: unknown[]): Promise<void> {
    const argsForStdout = [this.getDebug(), this.getNow(), ...originalArgs]
    this.stdout(...argsForStdout)
    if (this.dir) {
      const fileMsg = this.formatForFile(
        this.getDebug(),
        this.getNow(),
        ...originalArgs
      )
      await this.#write({
        dir: this.dir,
        type: Types.DEBUG,
        msg: fileMsg.bytes,
        str: fileMsg.str,
      })
    }
  }
  /**
   * Log message with info level
   * @param args data to log
   */
  async info(...originalArgs: unknown[]): Promise<void> {
    const argsForStdout = [this.getInfo(), this.getNow(), ...originalArgs]
    this.stdout(...argsForStdout)
    if (this.dir) {
      const fileMsg = this.formatForFile(
        this.getInfo(),
        this.getNow(),
        ...originalArgs
      )
      await this.#write({
        dir: this.dir,
        type: Types.INFO,
        msg: fileMsg.bytes,
        str: fileMsg.str,
      })
    }
  }

  /**
   * Log message with info level
   * @param args data to log
   */
  async log(...originalArgs: unknown[]): Promise<void> {
    const argsForStdout = [this.getLog(), this.getNow(), ...originalArgs]
    this.stdout(...argsForStdout)
    if (this.dir) {
      const fileMsg = this.formatForFile(
        this.getLog(),
        this.getNow(),
        ...originalArgs
      )
      await this.#write({
        dir: this.dir,
        type: Types.LOG,
        msg: fileMsg.bytes,
        str: fileMsg.str,
      })
    }
  }

  /**
   * Log message with warning level
   * @param args data to log
   */
  async warn(...originalArgs: unknown[]): Promise<void> {
    const argsForStdout = [this.getWarn(), this.getNow(), ...originalArgs]
    this.stdout(...argsForStdout)
    if (this.dir) {
      const fileMsg = this.formatForFile(
        this.getWarn(),
        this.getNow(),
        ...originalArgs
      )
      await this.#write({
        dir: this.dir,
        type: Types.WARN,
        msg: fileMsg.bytes,
        str: fileMsg.str,
      })
    }
  }

  /**
   * Log message with error level
   * @param args data to log
   */
  async error(...originalArgs: unknown[]): Promise<void> {
    const argsForStdout = [this.getError(), this.getNow(), ...originalArgs]
    this.stdout(...argsForStdout)
    if (this.dir) {
      const fileMsg = this.formatForFile(
        this.getError(),
        this.getNow(),
        ...originalArgs
      )
      await this.#write({
        dir: this.dir,
        type: Types.ERROR,
        msg: fileMsg.bytes,
        str: fileMsg.str,
      })
    }
  }

  private write({
    dir,
    type,
    msg,
    str,
  }: LoggerWriteOptions & { msg: Uint8Array; str: string }): Promise<void> {
    const date = this.getDate()
    const filename = this.filename || (this.rotate === true ? `${date}` : 'app')

    const path = `${dir}/${filename}.log`
    this.sink?.next({ msg: str, type, timestamp: DateTime.now() })
    return this.writer!.write({ path, msg, type })
  }

  private formatForFile(...args: unknown[]) {
    const msg = args
      .map((arg) =>
        typeof arg === 'string' ? arg : inspect(arg, { colors: false })
      )
      .join(' ')

    const s = stripAnsi(msg) + eol
    return { bytes: this.encoder.encode(s), str: s }
  }

  initSubjLogger(
    sink: Observer<{ msg: string; type: string; timestamp: DateTime }>
  ) {
    this.sink = sink
  }

  /**
   * init file logger
   * @param dir
   * @param options
   */
  async initFileLogger(
    dir: string,
    options: fileLoggerOptions = {}
  ): Promise<void> {
    const exist = await exists(dir)

    if (!exist) {
      console.warn(`${this.getWarn()} Log folder does not exist`)
      try {
        mkdirSync(dir, { recursive: true })
        console.info(`${this.getInfo()} Log folder create success`)
      } catch (error) {
        console.error(`${this.getError()} Log folder create failed: `, error)
      }
    }
    const { rotate, maxBytes, maxBackupCount } = options
    if (rotate === true) this.rotate = true
    this.dir = dir
    this.filename = options?.filename
    this.writer = new Writer({
      maxBytes,
      maxBackupCount,
    })
  }

  /**
   * disable a specific type of logger
   * @param type Level of logger to disable
   */
  disable(type?: LoggerType): void {
    if (!type) {
      this.debug = noop
      this.info = noop
      this.log = noop
      this.warn = noop
      this.error = noop
      return
    }
    if (type === 'debug') {
      this.debug = noop
      return
    }
    if (type === 'info') {
      this.info = noop
      return
    }
    if (type === 'log') {
      this.log = noop
      return
    }
    if (type === 'warn') {
      this.warn = noop
      return
    }
    if (type === 'error') {
      this.error = noop
      return
    }
  }

  /**
   * Enable a specific type of logger
   * @param type Level of logger to enable
   */
  enable(type?: LoggerType): void {
    if (!type) {
      this.debug = this.#debug
      this.info = this.#info
      this.log = this.#log
      this.warn = this.#warn
      this.error = this.#error
    }
    if (type === 'debug') {
      this.debug = this.#debug
      return
    }
    if (type === 'info') {
      this.info = this.#info
      return
    }
    if (type === 'log') {
      this.log = this.#log
      return
    }
    if (type === 'warn') {
      this.warn = this.#warn
      return
    }
    if (type === 'error') {
      this.error = this.#error
      return
    }
  }

  /**
   * Disable console logger
   */
  disableConsole(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.stdout = noop
  }

  /**
   * Enable console logger
   */
  enableConsole(): void {
    this.stdout = stdout
  }

  /**
   * Disable file logger
   */
  disableFile(): void {
    this.write = noop
  }

  /**
   * Enable file logger
   */
  enableFile(): void {
    this.write = this.#write
  }

  private getDebug(): string {
    return cyan(` Debug:`)
  }

  private getInfo(): string {
    return green(` Info:`)
  }

  private getLog(): string {
    return green(` Log:`)
  }

  private getWarn(): string {
    return yellow(` Warn:`)
  }

  private getError(): string {
    return red(` Error:`)
  }

  private getNow(): string {
    return new Dater().toLocaleString()
  }

  private getDate(): string {
    return new Dater().toLocaleDateString()
  }
}
