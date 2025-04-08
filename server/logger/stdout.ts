import { Writer, writeAll } from './deps.ts'

const isTTY = process.stdout.isTTY

/**
 * Node.js stdout log function
 * @param msg
 */
export async function stdout(msg: Uint8Array): Promise<void> {
  await writeAll(process.stdout as unknown as Writer, msg)
}

/**
 * default log function
 * @param args
 */
export default function log(...args: unknown[]): void {
  console.log(...args)
}
/**
 * No operation function
 */
function noop(): void {}

/**
 * Only output to stdout when the terminal is a TTY
 */
export const stdoutOnlyTty = isTTY ? stdout : noop
/**
 * Only output to console when the terminal is a TTY
 */
export const logOnlyTty = isTTY ? log : noop
