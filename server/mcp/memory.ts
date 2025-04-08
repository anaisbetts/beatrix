import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import * as fs from 'fs/promises'
import * as path from 'path'
import { z } from 'zod'

import pkg from '../../package.json'
import type { Automation } from '../../shared/types'
import { i, w } from '../logging'
import { automationFromString } from '../workflow/parser'

const d = debug('b:memory')

export function createMemoryServer(filePath: string, megaServer?: McpServer) {
  const server =
    megaServer ??
    new McpServer({
      name: 'memory',
      version: pkg.version,
      description:
        'This server allows an LLM to save and search observations stored in a single file.',
    })

  server.tool(
    'save-observation',
    'Save a new observation string to the memory file.',
    { observation: z.string().describe('The observation text to save.') },
    async ({ observation }) => {
      if (!observation?.trim()) {
        return {
          content: [{ type: 'text', text: 'Observation cannot be empty.' }],
          isError: true,
        }
      }
      try {
        i(`Saving observation: "${observation}"`)

        const observations = await readObservations(filePath)
        const newObservation = automationFromString(observation, filePath)
        observations.push(newObservation)
        await writeObservations(filePath, observations)

        d('Observation saved successfully.')

        return {
          content: [{ type: 'text', text: 'Observation saved.' }],
        }
      } catch (err: any) {
        w('save-observation Error:', err)
        return {
          content: [
            {
              type: 'text',
              text: `Failed to save observation: ${err.toString()}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'search-observations',
    'Search saved observations for a specific query string.',
    { query: z.string().describe('The string to search for.') },
    async ({ query }) => {
      try {
        i(`Searching observations for: "${query}"`)
        const observations = await readObservations(filePath)
        const lowerCaseQuery = query.toLowerCase()

        const matchingObservations = observations.filter((obs) =>
          obs.contents.toLowerCase().includes(lowerCaseQuery)
        )

        d(
          `Found ${matchingObservations.length} matching observations for query "${query}"`
        )

        const matchingContents = matchingObservations.map((obs) => obs.contents)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(matchingContents),
            },
          ],
        }
      } catch (err: any) {
        w('search-observations Error:', err)
        return {
          content: [
            {
              type: 'text',
              text: `Failed to search observations: ${err.toString()}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  return server
}

async function readObservations(filePath: string): Promise<Automation[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const regex = /^[\s]*---[\s]*$/m
    const parts = content.split(regex)

    const automationsContent = parts.map((text) => text.trim()).filter(Boolean)

    if (automationsContent.length === 0) {
      const trimmedContent = content.trim()
      return trimmedContent
        ? [automationFromString(trimmedContent, filePath)]
        : []
    } else {
      return automationsContent.map((text) =>
        automationFromString(text, filePath)
      )
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const fileDir = path.dirname(filePath)
      try {
        await fs.mkdir(fileDir, { recursive: true })
        d(`Ensured directory exists: ${fileDir}`)
      } catch (mkdirError: any) {
        w(`Error creating directory ${fileDir}:`, mkdirError)
      }
      return []
    }
    w('Error reading observations file:', error)
    throw error
  }
}

async function writeObservations(
  filePath: string,
  observations: Automation[]
): Promise<void> {
  const fileDir = path.dirname(filePath)
  try {
    await fs.mkdir(fileDir, { recursive: true })
  } catch (mkdirError: any) {
    w(`Error ensuring directory ${fileDir} before writing:`, mkdirError)
    throw mkdirError
  }

  const content = observations
    .map((obs) => obs.contents)
    .filter(Boolean)
    .join('\n\n---\n\n')
  await fs.writeFile(filePath, content, 'utf-8')
  d(`Wrote ${observations.length} observations to ${filePath}`)
}
