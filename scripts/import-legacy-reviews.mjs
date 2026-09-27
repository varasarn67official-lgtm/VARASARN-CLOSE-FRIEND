import XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
import { normalizeCourseCode, normalizeLegacyReviews } from './legacy-review-normalize.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const file = args[0]
if (!file || file.startsWith('--')) {
  throw new Error('Usage: npm run import:legacy-reviews -- <export.xlsx|export.json> [--catalog <courses.xlsx|courses.json> | --catalog-db] [--commit] [--offset +07:00]')
}
const commit = flag('--commit')
const offset = option('--offset') ?? '+07:00'
if (!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error('--offset must look like +07:00')

async function readReviews(path) {
  if (path.endsWith('.json')) {
    const rows = JSON.parse(await readFile(path, 'utf8'))
    if (!Array.isArray(rows)) throw new Error('Review export must be an array of row objects')
    return { rows, firstRow: 1 }
  }
  const sheet = XLSX.readFile(path).Sheets.Reviews
  if (!sheet) throw new Error('Workbook has no Reviews sheet')
  return { rows: XLSX.utils.sheet_to_json(sheet, { defval: '' }), firstRow: 2 }
}

async function readCatalogFile(path) {
  const rows = path.endsWith('.json')
    ? JSON.parse(await readFile(path, 'utf8'))
    : XLSX.utils.sheet_to_json(XLSX.readFile(path).Sheets.Courses, { header: 1, defval: '' })
  return new Set(rows.map((row) => normalizeCourseCode(Array.isArray(row) ? row[0] : row.code)).filter(Boolean))
}

let db
async function connect() {
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required for --catalog-db and --commit')
  const { default: pg } = await import('pg')
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED })
  await db.connect()
}

try {
  const { rows, firstRow } = await readReviews(file)
  let catalog = null
  if (commit || flag('--catalog-db')) {
    await connect()
    catalog = new Set((await db.query('select code from app_private.courses')).rows.map((r) => r.code))
  } else if (option('--catalog')) {
    catalog = await readCatalogFile(option('--catalog'))
  }
  const report = { mode: commit ? 'commit' : 'dry-run', ...normalizeLegacyReviews(rows, { catalog, offset, firstRow }) }
  if (!report.balanced) throw new Error('Source rows do not reconcile with accepted, rejected, and blank rows')
  if (commit) {
    const payload = report.reviews.map(({ sourceRow, courseCode, rating, text, semester, year, section, instructorName, createdAt }) =>
      ({ sourceRow, courseCode, rating, text, semester, year, section, instructorName, createdAt }))
    await db.query('begin')
    try {
      const { rows: [result] } = await db.query('select * from app_private.import_legacy_review_rows($1::jsonb)', [JSON.stringify(payload)])
      if (result.imported_count + result.duplicate_count !== payload.length) throw new Error('Imported and duplicate counts do not reconcile with accepted rows')
      await db.query(
        "insert into app_private.legacy_import_audit(actor_user_id,via,source_rows,imported_count,duplicate_count) values(null,'database_script',$1,$2,$3)",
        [payload.length, result.imported_count, result.duplicate_count],
      )
      await db.query('commit')
      report.imported = result.imported_count
      report.alreadyPresent = result.duplicate_count
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await db?.end()
}
