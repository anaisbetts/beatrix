import { spawnPromise } from 'spawn-rx'
import path from 'path'
import { asyncMap } from '../server/lib/promise-extras'

const archNames = {
  'win32-x64': 'bun-windows-x64-modern',
  //'win32-arm64': 'bun-windows-arm64-modern',
  'linux-x64': 'bun-linux-x64-modern',
  'linux-arm64': 'bun-linux-arm64-modern',
}

function repoRootDir() {
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

export async function main(_args: string[]) {
  await asyncMap(Object.entries(archNames), async ([arch, bunTarget]) => {
    const outDir = path.join(repoRootDir(), 'dist')
    const suffix = arch.includes('win32') ? '.exe' : ''
    const outFile = path.join(outDir, `beatrix-server-${arch}${suffix}`)

    console.log(`Building ${arch} server...`)
    await spawnPromise('bun', ['build',  '--compile', `--target=${bunTarget}`, '--outfile', outFile, path.join(repoRootDir(), 'server', 'index.ts')])
  })

  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (x) => process.exit(x),
    (ex) => {
      console.error(ex)
      process.exit(1)
    }
  )
}
