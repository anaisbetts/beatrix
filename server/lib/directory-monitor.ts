import debug from 'debug'
import { watch } from 'fs'
import { join } from 'path'
import {
  Observable,
  bufferTime,
  concatMap,
  map,
  repeat,
  shareReplay,
  take,
} from 'rxjs'

const d = debug('b:directory-monitor')

/**
 * Options for the directory monitor
 */
export interface DirectoryMonitorOptions {
  /** Directory path to monitor */
  path: string

  /** Whether to watch subdirectories recursively */
  recursive?: boolean

  /** File patterns to include (glob patterns) */
  include?: string[]

  /** File patterns to exclude (glob patterns) */
  exclude?: string[]

  /** Whether to emit the full path (true) or just the relative path (false) */
  fullPath?: boolean
}

/**
 * Creates an Observable that emits file paths when files change in the specified directory.
 *
 * @param options Configuration options for the directory monitor
 * @returns An Observable that emits file paths when changes are detected
 */
export function createDirectoryMonitor(
  options: DirectoryMonitorOptions
): Observable<string> {
  return new Observable<string>((subscriber) => {
    const { path, recursive = false, fullPath = true } = options

    d('Starting directory monitor for %s (recursive: %s)', path, recursive)

    // Create watcher
    const watcher = watch(path, { recursive }, (eventType, filename) => {
      if (!filename) return

      const filePath = fullPath ? join(path, filename) : filename
      d('File change detected: %s (%s)', filePath, eventType)

      // Check if the file matches include/exclude patterns
      if (shouldIncludeFile(filePath, options)) {
        subscriber.next(filePath)
      }
    })

    // Cleanup function for unsubscribe
    return () => {
      d('Stopping directory monitor for %s', path)
      watcher.close()
    }
  }).pipe(shareReplay(1))
}

/**
 * Determine if a file should be included based on include/exclude patterns
 */
function shouldIncludeFile(
  filePath: string,
  options: DirectoryMonitorOptions
): boolean {
  const { include, exclude } = options

  // Normalize the path for pattern matching (use just the filename for simpler patterns)
  const pathForMatching = options.fullPath
    ? filePath.split('/').pop() || ''
    : filePath
  d(
    'Checking file %s against patterns (using %s for matching)',
    filePath,
    pathForMatching
  )

  // If include patterns are specified, file must match at least one
  if (include && include.length > 0) {
    const matchesInclude = include.some((pattern) => {
      const match = matchGlobPattern(pathForMatching, pattern)
      d('  Include pattern %s: %s', pattern, match ? 'MATCH' : 'no match')
      return match
    })

    if (!matchesInclude) {
      d('  File excluded: no include patterns matched')
      return false
    }
  }

  // If exclude patterns are specified, file must not match any
  if (exclude && exclude.length > 0) {
    const matchesExclude = exclude.some((pattern) => {
      const match = matchGlobPattern(pathForMatching, pattern)
      d('  Exclude pattern %s: %s', pattern, match ? 'MATCH' : 'no match')
      return match
    })

    if (matchesExclude) {
      d('  File excluded: matched an exclude pattern')
      return false
    }
  }

  d('  File included: passed all pattern checks')
  return true
}

/**
 * Simple glob pattern matching
 * Supports basic wildcard patterns like "*.js" and recursive patterns
 */
function matchGlobPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^\\/]*')
    .replace(/__GLOBSTAR__/g, '.*')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filePath)
}

/**
 * Creates a buffered directory monitor that collects changes and emits them
 * in batches after a specified debounce time.
 *
 * @param options Configuration options for the directory monitor
 * @param debounceTimeMs Time in milliseconds to wait before emitting batched changes
 * @returns An Observable that emits arrays of file paths when changes are detected
 */
export function createBufferedDirectoryMonitor(
  options: DirectoryMonitorOptions,
  debounceTimeMs = 500
): Observable<string[]> {
  const monitor = createDirectoryMonitor(options)

  return monitor.pipe(
    concatMap((first) =>
      monitor.pipe(
        bufferTime(debounceTimeMs),
        take(1),
        map((files) => [first, ...files])
      )
    ),
    repeat()
  )
}
