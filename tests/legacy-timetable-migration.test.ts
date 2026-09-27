import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { migrateLegacyTimetable, readLegacyTimetable, type LegacyClass } from '../src/services/legacy-timetable-import'

const key = 'my_tu_schedule_student@example.com'
const valid = { code: 'JC100', name: 'วารสารศาสตร์', sec: '1', teacher: 'อาจารย์เดิม', day: 'จันทร์', start: '09:00', end: '11:00' }
const storage = () => window.localStorage
const authenticRaw = readFileSync('tests/fixtures/legacy-timetable-authentic.json', 'utf8')
const entry = (overrides: Partial<LegacyClass> = {}, index = 1): LegacyClass => ({ index, code: valid.code, name: valid.name, section: valid.sec, teacher: valid.teacher, day: valid.day, start: valid.start, end: valid.end, ...overrides })

beforeEach(() => window.localStorage.clear())

describe('silent legacy timetable migration', () => {
  it('migrates authentic JC232 at 09:30 without rewriting the preserved source', async () => {
    expect(createHash('sha256').update(authenticRaw).digest('hex')).toBe('3e12cb71b8d0f054d6a484d4e2bbf2478bf13514a317bd77cdcb32f5c447e8b2')
    storage().setItem(key, authenticRaw)
    const source = readLegacyTimetable('student@example.com', storage())
    expect(source.kind).toBe('found')
    if (source.kind !== 'found') return
    expect(source.entries[1]).toMatchObject({ code: 'JC232', section: '320001', day: 'พฤหัสบดี', start: '09:30', end: '12:30' })
    expect(source.entries.every(row => !row.invalidReason)).toBe(true)
    const rpc = vi.fn(async () => ({ data: { outcome: 'added-legacy' }, error: null }))
    expect((await migrateLegacyTimetable({ rpc }, source.entries)).map(row => row.outcome)).toEqual(['added-legacy', 'added-legacy'])
    expect(rpc).toHaveBeenCalledWith('migrate_legacy_timetable_entry', expect.objectContaining({
      p_entry: expect.objectContaining({ code: 'JC232', sec: '320001', start: '09:30', end: '12:30' }), p_conflicting: false,
    }))
    expect(storage().getItem(key)).toBe(authenticRaw)
  })

  it('deduplicates H:mm and HH:mm before conflict checks and sends the same canonical receipt payload', async () => {
    const jc232 = JSON.parse(authenticRaw)[1]
    const rpc = vi.fn(async () => ({ data: { outcome: 'already-present' }, error: null }))
    for (const rows of [[jc232, { ...jc232, start: '09:30' }], [{ ...jc232, start: '09:30' }, jc232], [jc232], [{ ...jc232, start: '09:30' }]]) {
      const raw = JSON.stringify(rows)
      storage().setItem(key, raw)
      const source = readLegacyTimetable('student@example.com', storage())
      expect(source.kind).toBe('found')
      if (source.kind !== 'found') return
      rpc.mockClear()
      const result = await migrateLegacyTimetable({ rpc }, source.entries)
      expect(result.map(row => row.outcome)).toEqual(['already-present'])
      expect(rpc).toHaveBeenCalledExactlyOnceWith('migrate_legacy_timetable_entry', {
        p_migration_version: 1, p_entry: { ...jc232, start: '09:30' }, p_conflicting: false,
      })
      expect(storage().getItem(key)).toBe(raw)
    }
  })

  it.each([
    ['0:00', '0:01', '00:00', '00:01'],
    ['9:05', '9:30', '09:05', '09:30'],
    ['09:30', '23:59', '09:30', '23:59'],
  ])('normalizes valid legacy interval %s–%s', (start, end, expectedStart, expectedEnd) => {
    const raw = JSON.stringify([{ ...valid, start, end }])
    storage().setItem(key, raw)
    const source = readLegacyTimetable('student@example.com', storage())
    expect(source.kind).toBe('found')
    if (source.kind !== 'found') return
    expect(source.entries[0]).toMatchObject({ start: expectedStart, end: expectedEnd })
    expect(source.entries[0].invalidReason).toBeUndefined()
    expect(storage().getItem(key)).toBe(raw)
  })

  it.each([
    ['24:00', '25:00'], ['9:60', '12:30'], ['09:30', '12:60'], ['09:30', '24:00'],
    ['-1:30', '12:30'], ['009:30', '12:30'], ['9:3', '12:30'], ['9:30:00', '12:30'],
    ['9.30', '12:30'], ['9 :30', '12:30'], ['9:30x', '12:30'], ['', '12:30'],
    [930, '12:30'], [null, '12:30'], ['09:30', {}],
    ['9:30', '09:30'], ['09:30', '9:29'], ['23:30', '0:30'],
  ])('rejects invalid or non-increasing legacy interval %j–%j without writes', async (start, end) => {
    const raw = JSON.stringify([{ ...valid, start, end }])
    storage().setItem(key, raw)
    const source = readLegacyTimetable('student@example.com', storage())
    expect(source.kind).toBe('found')
    if (source.kind !== 'found') return
    const rpc = vi.fn()
    expect((await migrateLegacyTimetable({ rpc }, source.entries)).map(row => row.outcome)).toEqual(['invalid'])
    expect(rpc).not.toHaveBeenCalled()
    expect(storage().getItem(key)).toBe(raw)
  })

  it.each([null, '[]'])('does not schedule work for absent or empty data (%s)', (raw) => {
    if (raw !== null) storage().setItem(key, raw)
    expect(readLegacyTimetable('student@example.com', storage())).toEqual({ kind: 'none' })
  })

  it('preserves unsupported and malformed storage without rewriting it', () => {
    for (const raw of ['{broken', '{"classes":[]}']) {
      storage().setItem(key, raw)
      expect(readLegacyTimetable('student@example.com', storage()).kind).toBe('error')
      expect(storage().getItem(key)).toBe(raw)
    }
  })

  it('reads a normalized email key and rejects invalid rows individually', () => {
    storage().setItem('my_tu_schedule_Student@Example.com', JSON.stringify([valid, { ...valid, sec: '2', day: 'Someday' }]))
    const source = readLegacyTimetable(' student@example.com ', storage())
    expect(source.kind).toBe('found')
    if (source.kind !== 'found') return
    expect(source.entries[0].invalidReason).toBeUndefined()
    expect(source.entries[1].invalidReason).toBeDefined()
  })

  it('coalesces identical rows and records one durable server request', async () => {
    const requests: Array<Record<string, unknown>> = []
    const client = { rpc: vi.fn(async (_name: string, args?: Record<string, unknown>) => {
      requests.push(args ?? {})
      return { data: { outcome: 'added-official' }, error: null }
    }) }
    const entries = [entry({}, 1), entry({}, 2)]
    const result = await migrateLegacyTimetable(client, entries)
    expect(requests).toHaveLength(1)
    expect(requests[0].p_migration_version).toBe(1)
    expect(requests[0].p_entry).toEqual(valid)
    expect(result.map((item) => item.outcome)).toEqual(['added-official'])
  })

  it('marks every duplicate-course or overlapping legacy row as unresolved', async () => {
    const requests: Array<Record<string, unknown>> = []
    const client = { rpc: vi.fn(async (_name: string, args?: Record<string, unknown>) => {
      requests.push(args ?? {})
      return { data: { outcome: 'conflict' }, error: null }
    }) }
    const rows: LegacyClass[] = [
      entry({}, 1),
      entry({ code: 'BJM200', section: '4' }, 2),
      entry({ code: 'GE101', section: '9', start: '10:00', end: '12:00' }, 3),
    ]
    const outcomes = await migrateLegacyTimetable(client, rows)
    expect(requests.map((request) => request.p_conflicting)).toEqual([true, true, true])
    expect(outcomes.every((item) => item.outcome === 'conflict')).toBe(true)
  })

  it('continues with valid rows when one source row is invalid', async () => {
    const client = { rpc: vi.fn(async () => ({ data: { outcome: 'added-legacy' }, error: null })) }
    const rows: LegacyClass[] = [entry({ invalidReason: 'bad' }, 1), entry({}, 2)]
    const result = await migrateLegacyTimetable(client, rows)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(result.map((item) => item.outcome)).toEqual(['invalid', 'added-legacy'])
  })

  it('keeps failed RPCs retryable and does not mutate the browser source', async () => {
    const raw = JSON.stringify([valid])
    storage().setItem(key, raw)
    const source = readLegacyTimetable('student@example.com', storage())
    expect(source.kind).toBe('found')
    if (source.kind !== 'found') return
    const client = { rpc: vi.fn(async () => ({ data: null, error: { message: 'offline' } })) }
    expect((await migrateLegacyTimetable(client, source.entries))[0].outcome).toBe('retryable')
    expect(storage().getItem(key)).toBe(raw)
  })
})
