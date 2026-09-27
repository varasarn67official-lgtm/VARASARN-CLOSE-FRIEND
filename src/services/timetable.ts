export type Meeting = { day: number; start: string; end: string }
const minutes = (time: string) => { if (!/^\d\d:\d\d$/.test(time)) return Number.NaN; const [hours, mins] = time.split(':').map(Number); return hours * 60 + mins }
export function isValidMeeting(meeting: Meeting): boolean { const start = minutes(meeting.start); const end = minutes(meeting.end); return Number.isInteger(meeting.day) && meeting.day >= 1 && meeting.day <= 7 && Number.isFinite(start) && Number.isFinite(end) && start < end }
export function overlaps(a: Meeting, b: Meeting): boolean {
  if (!isValidMeeting(a) || !isValidMeeting(b)) throw new Error('invalid meeting interval')
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end)
}
