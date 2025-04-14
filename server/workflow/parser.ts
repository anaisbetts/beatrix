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

/**
 * Serializes automations back to their original files.
 * Groups automations by filename and combines them with '---' separators.
 */
export async function serializeAutomations(
  automations: Automation[]
): Promise<void> {
  // Group automations by filename
  const automationsByFile = automations.reduce<Record<string, Automation[]>>(
    (acc, automation) => {
      const fileName = automation.fileName
      if (!acc[fileName]) {
        acc[fileName] = []
      }
      acc[fileName].push(automation)
      return acc
    },
    {}
  )

  // Write each group to its corresponding file
  for (const [fileName, fileAutomations] of Object.entries(automationsByFile)) {
    // Sort automations if needed (optional, depends on your requirements)

    // Combine automation contents with separator
    const fileContent = fileAutomations
      .map((automation) => automation.contents)
      .join('\n\n---\n\n')

    // Write back to the file
    await fs.writeFile(fileName, fileContent, 'utf-8')

    // Log at info level
    i(
      `Wrote ${fileAutomations.length} automations to file: ${path.basename(fileName)}`
    )
  }
}

/**
 * Parses all automations from a directory and then serializes them back to their files.
 * This can be useful for reformatting or normalizing automation files.
 */
export async function parseAndSerializeAutomations(
  directoryPath: string
): Promise<void> {
  const automations = await parseAllAutomations(directoryPath)
  await serializeAutomations(automations)
  i(
    `Processed ${automations.length} automations across ${new Set(automations.map((a) => a.fileName)).size} files`
  )
}
