import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { firstValueFrom, from, toArray } from 'rxjs'
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml'

import { Automation } from '../../shared/types'
import { parseModelWithDriverString } from '../../shared/utility'
import { ModelSpecifier } from '../llm'
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
    let automations = parts.map((text) => text.trim()).filter(Boolean)

    // Log number of automations found within a file at info level
    i(`Found ${automations.length} automations in file: ${file}`)

    // If no separators found or all parts are empty, treat the entire file as one automation
    if (automations.length === 0) {
      const trimmedContent = content.trim()
      if (trimmedContent) {
        yield automationFromString(trimmedContent, filePath)
      }
    } else {
      const frontmatter = extractFrontmatter(automations[0])
      if (frontmatter) {
        automations = automations.slice(1)
      }

      // Create automation objects for each separated content
      for (const automationContent of automations) {
        // Skip empty automations
        if (!automationContent.trim()) continue
        yield automationFromString(
          automationContent,
          filePath,
          false,
          frontmatter
        )
      }
    }
  }
}

export function automationFromString(
  trimmedContent: string,
  filePath: string,
  allowRelative = false,
  frontmatter?: Record<string, any>
) {
  if (!path.isAbsolute(filePath) && !allowRelative) {
    throw new Error(
      `Invariant violation: automationFromString received a non-absolute path: ${filePath}`
    )
  }

  const hash = crypto.createHash('sha256').update(trimmedContent).digest('hex')

  return {
    hash,
    contents: trimmedContent,
    fileName: filePath,
    metadata: frontmatter,
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
 * If automations have metadata, it's serialized as frontmatter at the beginning of the file.
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

    // Check if we have frontmatter to add
    let fileContent = ''

    // Use the metadata from the first automation as frontmatter
    // This assumes all automations in a file share the same metadata
    const metadata = fileAutomations[0]?.metadata
    if (metadata && Object.keys(metadata).length > 0) {
      // Serialize metadata to YAML using the yaml library
      const yamlMetadata = stringifyYAML(metadata)

      // Add frontmatter with separators, ensuring proper newlines
      fileContent = `---\n${yamlMetadata}\n---\n\n`
    }

    // Combine automation contents with separator
    fileContent += fileAutomations
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

function extractFrontmatter(content: string): Record<string, any> | undefined {
  try {
    const parsedYAML = parseYAML(content)

    // Check if the parsed result is a plain object (Record<string, any>)
    if (
      parsedYAML &&
      typeof parsedYAML === 'object' &&
      !Array.isArray(parsedYAML)
    ) {
      return parsedYAML as Record<string, any>
    }

    return undefined
  } catch {
    return undefined
  }
}

export function modelSpecFromAutomation(
  automation: Automation
): ModelSpecifier {
  const model = automation.metadata?.model
  if (!model) {
    return { type: 'automation' }
  }

  try {
    parseModelWithDriverString(model)
  } catch (e) {
    i(
      `Invalid model specifier for automation ${automation.fileName}: ${model}`,
      e
    )

    return { type: 'automation' }
  }

  return {
    modelWithDriver: automation.metadata?.model,
  }
}
