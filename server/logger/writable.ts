import { FileHandle, open } from 'node:fs/promises'

import { stat } from './deps.ts'

/**
 * Writable class
 */
export default class Writable {
  protected file!: FileHandle
  private path: string
  currentSize = 0

  /**
   * Writable constructor
   * @param path
   */
  constructor(path: string) {
    this.path = path
  }

  /**
   * Setup writable file
   */
  async setup(): Promise<void> {
    this.file = await open(this.path, 'a+')

    try {
      const stats = await stat(this.path)
      this.currentSize = stats.size
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.currentSize = 0
      } else {
        throw error
      }
    }
  }

  /**
   * Write message to file
   * @param msg
   */
  async write(msg: Uint8Array): Promise<void> {
    const { bytesWritten } = await this.file.write(msg, 0, msg.length)
    this.currentSize += bytesWritten
  }

  /**
   * Close file
   */
  async close(): Promise<void> {
    await this.file.close()
  }
}
