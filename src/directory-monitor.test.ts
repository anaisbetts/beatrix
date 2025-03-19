import { createDirectoryMonitor, createBufferedDirectoryMonitor } from './directory-monitor';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { firstValueFrom } from 'rxjs';
import { take, toArray, timeout } from 'rxjs/operators';
import { delay } from './promise-extras';

describe('DirectoryMonitor', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await mkdtemp(join(tmpdir(), 'dir-monitor-test-'));
  });
  
  afterEach(async () => {
    // Clean up the temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to clean up temp directory ${tempDir}:`, err);
    }
  });

  it('should emit file path when a file changes', async () => {
    // Create a monitor for the temp directory
    const monitor = createDirectoryMonitor({ path: tempDir });
    
    // Set up a promise that will resolve with the first emitted path
    const resultPromise = firstValueFrom(
      monitor.pipe(take(1), timeout(5000))
    );
    
    // Create a file after a short delay to trigger the watcher
    const testFile = join(tempDir, 'test-file.txt');
    await delay(100); // Wait for watcher to initialize
    await writeFile(testFile, 'hello world');
    
    // Wait for the emission and verify it matches our file
    const result = await resultPromise;
    expect(result).toBe(testFile);
  });

  it('should filter files based on include patterns', async () => {
    // Create a monitor with include pattern
    const monitor = createDirectoryMonitor({
      path: tempDir,
      include: ['*.txt']
    });
    
    // Collect emissions
    const resultsPromise = firstValueFrom(
      monitor.pipe(take(1), timeout(5000))
    );
    
    // Create files - only the .txt one should match
    await delay(100);
    const txtFile = join(tempDir, 'test-file.txt');
    const jsFile = join(tempDir, 'test-file.js');
    
    await writeFile(jsFile, 'console.log("test");');
    await delay(50); // Add a small delay between file creations
    await writeFile(txtFile, 'hello world');
    
    // Verify we only got the .txt file
    const result = await resultsPromise;
    expect(result).toBe(txtFile);
  });

  it('should filter files based on exclude patterns', async () => {
    // Create a monitor with exclude pattern
    const monitor = createDirectoryMonitor({
      path: tempDir,
      exclude: ['*.log', '*.tmp']
    });
    
    // Collect emissions
    const resultsPromise = firstValueFrom(
      monitor.pipe(take(1), timeout(5000))
    );
    
    // Create files - the .log file should be excluded
    await delay(100);
    const txtFile = join(tempDir, 'test-file.txt');
    const logFile = join(tempDir, 'test-file.log');
    
    await writeFile(logFile, 'some log data');
    await delay(50); // Add a small delay between file creations
    await writeFile(txtFile, 'hello world');
    
    // Verify we only got the .txt file
    const result = await resultsPromise;
    expect(result).toBe(txtFile);
  });

  it('should batch file changes with buffered monitor', async () => {
    // Create a buffered monitor with a short debounce time
    const monitor = createBufferedDirectoryMonitor(
      { path: tempDir },
      100 // Short debounce time for testing
    );
    
    // Collect emissions
    const resultsPromise = firstValueFrom(
      monitor.pipe(take(1), timeout(5000))
    );
    
    // Create multiple files in quick succession
    await delay(100);
    const file1 = join(tempDir, 'file1.txt');
    const file2 = join(tempDir, 'file2.txt');
    const file3 = join(tempDir, 'file3.txt');
    
    await writeFile(file1, 'file 1');
    await writeFile(file2, 'file 2');
    await writeFile(file3, 'file 3');
    
    // Verify we got all files in a single batch
    const results = await resultsPromise;
    expect(results).toHaveLength(3);
    expect(results).toContain(file1);
    expect(results).toContain(file2);
    expect(results).toContain(file3);
  });

  it('should handle recursive directory watching', async () => {
    // Create a monitor with recursive option
    const monitor = createDirectoryMonitor({
      path: tempDir,
      recursive: true
    });
    
    // Collect emissions
    const resultsPromise = firstValueFrom(
      monitor.pipe(take(1), timeout(5000))
    );
    
    // Create a subdirectory and file
    await delay(100);
    const subDir = join(tempDir, 'subdir');
    await mkdir(subDir);
    
    await delay(50); // Wait for the directory creation to be processed
    const subFile = join(subDir, 'subfile.txt');
    await writeFile(subFile, 'sub directory file');
    
    // Verify we got the file in the subdirectory
    const result = await resultsPromise;
    expect(result).toBe(subFile);
  });
});