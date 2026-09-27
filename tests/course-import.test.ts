import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const runImport = async (file: string) => {
  const { stdout } = await exec('node', ['scripts/import-courses.mjs', file], { cwd: process.cwd() })
  return JSON.parse(stdout)
}

describe('course importer', () => {
  it('reads a headerless workbook without dropping the first course or using row numbers as IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'course-import-'))
    try {
      const file = join(directory, 'synthetic.xlsx')
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['JC 101', 'Synthetic first course', 'Synthetic category'],
        ['JC102', 'Synthetic second course', 'Synthetic category'],
      ]), 'Courses')
      XLSX.writeFile(workbook, file)
      const report = await runImport(file)
      expect(report.sourceRows).toBe(2)
      expect(report.accepted).toBe(2)
      expect(report.courses).toEqual([
        { code: 'JC101', name: 'Synthetic first course', category: 'Synthetic category', sourceRow: 1 },
        { code: 'JC102', name: 'Synthetic second course', category: 'Synthetic category', sourceRow: 2 },
      ])
      expect(report.courses[0]).not.toHaveProperty('id')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('normalizes fresh exports and reports duplicate and incomplete rows', async () => {
    const report = await runImport('tests/fixtures/courses-fresh.json')
    expect(report.accepted).toBe(2)
    expect(report.courses.map((course: { code: string }) => course.code)).toEqual(['JC301', 'JC303'])
    expect(report.rejected).toEqual([
      expect.objectContaining({ row: 2, reason: expect.stringContaining('duplicate code (JC301)') }),
      expect.objectContaining({ row: 3, reason: expect.stringContaining('missing') }),
    ])
  })
})
