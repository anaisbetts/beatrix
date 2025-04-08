import { cyan, gray, green, red, yellow } from 'colorette'
import { constants as fsConstants } from 'node:fs'
import { access, rename, stat } from 'node:fs/promises'
import stripAnsi from 'strip-ansi'

/**
 * use a local copy of UNSTABLE { type Writer, writeAll } from "jsr:@std/io@0.225.0/write-all";
 */
export interface Writer {
  /** Writes `p.byteLength` bytes from `p` to the underlying data stream. It
   * resolves to the number of bytes written from `p` (`0` <= `n` <=
   * `p.byteLength`) or reject with the error encountered that caused the
   * write to stop early. `write()` must reject with a non-null error if
   * would resolve to `n` < `p.byteLength`. `write()` must not modify the
   * slice data, even temporarily.
   *
   * Implementations should not retain a reference to `p`.
   */
  write(p: Uint8Array): Promise<number>
}

export async function writeAll(writer: Writer, data: Uint8Array) {
  let nwritten = 0
  while (nwritten < data.length) {
    nwritten += await writer.write(data.subarray(nwritten))
  }
}

export { stat, rename }

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

// Export the imported functions/variables so other modules can use them
export { cyan, gray, green, red, yellow, stripAnsi }
