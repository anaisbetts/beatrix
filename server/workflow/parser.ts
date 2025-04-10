import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { firstValueFrom, from, toArray } from 'rxjs'

import { Automation } from '../../shared/types'
import { i } from '../logging'

export async function* parseAutomations(
  directoryPath: string
): AsyncGenerator<Automation> {
  // Get all markdown files in the directory
  const files = await fs.readdir(directoryPath)
  const mdFiles = files.filter((file) => file.endsWith('.md'))

  // Log number of markdown files found at info level
  i(`Found ${mdFiles.length} automation definition files in ${directoryPath}`)

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

    // Log number of automations found within a file at info level
    i(`Found ${automations.length} automations in file: ${file}`)

    // If no separators found or all parts are empty, treat the entire file as one automation
    if (automations.length === 0) {
      const trimmedContent = content.trim()
      if (trimmedContent) {
        yield automationFromString(trimmedContent, filePath)
      }
    } else {
      // Create automation objects for each separated content
      for (const automationContent of automations) {
        // Skip empty automations
        if (!automationContent.trim()) continue
        yield automationFromString(automationContent, filePath)
      }
    }
  }
}

export function automationFromString(trimmedContent: string, filePath: string) {
  const hash = crypto.createHash('sha256').update(trimmedContent).digest('hex')

  return {
    hash,
    contents: trimmedContent,
    fileName: filePath,
  }
}

export async function parseAllAutomations(
  directoryPath: string
): Promise<Automation[]> {
  return firstValueFrom(from(parseAutomations(directoryPath)).pipe(toArray()))
}
