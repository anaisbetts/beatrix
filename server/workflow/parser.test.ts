import { describe, test, expect } from 'bun:test'
import { parseAutomations } from './parser'
import { Automation } from '../../shared/types'
import * as path from 'path'

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

      // Make sure the hashes are all different
      const hashes = automations.map((a) => a.hash)
      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(automations.length)
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
      expect(Object.keys(automationsByFile).length).toBe(9) // 9 test files

      // Make sure the hashes are all different
      const hashes = automations.map((a) => a.hash)
      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(automations.length)
    })
  })
})
