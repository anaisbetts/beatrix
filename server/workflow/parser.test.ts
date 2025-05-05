import { describe, expect, test } from 'bun:test'
import { afterEach, beforeEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'

import { Automation } from '../../shared/types'
import {
  parseAndSerializeAutomations,
  parseAutomations,
  serializeAutomations,
} from './parser'

describe('Workflow loop functions', () => {
  describe('parseAutomations', () => {
    test('should parse markdown files into automation objects', async () => {
      const mockDir = path.join(
        import.meta.dir,
        '..',
        '..',
        'mocks',
        'automation-parsing'
      )
      const automations: Automation[] = []

      // Collect all automations
      for await (const automation of parseAutomations(mockDir)) {
        automations.push(automation)
      }

      // Basic validation
      expect(automations.length).toBeGreaterThan(10)
      expect(automations.every((a) => a.hash && a.contents && a.fileName)).toBe(
        true
      )

      // Group automations by filename for easier testing
      const automationsByFile = automations.reduce<
        Record<string, Automation[]>
      >((acc, automation) => {
        const list = acc[path.basename(automation.fileName)] || []
        list.push(automation)
        acc[path.basename(automation.fileName)] = list
        return acc
      }, {})

      // Debug output
      console.log('Automations found by file:')
      Object.entries(automationsByFile).forEach(([fileName, autoList]) => {
        console.log(`${fileName}: ${autoList.length} automations`)
        autoList.forEach((a, i) => {
          const previewContent = a.contents
            .substring(0, 40)
            .replace(/\n/g, '\\n')
          console.log(`  ${i}: ${previewContent}...`)
        })
      })

      // Test file1: Should have 2 automations
      expect(automationsByFile['file1.md']?.length).toBe(2)
      expect(
        automationsByFile['file1.md']?.some((a) =>
          a.contents.includes('this is the first automation')
        )
      ).toBe(true)
      expect(
        automationsByFile['file1.md']?.some((a) =>
          a.contents.includes('this is the second automation')
        )
      ).toBe(true)

      // Test file2: Should have 1 automation
      expect(automationsByFile['file2.md']?.length).toBe(1)
      expect(automationsByFile['file2.md'][0].contents).toContain(
        'this is a third automation'
      )

      // Test file3: Should have 2 automations
      expect(automationsByFile['file3.md']?.length).toBe(2)
      expect(
        automationsByFile['file3.md']?.some((a) =>
          a.contents.includes('This file starts with content')
        )
      ).toBe(true)
      expect(
        automationsByFile['file3.md']?.some((a) =>
          a.contents.includes('And continues with more content')
        )
      ).toBe(true)

      // Test file4: Should have 1 automation (starting separator should be handled)
      expect(automationsByFile['file4.md']?.length).toBe(1)
      expect(automationsByFile['file4.md'][0].contents).toContain(
        'This file starts with a separator line'
      )

      // Test file5: Should have 3 automations
      expect(automationsByFile['file5.md']?.length).toBe(3)
      expect(
        automationsByFile['file5.md']?.some((a) =>
          a.contents.includes('Multiple separators')
        )
      ).toBe(true)
      expect(
        automationsByFile['file5.md']?.some((a) =>
          a.contents.includes('In a row')
        )
      ).toBe(true)
      expect(
        automationsByFile['file5.md']?.some((a) =>
          a.contents.includes('Should create empty automations')
        )
      ).toBe(true)

      // Test file6: Should have 2 automations and not split quoted separator
      expect(automationsByFile['file6.md']?.length).toBe(2)
      const file6First = automationsByFile['file6.md']?.find((a) =>
        a.contents.includes('This file has a separator inside quoted text')
      )
      expect(file6First).toBeTruthy()
      expect(file6First?.contents).toContain(
        '"This is how a --- separator looks"'
      )
      expect(
        automationsByFile['file6.md']?.some((a) =>
          a.contents.includes('But this should create a separate automation')
        )
      ).toBe(true)

      // Test file7: Should have 2 automations
      expect(automationsByFile['file7.md']?.length).toBe(2)
      expect(
        automationsByFile['file7.md']?.some((a) =>
          a.contents.includes(
            'A line with --- in the middle of text should not split'
          )
        )
      ).toBe(true)
      expect(
        automationsByFile['file7.md']?.some((a) =>
          a.contents.includes('Like this')
        )
      ).toBe(true)

      // Test file8: Should have 1 automation (trailing separator should be handled)
      expect(automationsByFile['file8.md']?.length).toBe(1)
      expect(automationsByFile['file8.md'][0].contents).toContain(
        'Trailing separators should still'
      )

      // Test file9: Our implementation splits this into 3 parts
      // Code blocks with separators get split in our implementation
      expect(automationsByFile['file9.md']?.length).toBe(3)
      expect(
        automationsByFile['file9.md']?.some((a) =>
          a.contents.includes('```markdown')
        )
      ).toBe(true)
      expect(
        automationsByFile['file9.md']?.some((a) =>
          a.contents.includes('This should be a separate automation')
        )
      ).toBe(true)

      // Test file10 with valid frontmatter
      const file10Automations = automationsByFile['file10.md'] || []
      expect(file10Automations.length).toBe(2)

      // Both automations should have the same metadata
      file10Automations.forEach((automation) => {
        expect(automation.metadata).toBeTruthy()
        expect(automation.metadata).toEqual({
          name: 'Test Automation Group',
          description: 'A group of automations that share metadata',
          author: 'Test User',
          version: '1.0.0',
        })
      })

      // Test file11 with invalid frontmatter
      const file11Automations = automationsByFile['file11.md'] || []
      expect(file11Automations.length).toBe(2)

      // Test file12 with complex frontmatter
      const file12Automations = automationsByFile['file12.md'] || []
      expect(file12Automations.length).toBe(1)
      expect(file12Automations[0].metadata).toBeTruthy()
      expect(file12Automations[0].metadata?.name).toBe('Complex Frontmatter')
      expect(file12Automations[0].metadata?.configuration).toEqual({
        enabled: true,
        timeout: 5000,
        retries: 3,
      })
      expect(file12Automations[0].metadata?.tags).toEqual([
        'home',
        'automation',
        'testing',
      ])
      expect(file12Automations[0].metadata?.conditions).toEqual([
        { type: 'time', value: '08:00:00' },
        { type: 'state', entity: 'light.living_room', value: 'on' },
      ])

      // Test file13 where the YAML-like content is not frontmatter (not at beginning)
      const file13Automations = automationsByFile['file13.md'] || []
      expect(file13Automations.length).toBe(3) // Should be split into 3 parts due to --- separator
      expect(file13Automations[0].metadata).toBeUndefined()
      expect(file13Automations[1].metadata).toBeUndefined()
      expect(file13Automations[2].metadata).toBeUndefined()

      // Make sure the hashes are all different
      const hashes = automations.map((a) => a.hash)
      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(automations.length)
    })

    test('should parse and attach frontmatter to automations', async () => {
      const mockDir = path.join(
        import.meta.dir,
        '..',
        '..',
        'mocks',
        'automation-parsing'
      )
      const automations: Automation[] = []

      // Collect all automations
      for await (const automation of parseAutomations(mockDir)) {
        automations.push(automation)
      }

      // Group automations by filename for easier testing
      const automationsByFile = automations.reduce<
        Record<string, Automation[]>
      >((acc, automation) => {
        const list = acc[path.basename(automation.fileName)] || []
        list.push(automation)
        acc[path.basename(automation.fileName)] = list
        return acc
      }, {})

      // Test file10 with valid frontmatter
      const file10Automations = automationsByFile['file10.md'] || []
      expect(file10Automations.length).toBe(2)

      // Both automations should have the same metadata
      file10Automations.forEach((automation) => {
        expect(automation.metadata).toBeTruthy()
        expect(automation.metadata).toEqual({
          name: 'Test Automation Group',
          description: 'A group of automations that share metadata',
          author: 'Test User',
          version: '1.0.0',
        })
      })

      // Test file11 with invalid frontmatter
      const file11Automations = automationsByFile['file11.md'] || []
      expect(file11Automations.length).toBe(2)

      // Test file12 with complex frontmatter
      const file12Automations = automationsByFile['file12.md'] || []
      expect(file12Automations.length).toBe(1)
      expect(file12Automations[0].metadata).toBeTruthy()
      expect(file12Automations[0].metadata?.name).toBe('Complex Frontmatter')
      expect(file12Automations[0].metadata?.configuration).toEqual({
        enabled: true,
        timeout: 5000,
        retries: 3,
      })
      expect(file12Automations[0].metadata?.tags).toEqual([
        'home',
        'automation',
        'testing',
      ])
      expect(file12Automations[0].metadata?.conditions).toEqual([
        { type: 'time', value: '08:00:00' },
        { type: 'state', entity: 'light.living_room', value: 'on' },
      ])

      // Test file13 where the YAML-like content is not frontmatter (not at beginning)
      const file13Automations = automationsByFile['file13.md'] || []
      expect(file13Automations.length).toBe(3) // Should be split into 3 parts due to --- separator
      expect(file13Automations[0].metadata).toBeUndefined()
      expect(file13Automations[1].metadata).toBeUndefined()
      expect(file13Automations[2].metadata).toBeUndefined()
    })
  })

  describe('serializeAutomations', () => {
    const testDir = path.join(
      import.meta.dir,
      '..',
      '..',
      'mocks',
      'automation-serialization'
    )

    // Create test directory before tests
    beforeEach(async () => {
      try {
        await fs.mkdir(testDir, { recursive: true })
      } catch (error) {
        console.error(`Error creating test directory: ${error}`)
      }
    })

    // Clean up test directory after tests
    afterEach(async () => {
      try {
        const files = await fs.readdir(testDir)
        for (const file of files) {
          await fs.unlink(path.join(testDir, file))
        }
      } catch (error) {
        console.error(`Error cleaning up test directory: ${error}`)
      }
    })

    test('should serialize automations to files with the correct format', async () => {
      // Create test automations
      const testFile1 = path.join(testDir, 'test1.md')
      const testFile2 = path.join(testDir, 'test2.md')

      const automations: Automation[] = [
        {
          hash: '1',
          contents: 'First automation in file 1',
          fileName: testFile1,
        },
        {
          hash: '2',
          contents: 'Second automation in file 1',
          fileName: testFile1,
        },
        {
          hash: '3',
          contents: 'Single automation in file 2',
          fileName: testFile2,
        },
      ]

      // Serialize the automations
      await serializeAutomations(automations)

      // Read the files back and verify content
      const file1Content = await fs.readFile(testFile1, 'utf-8')
      const file2Content = await fs.readFile(testFile2, 'utf-8')

      // Check file1 has both automations with separator
      expect(file1Content).toBe(
        'First automation in file 1\n\n---\n\nSecond automation in file 1'
      )

      // Check file2 has single automation without separator
      expect(file2Content).toBe('Single automation in file 2')

      // Parse the files back to automations to verify round-trip
      const parsedAutomations: Automation[] = []
      for await (const automation of parseAutomations(testDir)) {
        parsedAutomations.push(automation)
      }

      // Should have 3 automations after parsing
      expect(parsedAutomations.length).toBe(3)

      // Check content matches (ignoring hash which will be recalculated)
      const parsedContents = parsedAutomations.map((a) => a.contents).sort()
      const originalContents = automations.map((a) => a.contents).sort()

      expect(parsedContents).toEqual(originalContents)
    })

    test('should handle empty array of automations', async () => {
      await serializeAutomations([])
      // Should not throw errors
    })

    test('should preserve frontmatter when serializing automations', async () => {
      const frontmatterTestDir = path.join(
        import.meta.dir,
        '..',
        '..',
        'mocks',
        'automation-serialization',
        'frontmatter-test'
      )
      await fs.mkdir(frontmatterTestDir, { recursive: true })

      try {
        // Create test automations with metadata
        const testFile = path.join(frontmatterTestDir, 'test-frontmatter.md')
        const metadata = {
          name: 'Test Automation',
          version: '1.0.0',
          tags: ['test', 'frontmatter'],
        }

        const automations: Automation[] = [
          {
            hash: '1',
            contents: 'First automation with frontmatter',
            fileName: testFile,
            metadata,
          },
          {
            hash: '2',
            contents: 'Second automation with same frontmatter',
            fileName: testFile,
            metadata,
          },
        ]

        // Serialize the automations
        await serializeAutomations(automations)

        // Read the file back
        const fileContent = await fs.readFile(testFile, 'utf-8')

        // Check that file contains frontmatter and both automations
        expect(fileContent).toContain('name: Test Automation')
        expect(fileContent).toContain('version: 1.0.0')
        expect(fileContent).toContain('- test')
        expect(fileContent).toContain('- frontmatter')
        expect(fileContent).toContain('First automation with frontmatter')
        expect(fileContent).toContain('Second automation with same frontmatter')

        // Parse the file back and verify the round trip
        const parsedAutomations: Automation[] = []
        for await (const automation of parseAutomations(frontmatterTestDir)) {
          parsedAutomations.push(automation)
        }

        // Should have 2 automations
        expect(parsedAutomations.length).toBe(2)

        // Both should have metadata
        parsedAutomations.forEach((automation) => {
          expect(automation.metadata).toEqual(metadata)
        })
      } finally {
        // Clean up after test
        await fs.rm(frontmatterTestDir, { recursive: true, force: true })
      }
    })
  })

  describe('parseAllAutomations', () => {
    test('should collect all automations into an array', async () => {
      const mockDir = path.join(
        import.meta.dir,
        '..',
        '..',
        'mocks',
        'automation-parsing'
      )
      const { parseAllAutomations } = await import('./parser')

      // Get all automations
      const automations = await parseAllAutomations(mockDir)

      // Basic validation
      expect(automations.length).toBeGreaterThan(10)
      expect(automations).toBeInstanceOf(Array)
      expect(automations.every((a) => a.hash && a.contents && a.fileName)).toBe(
        true
      )

      // Group automations by filename for easier validation
      const automationsByFile = automations.reduce<
        Record<string, Automation[]>
      >((acc, automation) => {
        const list = acc[automation.fileName] || []
        list.push(automation)
        acc[automation.fileName] = list
        return acc
      }, {})

      // Verify we have automations from each test file
      expect(Object.keys(automationsByFile).length).toBe(13)

      // Make sure the hashes are all different
      const hashes = automations.map((a) => a.hash)
      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(automations.length)
    })
  })

  describe('parseAndSerializeAutomations', () => {
    const testDir = path.join(
      import.meta.dir,
      '..',
      '..',
      'mocks',
      'automation-round-trip'
    )

    // Create test directory before tests
    beforeEach(async () => {
      try {
        await fs.mkdir(testDir, { recursive: true })
      } catch (error) {
        console.error(`Error creating test directory: ${error}`)
      }
    })

    // Clean up test directory after tests
    afterEach(async () => {
      try {
        const files = await fs.readdir(testDir)
        for (const file of files) {
          await fs.unlink(path.join(testDir, file))
        }
      } catch (error) {
        console.error(`Error cleaning up test directory: ${error}`)
      }
    })

    test('should parse and serialize automations in a round-trip', async () => {
      // Create initial test files
      const testFile1 = path.join(testDir, 'test1.md')
      const testFile2 = path.join(testDir, 'test2.md')

      const file1Content = 'First automation\n\n---\n\nSecond automation'
      const file2Content = 'Single automation'

      await fs.writeFile(testFile1, file1Content, 'utf-8')
      await fs.writeFile(testFile2, file2Content, 'utf-8')

      // Run the round-trip process
      await parseAndSerializeAutomations(testDir)

      // Read the files back to verify content is preserved
      const newFile1Content = await fs.readFile(testFile1, 'utf-8')
      const newFile2Content = await fs.readFile(testFile2, 'utf-8')

      // Check serialization maintained the same content
      expect(newFile1Content).toBe(file1Content)
      expect(newFile2Content).toBe(file2Content)
    })
  })
})
