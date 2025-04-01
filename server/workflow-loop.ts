import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import debug from 'debug'
import { firstValueFrom, from, toArray } from 'rxjs'

const d = debug('beatrix:workflow-loop')

export interface Automation {
  hash: string
  contents: string
  fileName: string
}

export async function* parseAutomations(
  directoryPath: string
): AsyncGenerator<Automation> {
  // Get all markdown files in the directory
  const files = await fs.readdir(directoryPath)
  const mdFiles = files.filter((file) => file.endsWith('.md'))

  d('Found %d markdown files in %s', mdFiles.length, directoryPath)

  // Process each file
  for (const file of mdFiles) {
    const filePath = path.join(directoryPath, file)
    const content = await fs.readFile(filePath, 'utf-8')

    // Split by the separator '---' on its own line
    // This regex matches '---' on its own line, with optional whitespace
    const regex = /^[\s]*---[\s]*$/m
    const parts = content.split(regex)

    // Filter out empty parts and trim each part
    const automations = parts.map((text) => text.trim()).filter(Boolean)

    d('Found %d automations in file %s', automations.length, file)

    // If no separators found or all parts are empty, treat the entire file as one automation
    if (automations.length === 0) {
      const trimmedContent = content.trim()
      if (trimmedContent) {
        const hash = crypto
          .createHash('sha256')
          .update(trimmedContent)
          .digest('hex')

        yield {
          hash,
          contents: trimmedContent,
          fileName: file,
        }
      }
    } else {
      // Create automation objects for each separated content
      for (const automationContent of automations) {
        // Skip empty automations
        if (!automationContent.trim()) continue

        // Create hash of the content for identification
        const hash = crypto
          .createHash('sha256')
          .update(automationContent)
          .digest('hex')

        yield {
          hash,
          contents: automationContent,
          fileName: file,
        }
      }
    }
  }
}

export async function parseAllAutomations(
  directoryPath: string
): Promise<Automation[]> {
  return firstValueFrom(from(parseAutomations(directoryPath)).pipe(toArray()))
}
