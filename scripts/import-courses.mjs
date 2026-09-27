import XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'

const [file, mode = '--dry-run'] = process.argv.slice(2)
if (!file) throw new Error('Usage: npm run import:courses -- <workbook.xlsx> [--commit]')
const rows = file.endsWith('.json')
  ? JSON.parse(await readFile(file, 'utf8'))
  : XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets.Courses, { header: 1, defval: '' })
if (!Array.isArray(rows)) throw new Error('Course export must be an array of rows')
const seen = new Map(); const accepted = []; const rejected = []
rows.forEach((row, index) => {
  const [rawCode, rawName, rawCategory] = row
  if (!String(rawCode).trim() && !String(rawName).trim() && !String(rawCategory).trim()) return
  const code = String(rawCode).trim().toUpperCase().replace(/\s+/g, '')
  const name = String(rawName).trim(); const category = String(rawCategory).trim()
  if (!code || !name || !category) rejected.push({ row: index + 1, reason: 'missing code, name, or category' })
  else if (seen.has(code)) rejected.push({ row: index + 1, reason: `duplicate code (${code}); first at row ${seen.get(code)}` })
  else { seen.set(code, index + 1); accepted.push({ code, name, category, sourceRow: index + 1 }) }
})
const report = { mode, sourceRows: rows.length, accepted: accepted.length, rejected, courses: accepted }
if (mode !== '--commit') console.log(JSON.stringify(report, null, 2))
else {
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required for commit mode')
  const { Client } = await import('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await db.connect(); await db.query('begin')
  try {
    let inserted = 0; let existing = 0
    for (const course of accepted) {
      const category = await db.query('insert into app_private.categories(name) values($1) on conflict(name) do update set name=excluded.name returning id', [course.category])
      const result = await db.query("insert into app_private.courses(code,name_th,category_name,category_id) values($1,$2,$3,$4) on conflict(code) do nothing", [course.code, course.name, course.category, category.rows[0].id])
      result.rowCount ? inserted++ : existing++
    }
    const total = await db.query('select count(*)::int as count from app_private.courses'); await db.query('commit')
    console.log(JSON.stringify({ ...report, inserted, existing, resultingCatalogCount: total.rows[0].count }, null, 2))
  } catch (error) { await db.query('rollback'); throw error } finally { await db.end() }
}
