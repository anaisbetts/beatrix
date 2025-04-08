import { existsSync } from 'fs'
import path from 'path'

export const isProdMode = existsSync(path.join(repoRootDir(), 'public'))

export function repoRootDir() {
  // If we are running as a single-file executable all of the normal node methods
  // to get __dirname get Weird. However, if we're running in dev mode, we can use
  // our usual tricks
  const haystack = ['bun.exe', 'bun-profile.exe', 'bun', 'node']
  const needle = path.basename(process.execPath)

  if (haystack.includes(needle)) {
    return path.resolve(__dirname, '..')
  } else {
    return path.dirname(process.execPath)
  }
}

export function getDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR)
  } else {
    return repoRootDir()
  }
}
