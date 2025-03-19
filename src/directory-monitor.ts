import { Observable, Subject } from 'rxjs';
import { watch } from 'fs';
import { join } from 'path';
import debug from 'debug';

const d = debug('ha:directory-monitor');

/**
 * Options for the directory monitor
 */
export interface DirectoryMonitorOptions {
  /** Directory path to monitor */
  path: string;
  
  /** Whether to watch subdirectories recursively */
  recursive?: boolean;
  
  /** File patterns to include (glob patterns) */
  include?: string[];
  
  /** File patterns to exclude (glob patterns) */
  exclude?: string[];
  
  /** Whether to emit the full path (true) or just the relative path (false) */
  fullPath?: boolean;
}

/**
 * Creates an Observable that emits file paths when files change in the specified directory.
 * 
 * @param options Configuration options for the directory monitor
 * @returns An Observable that emits file paths when changes are detected
 */
export function createDirectoryMonitor(options: DirectoryMonitorOptions): Observable<string> {
  return new Observable<string>(subscriber => {
    const { path, recursive = false, fullPath = true } = options;
    
    d('Starting directory monitor for %s (recursive: %s)', path, recursive);
    
    // Create watcher
    const watcher = watch(path, { recursive }, (eventType, filename) => {
      if (!filename) return;
      
      const filePath = fullPath ? join(path, filename) : filename;
      d('File change detected: %s (%s)', filePath, eventType);
      
      // Check if the file matches include/exclude patterns
      if (shouldIncludeFile(filePath, options)) {
        subscriber.next(filePath);
      }
    });
    
    // Cleanup function for unsubscribe
    return () => {
      d('Stopping directory monitor for %s', path);
      watcher.close();
    };
  });
}

/**
 * Determine if a file should be included based on include/exclude patterns
 */
function shouldIncludeFile(filePath: string, options: DirectoryMonitorOptions): boolean {
  const { include, exclude } = options;
  
  // If include patterns are specified, file must match at least one
  if (include && include.length > 0) {
    const matchesInclude = include.some(pattern => 
      matchGlobPattern(filePath, pattern)
    );
    
    if (!matchesInclude) return false;
  }
  
  // If exclude patterns are specified, file must not match any
  if (exclude && exclude.length > 0) {
    const matchesExclude = exclude.some(pattern => 
      matchGlobPattern(filePath, pattern)
    );
    
    if (matchesExclude) return false;
  }
  
  return true;
}

/**
 * Simple glob pattern matching
 * Supports basic wildcard patterns like *.js, **/*.ts, etc.
 */
function matchGlobPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^\\/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
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
  const fileChanges = new Subject<string>();
  const monitor = createDirectoryMonitor(options);
  
  return new Observable<string[]>(subscriber => {
    // Track files changed during debounce period
    const changedFiles = new Set<string>();
    let debounceTimer: NodeJS.Timeout | null = null;
    
    // Subscribe to raw file changes
    const subscription = monitor.subscribe(filePath => {
      changedFiles.add(filePath);
      
      // Reset the debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      
      // Set new debounce timer
      debounceTimer = setTimeout(() => {
        if (changedFiles.size > 0) {
          d('Emitting batch of %d changed files', changedFiles.size);
          subscriber.next(Array.from(changedFiles));
          changedFiles.clear();
        }
      }, debounceTimeMs);
    });
    
    // Return cleanup function
    return () => {
      subscription.unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  });
}