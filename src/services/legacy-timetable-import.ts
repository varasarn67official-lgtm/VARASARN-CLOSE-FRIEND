import type { RpcClient } from './reviews'
import { isValidMeeting, overlaps, type Meeting } from './timetable'

const legacyPrefix = 'my_tu_schedule_'
export const weekdays = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export const legacyMigrationVersion = 1

export type LegacyClass = {
  index: number
  code: string
  name: string
  section: string
  teacher: string
  day: string
  start: string
  end: string
  invalidReason?: string
}
export type LegacySource =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'found'; entries: LegacyClass[] }
export type LegacyMigrationOutcome = 'added-official' | 'added-legacy' | 'already-present' | 'invalid' | 'conflict' | 'retryable'
export type LegacyMigrationResult = { entry: LegacyClass; outcome: LegacyMigrationOutcome }

function normalizedCode(value: string) { return value.replace(/\s+/g, '').toUpperCase() }
function normalizedSection(value: string) { return value.replace(/\s+/g, '').toLowerCase() }
function normalizedTeacher(value: string) { return value.trim().replace(/\s+/g, ' ').toLowerCase() }
function validTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) }
function stringField(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function legacyTime(value: unknown): string {
  const time = stringField(value)
  // Old UI saves H:mm as well as HH:mm. Canonicalize only the parsed copy,
  // before validation, conflict checks, deduplication and receipt payloads.
  return /^(?:[0-9]|[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time.padStart(5, '0') : time
}
function minutes(value: string) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) }
function legacyKey(row: LegacyClass) {
  return JSON.stringify([normalizedCode(row.code), row.name.trim(), normalizedSection(row.section), normalizedTeacher(row.teacher), row.day, row.start, row.end])
}
function rowPayload(row: LegacyClass) {
  return { code: row.code, name: row.name, sec: row.section, teacher: row.teacher, day: row.day, start: row.start, end: row.end }
}

function parseEntry(value: unknown, index: number): LegacyClass {
  const row = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const entry = {
    index,
    code: stringField(row.code),
    name: stringField(row.name),
    section: stringField(row.sec),
    teacher: stringField(row.teacher),
    day: stringField(row.day),
    start: legacyTime(row.start),
    end: legacyTime(row.end),
  }
  const dayIndex = weekdays.indexOf(entry.day) + 1
  const meeting = { day: dayIndex, start: entry.start, end: entry.end }
  return {
    ...entry,
    ...(!entry.code || !entry.section || !validTime(entry.start) || !validTime(entry.end) || !isValidMeeting(meeting)
      ? { invalidReason: 'ข้อมูลวิชา กลุ่ม หรือเวลาเรียนเดิมไม่ถูกต้อง' }
      : {}),
  }
}

export function readLegacyTimetable(email: string, storage: Pick<Storage, 'length' | 'key' | 'getItem'>): LegacySource {
  if (!email.trim()) return { kind: 'none' }
  try {
    const matches: string[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(legacyPrefix) && key.slice(legacyPrefix.length).trim().toLowerCase() === email.trim().toLowerCase()) matches.push(key)
    }
    if (matches.length > 1) return { kind: 'error', message: 'พบตารางเรียนเดิมหลายรายการสำหรับอีเมลนี้' }
    const key = matches[0]
    if (!key) return { kind: 'none' }
    const raw = storage.getItem(key)
    if (raw === null) return { kind: 'none' }
    let parsed: unknown
    try { parsed = JSON.parse(raw) }
    catch { return { kind: 'error', message: 'รูปแบบข้อมูลตารางเรียนเดิมไม่ถูกต้อง' } }
    if (!Array.isArray(parsed)) return { kind: 'error', message: 'ข้อมูลตารางเรียนเดิมไม่ใช่รายการวิชา' }
    if (parsed.length === 0) return { kind: 'none' }
    return { kind: 'found', entries: parsed.map((value, index) => parseEntry(value, index + 1)) }
  } catch {
    return { kind: 'error', message: 'อ่านข้อมูลตารางเรียนเดิมจากเบราว์เซอร์ไม่ได้' }
  }
}

function hasPairConflict(a: LegacyClass, b: LegacyClass) {
  if (normalizedCode(a.code) === normalizedCode(b.code)) return true
  const aDay = weekdays.indexOf(a.day) + 1
  const bDay = weekdays.indexOf(b.day) + 1
  const aMeeting: Meeting = { day: aDay, start: a.start, end: a.end }
  const bMeeting: Meeting = { day: bDay, start: b.start, end: b.end }
  return overlaps(aMeeting, bMeeting)
}

export async function migrateLegacyTimetable(client: RpcClient, entries: LegacyClass[]): Promise<LegacyMigrationResult[]> {
  const valid = entries.filter((entry) => !entry.invalidReason)
  const unique = new Map<string, LegacyClass>()
  for (const entry of valid) unique.set(legacyKey(entry), entry)
  const rows = [...unique.entries()]
  const conflicting = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (hasPairConflict(rows[i][1], rows[j][1])) {
        conflicting.add(rows[i][0])
        conflicting.add(rows[j][0])
      }
    }
  }

  const results: LegacyMigrationResult[] = entries.filter((entry) => entry.invalidReason)
    .map((entry) => ({ entry, outcome: 'invalid' }))
  for (const [key, entry] of rows) {
    try {
      const { data, error } = await client.rpc('migrate_legacy_timetable_entry', {
        p_migration_version: legacyMigrationVersion,
        p_entry: rowPayload(entry),
        p_conflicting: conflicting.has(key),
      })
      if (error) throw new Error(error.message)
      const result = (Array.isArray(data) ? data[0] : data) as { outcome?: LegacyMigrationOutcome } | null
      const outcome = result?.outcome
      results.push({ entry, outcome: outcome && ['added-official', 'added-legacy', 'already-present', 'invalid', 'conflict'].includes(outcome) ? outcome : 'retryable' })
    } catch {
      results.push({ entry, outcome: 'retryable' })
    }
  }
  return results
}
