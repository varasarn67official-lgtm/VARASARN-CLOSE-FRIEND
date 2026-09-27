import { describe, expect, it } from 'vitest'
import { isValidMeeting, overlaps } from '../src/services/timetable'

describe('timetable overlaps', () => {
  it('treats touching intervals as non-conflicting', () => expect(overlaps({ day: 1, start: '09:00', end: '10:00' }, { day: 1, start: '10:00', end: '11:00' })).toBe(false))
  it('detects contained intervals on the same day', () => expect(overlaps({ day: 1, start: '09:00', end: '12:00' }, { day: 1, start: '10:00', end: '11:00' })).toBe(true))
  it('detects equal intervals and ignores different days', () => { expect(overlaps({ day: 1, start: '09:00', end: '10:00' }, { day: 1, start: '09:00', end: '10:00' })).toBe(true); expect(overlaps({ day: 1, start: '09:00', end: '10:00' }, { day: 2, start: '09:00', end: '10:00' })).toBe(false) })
  it('rejects malformed and reversed meeting intervals', () => { expect(isValidMeeting({ day: 1, start: '10:00', end: '09:00' })).toBe(false); expect(isValidMeeting({ day: 8, start: '09:00', end: '10:00' })).toBe(false); expect(() => overlaps({ day: 1, start: 'bad', end: '10:00' }, { day: 1, start: '09:00', end: '10:00' })).toThrow('invalid meeting interval') })
})
