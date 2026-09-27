const pad = (n) => String(n).padStart(2, '0')
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const normalizeCourseCode = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
export const sectionKey = (section) => section.toLowerCase().replace(/\s+/g, '')

export function normalizeRating(value) {
  const rating = Number(value)
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null
}

// The old form stored the bare term number; the rebuilt schema uses '1', '2', or 'ฤดูร้อน'.
export function normalizeSemester(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '1' || raw === '2') return raw
  if (['3', 'ฤดูร้อน', 'ภาคฤดูร้อน', 'summer'].includes(raw)) return 'ฤดูร้อน'
  return null
}

// Thai academic years are Buddhist Era; a Common Era year is converted rather than rejected.
export function normalizeYear(value) {
  const year = Number(value)
  if (!Number.isInteger(year)) return null
  if (year >= 2400 && year <= 2700) return { year, converted: false }
  if (year >= 1857 && year <= 2157) return { year: year + 543, converted: true }
  return null
}

// Google Sheets writes `new Date()` as a day serial in the sheet's own time zone (Bangkok for this project).
export function normalizeTimestamp(value, offset = '+07:00') {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const d = new Date(Math.round((value - 25569) * 86400) * 1000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${offset}`
  }
  const raw = String(value ?? '').trim()
  if (ISO_WITH_OFFSET.test(raw) && !Number.isNaN(Date.parse(raw))) return raw
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}${offset}`))) return `${raw}${offset}`
  return null
}

const isBlank = (row) => Object.values(row).every((v) => String(v ?? '').trim() === '')

export function normalizeLegacyReviews(rows, { catalog = null, offset = '+07:00', firstRow = 2 } = {}) {
  const reviews = []; const rejected = []; const normalizations = []; const seen = new Map()
  let blankRows = 0
  rows.forEach((row, index) => {
    const sourceRow = index + firstRow
    if (isBlank(row)) { blankRows++; return }
    const courseCode = normalizeCourseCode(row.CourseCode)
    const rating = normalizeRating(row.Rating)
    const text = String(row.ReviewText ?? '').trim()
    const semester = normalizeSemester(row.Semester)
    const year = normalizeYear(row.Year)
    const section = String(row.Section ?? '').trim()
    const createdAt = normalizeTimestamp(row.Timestamp, offset)
    const invalid = [
      !courseCode && 'course code', rating === null && 'rating', !text && 'review text', semester === null && 'semester',
      year === null && 'year', !section && 'section', createdAt === null && 'timestamp',
    ].filter(Boolean)
    if (invalid.length) { rejected.push({ row: sourceRow, kind: 'invalid', reason: `missing or invalid ${invalid.join(', ')}` }); return }
    if (catalog && !catalog.has(courseCode)) { rejected.push({ row: sourceRow, kind: 'unmatched', courseCode, reason: `course ${courseCode} is not in the catalog` }); return }
    const key = `${courseCode}/${year.year}/${semester}/${sectionKey(section)}/${text}`
    if (seen.has(key)) { rejected.push({ row: sourceRow, kind: 'duplicate', firstRow: seen.get(key), reason: `duplicate of row ${seen.get(key)}` }); return }
    seen.set(key, sourceRow)
    if (year.converted) normalizations.push({ row: sourceRow, field: 'year', from: Number(row.Year), to: year.year })
    reviews.push({
      sourceRow, courseCode, rating, text, semester, year: year.year, section,
      instructorName: String(row.Teacher ?? '').trim() || null, createdAt, scheduleVerified: false,
    })
  })
  const count = (kind) => rejected.filter((r) => r.kind === kind).length
  return {
    sourceRows: rows.length, blankRows, accepted: reviews.length,
    invalid: count('invalid'), duplicates: count('duplicate'), unmatched: count('unmatched'),
    balanced: rows.length === blankRows + reviews.length + rejected.length,
    catalogChecked: Boolean(catalog), rejected, normalizations, reviews,
    discardedFields: ['CreatorEmail', 'Day', 'StartTime', 'EndTime'],
  }
}
