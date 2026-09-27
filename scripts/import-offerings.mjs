import { readFile } from 'node:fs/promises'

const [file] = process.argv.slice(2)
if (!file) throw new Error('Usage: node scripts/import-offerings.mjs offerings.json')
const rows = JSON.parse(await readFile(file, 'utf8'))
const errors = []; const valid = []; const seen = new Set()
for (const [index, row] of rows.entries()) {
  const code = String(row.courseCode ?? '').trim().toUpperCase().replace(/\s+/g, ''); const semester = String(row.semester ?? '').trim(); const section = String(row.section ?? '').trim()
  const key = `${code}/${row.academicYear}/${semester}/${section}`
  if (!code || !Number.isInteger(row.academicYear) || !semester || !section) errors.push({ row: index + 1, reason: 'course code, academic year, semester, and section are required' })
  else if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 1 || row.dayOfWeek > 7 || !/^\d\d:\d\d$/.test(row.startsAt) || !/^\d\d:\d\d$/.test(row.endsAt) || row.endsAt <= row.startsAt) errors.push({ row: index + 1, reason: 'invalid meeting interval' })
  else if (seen.has(key)) errors.push({ row: index + 1, reason: `duplicate offering (${key})` })
  else { seen.add(key); valid.push({ ...row, courseCode: code, semester, section }) }
}
console.log(JSON.stringify({ sourceRows: rows.length, valid: valid.length, errors, preview: valid }, null, 2))
