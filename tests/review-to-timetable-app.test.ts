import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  offerings: [{ id: 'offering-1', section: '320001', academic_year: 2568, semester: '1', instructor_name: 'อ. อ้อม' as string | null }],
  reviews: [{ id: 'review-1', rating: 5, text: 'สนุกมาก', created_at: '2026-09-23T10:00:00Z', section: '320001', semester: '1', academic_year: 2568, instructor_name: 'อ. อ้อม', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00' }],
  meetings: [{ day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00' }],
  timetable: [] as Array<{ offering_id: string; course_code: string; course_name: string; section: string; day_of_week: number; starts_at: string; ends_at: string; instructor_name: string | null }>,
  reported: [] as Array<{ review_id: string; course_code: string; course_name: string; section: string; day_of_week: number; starts_at: string; ends_at: string; instructor_name: string | null }>,
  proposals: [] as Array<{ id: string; course_id: string; academic_year: number; semester: string; section: string; instructor_name: string | null; status: string; created_at: string }>,
  writeError: null as string | null,
  removeError: null as string | null,
  loadError: null as string | null,
  loadGate: null as Promise<void> | null,
  role: null as 'owner' | 'administrator' | null,
  signOutCalls: 0,
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: { id: 'user-1', email: 'student@example.com', name: 'Student' } } }), signOut: async () => { fixture.signOutCalls++ } },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fixture.calls.push({ name, args })
      if (name === 'list_approved_catalog') return { data: [{ id: 'course-1', code: 'JC232', name_th: 'เทคนิคการถ่ายทำ', category_name: 'วิชาเอก' }], error: null }
      if (name === 'list_approved_offerings') return { data: fixture.offerings, error: null }
      if (name === 'list_visible_reviews') return { data: fixture.reviews, error: null }
      if (name === 'list_approved_offering_meetings') return { data: fixture.meetings, error: null }
      if (name === 'list_my_timetable') {
        await fixture.loadGate
        return fixture.loadError ? { data: null, error: { message: fixture.loadError } } : { data: fixture.timetable, error: null }
      }
      if (name === 'list_my_reported_timetable') return { data: fixture.reported, error: null }
      if (name === 'list_my_legacy_timetable') return { data: [], error: null }
      if (name === 'add_my_timetable_review') {
        if (fixture.writeError) return { data: null, error: { message: fixture.writeError } }
        fixture.timetable = fixture.timetable.filter((entry) => entry.course_code !== 'JC232')
        fixture.reported = [{ review_id: String(args?.p_review_id), course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
        return { data: null, error: null }
      }
      if (name === 'remove_my_legacy_timetable_entry') return { data: null, error: null }
      if (name === 'migrate_legacy_timetable_entry') {
        const row = args?.p_entry as Record<string, string>
        if (args?.p_conflicting) return { data: { outcome: 'conflict' }, error: null }
        fixture.timetable = [...fixture.timetable, { offering_id: 'offering-1', course_code: row.code, course_name: row.name, section: row.sec, day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: row.teacher }]
        return { data: { outcome: 'added-official' }, error: null }
      }
      if (name === 'remove_my_timetable_review') {
        if (fixture.removeError) return { data: null, error: { message: fixture.removeError } }
        fixture.reported = fixture.reported.filter((entry) => entry.review_id !== args?.p_review_id)
        return { data: null, error: null }
      }
      if (name === 'remove_my_timetable_offering') {
        if (fixture.removeError) return { data: null, error: { message: fixture.removeError } }
        fixture.timetable = fixture.timetable.filter((entry) => entry.offering_id !== args?.p_offering_id)
        return { data: null, error: null }
      }
      if (name === 'clear_my_timetable') {
        fixture.timetable = []
        fixture.reported = []
        return { data: null, error: null }
      }
      if (name === 'add_my_timetable_offering' || name === 'replace_my_timetable_offering') {
        if (fixture.writeError) return { data: null, error: { message: fixture.writeError } }
        fixture.timetable = [...fixture.timetable.filter((entry) => name !== 'replace_my_timetable_offering' || entry.course_code !== 'JC232'), { offering_id: String(args?.p_offering_id), course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
        return { data: null, error: null }
      }
      if (name === 'list_categories') return { data: [], error: null }
      if (name === 'current_access') return { data: [{ role: fixture.role }], error: null }
      if (['list_my_reviews', 'list_manageable_courses', 'list_pending_offering_proposals'].includes(name)) return { data: [], error: null }
      if (name === 'list_my_offering_proposals') return { data: fixture.proposals, error: null }
      if (name === 'create_offering_proposal') {
        const proposal = { id: 'proposal-1', course_id: 'course-1', academic_year: Number(args?.p_academic_year), semester: String(args?.p_semester), section: String(args?.p_section), instructor_name: (args?.p_instructor_name as string) || null, status: 'approved', created_at: '2026-09-24T00:00:00Z' }
        fixture.proposals = [...fixture.proposals, proposal]
        fixture.offerings = [...fixture.offerings, { id: 'offering-2', section: proposal.section, academic_year: proposal.academic_year, semester: proposal.semester, instructor_name: proposal.instructor_name }]
        return { data: proposal.id, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

async function openReview() {
  const wrapper = mount(App)
  await flushPromises()
  await wrapper.get('.course-card').trigger('click')
  await flushPromises()
  return wrapper
}

async function openTimetableAt(instant: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
  const wrapper = mount(App)
  await flushPromises()
  await wrapper.get('nav .btn-light').trigger('click')
  await flushPromises()
  return wrapper
}

async function timetableMenuAction(wrapper: Awaited<ReturnType<typeof openTimetableAt>>, label: string) {
  await wrapper.get('.timetable-mobile-account > button').trigger('click')
  await wrapper.findAll('.timetable-account-menu button').find((button) => button.text() === label)!.trigger('click')
}

describe('review to personal timetable', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })
  beforeEach(() => {
    fixture.offerings = [{ id: 'offering-1', section: '320001', academic_year: 2568, semester: '1', instructor_name: 'อ. อ้อม' }]
    fixture.reviews = [{ id: 'review-1', rating: 5, text: 'สนุกมาก', created_at: '2026-09-23T10:00:00Z', section: '320001', semester: '1', academic_year: 2568, instructor_name: 'อ. อ้อม', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00' }]
    fixture.meetings = [{ day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00' }]
    fixture.timetable = []
    fixture.reported = []
    fixture.proposals = []
    fixture.writeError = null
    fixture.removeError = null
    fixture.loadError = null
    fixture.loadGate = null
    fixture.role = null
    fixture.signOutCalls = 0
    fixture.calls.length = 0
  })

  it('adds the approved offering from the review and offers to show the timetable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T04:00:00.000Z'))
    const wrapper = await openReview()
    const review = wrapper.get('.review-card')
    expect(review.text()).toContain('320001')
    expect(review.text()).toContain('พฤหัสบดี')
    await review.get('button').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'add_my_timetable_offering', args: { p_offering_id: 'offering-1' } })
    expect(wrapper.get('.confirm-message').text()).toContain('ตารางเรียน')
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    const block = wrapper.get('.timetable-course')
    expect(block.text()).toContain('JC232 (320001)')
    expect(block.text()).toContain('อ. อ้อม')
    expect(wrapper.findAll('.timetable-day-button').find((button) => button.attributes('aria-label') === 'เลือกวันพฤหัสบดี')?.attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('adds a review-backed personal selection when there is no approved matching class', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T04:00:00.000Z'))
    fixture.offerings = []
    fixture.reviews[0].created_at = 'invalid'
    const wrapper = await openReview()
    const review = wrapper.get('.review-card')
    expect(review.text()).toContain('สนุกมาก')
    expect(review.text()).not.toContain('Invalid Date')
    expect(review.get('button').text()).toContain('เพิ่มลงตาราง')
    await review.get('button').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'add_my_timetable_review', args: { p_review_id: 'review-1' } })
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    const block = wrapper.get('.timetable-course')
    expect(block.text()).toContain('JC232 (320001)')
    expect(block.text()).toContain('อ. อ้อม')
    expect(wrapper.findAll('.timetable-day-button').find((button) => button.attributes('aria-label') === 'เลือกวันพฤหัสบดี')?.attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('shows a private review schedule as already selected, in the grid', async () => {
    fixture.offerings = []
    fixture.reported = [{ review_id: 'review-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
    const wrapper = await openReview()
    expect(wrapper.get('.review-card').text()).toContain('อยู่ในตารางแล้ว')
    await wrapper.get('nav .btn-light').trigger('click')
    await flushPromises()
    expect(wrapper.get('.timetable-course').text()).toContain('อ. อ้อม')
    expect(wrapper.get('.timetable-course').text()).not.toContain('ข้อมูลจากรีวิว')
    wrapper.unmount()
  })

  it('renders an individual rating as five accessible stars', async () => {
    fixture.reviews = [{ id: 'review-1', rating: 2, text: 'พอใช้', created_at: '2026-09-23T10:00:00Z', section: '320001', semester: '1', academic_year: 2568, instructor_name: 'อ. อ้อม', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00' }]
    const wrapper = await openReview()
    expect(wrapper.get('.review-card').text()).toContain('★★☆☆☆')
    expect(wrapper.get('.review-card').text()).toContain('ให้คะแนน 2 จาก 5 ดาว')
    expect(wrapper.get('.review-card').text()).not.toContain('>')
    wrapper.unmount()
  })

  it('removes a class by clicking its timetable card, only after confirming', async () => {
    fixture.offerings = []
    fixture.reported = [{ review_id: 'review-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
    const wrapper = await openReview()
    await wrapper.get('nav .btn-light').trigger('click')
    await flushPromises()
    await wrapper.get('.timetable-course').trigger('click')
    await flushPromises()
    expect(wrapper.get('.confirm-message').text()).toContain('JC232')
    await wrapper.get('.confirm-cancel').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'remove_my_timetable_review')).toBe(false)
    expect(wrapper.find('.timetable-course').exists()).toBe(true)
    await wrapper.get('.timetable-course').trigger('click')
    await flushPromises()
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'remove_my_timetable_review', args: { p_review_id: 'review-1' } })
    expect(wrapper.find('.timetable-course').exists()).toBe(false)
    wrapper.unmount()
  })

  it('initializes to the Bangkok weekday and exposes a highlight-only Monday-to-Sunday selector', async () => {
    fixture.timetable = [{ offering_id: 'monday', course_code: 'JC100', course_name: 'Monday class', section: '1', day_of_week: 1, starts_at: '09:00:00', ends_at: '11:00:00', instructor_name: null }]
    const wrapper = await openTimetableAt('2026-09-20T17:30:00.000Z') // Sunday UTC, Monday in Bangkok.

    const days = wrapper.findAll('.timetable-day-button')
    expect(days).toHaveLength(7)
    expect(days.map((button) => button.text())).toEqual(['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'])
    expect(days.map((button) => button.attributes('aria-label'))).toEqual(['เลือกวันจันทร์', 'เลือกวันอังคาร', 'เลือกวันพุธ', 'เลือกวันพฤหัสบดี', 'เลือกวันศุกร์', 'เลือกวันเสาร์', 'เลือกวันอาทิตย์'])
    expect(days.map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false'])
    expect(wrapper.get('.timetable-mobile-header').text()).not.toContain('วันนี้')
    expect(wrapper.get('.timetable-mobile-header').text()).not.toContain('เลือกวิชาเรียน')
    expect(wrapper.find('.timetable-day-heading').exists()).toBe(false)
    expect(wrapper.find('.timetable-day-course').text()).toContain('JC100 · กลุ่ม 1')
    wrapper.unmount()
  })

  it('maps Sunday in Bangkok to day seven, and changing days only filters local entries', async () => {
    fixture.timetable = [
      { offering_id: 'sunday', course_code: 'JC700', course_name: 'Sunday class', section: '7', day_of_week: 7, starts_at: '10:00:00', ends_at: '11:00:00', instructor_name: null },
      { offering_id: 'monday', course_code: 'JC100', course_name: 'Monday class', section: '1', day_of_week: 1, starts_at: '09:00:00', ends_at: '10:00:00', instructor_name: null },
    ]
    const wrapper = await openTimetableAt('2026-09-27T04:00:00.000Z')
    const rpcCalls = fixture.calls.filter(({ name }) => name === 'list_my_timetable' || name === 'list_my_reported_timetable')
    expect(wrapper.findAll('.timetable-day-button')[6].attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.timetable-day-course').map((course) => course.text())).toEqual([expect.stringContaining('JC700 · กลุ่ม 7')])

    await wrapper.findAll('.timetable-day-button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.timetable-day-button').map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false'])
    expect(wrapper.findAll('.timetable-day-course').map((course) => course.text())).toEqual([expect.stringContaining('JC100 · กลุ่ม 1')])
    expect(fixture.calls.filter(({ name }) => name === 'list_my_timetable' || name === 'list_my_reported_timetable')).toEqual(rpcCalls)
    wrapper.unmount()
  })

  it('sorts the selected fallback list by start, end, then course code', async () => {
    fixture.timetable = [
      { offering_id: 'late', course_code: 'JC300', course_name: 'Late class', section: '3', day_of_week: 4, starts_at: '22:00:00', ends_at: '23:30:00', instructor_name: 'อ. บี' },
      { offering_id: 'monday', course_code: 'JC100', course_name: 'Monday class', section: '1', day_of_week: 1, starts_at: '09:00:00', ends_at: '11:00:00', instructor_name: null },
      { offering_id: 'later-tie', course_code: 'JC210', course_name: 'Tie later end', section: '2', day_of_week: 4, starts_at: '09:00:00', ends_at: '12:00:00', instructor_name: 'อ. เอ' },
      { offering_id: 'early', course_code: 'JC200', course_name: 'Early class', section: '2', day_of_week: 4, starts_at: '05:30:00', ends_at: '07:00:00', instructor_name: 'อ. เอ' },
      { offering_id: 'earlier-tie', course_code: 'JC201', course_name: 'Tie earlier end', section: '2', day_of_week: 4, starts_at: '09:00:00', ends_at: '10:00:00', instructor_name: 'อ. เอ' },
      { offering_id: 'early', course_code: 'JC200', course_name: 'Second meeting', section: '2', day_of_week: 4, starts_at: '15:00:00', ends_at: '16:00:00', instructor_name: 'อ. เอ' },
    ]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    const courses = wrapper.findAll('.timetable-day-course')
    expect(courses.map((course) => course.text())).toEqual([
      expect.stringContaining('05:30–07:00'),
      expect.stringContaining('09:00–10:00'),
      expect.stringContaining('09:00–12:00'),
      expect.stringContaining('15:00–16:00'),
      expect.stringContaining('22:00–23:30'),
    ])
    expect(courses.map((course) => course.text()).join(' ')).toContain('อ. บี')
    expect(courses.map((course) => course.text()).join(' ')).toContain('Tie earlier end')
    expect(courses.map((course) => course.text()).join(' ')).not.toContain('Monday class')
    expect(courses).toHaveLength(5)
    wrapper.unmount()
  })

  it('extends the timeline for early and late meetings of one offering and retains 30-minute details', async () => {
    fixture.timetable = [
      { offering_id: 'shared', course_code: 'JC200', course_name: 'การสื่อสารและการเล่าเรื่องด้วยภาพสำหรับสื่อดิจิทัล', section: '2', day_of_week: 4, starts_at: '22:00:00', ends_at: '23:30:00', instructor_name: null },
      { offering_id: 'shared', course_code: 'JC200', course_name: 'การสื่อสารและการเล่าเรื่องด้วยภาพสำหรับสื่อดิจิทัล', section: '2', day_of_week: 4, starts_at: '05:30:00', ends_at: '06:00:00', instructor_name: 'อ. เอ' },
      { offering_id: 'adjacent', course_code: 'JC201', course_name: 'ถ่ายภาพ', section: '3', day_of_week: 4, starts_at: '06:00:00', ends_at: '07:00:00', instructor_name: null },
    ]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(wrapper.find('.timetable-day-list').exists()).toBe(false)
    const hours = wrapper.findAll('.timetable-day-hour')
    expect(hours[0].text()).toBe('05:00')
    expect(hours.at(-1)!.text()).toBe('24:00')
    const courses = wrapper.findAll('.timetable-day-course')
    expect(courses.map((course) => course.get('.timetable-day-course-time').text())).toEqual(['05:30–06:00', '06:00–07:00', '22:00–23:30'])
    expect(courses[0].find('.timetable-day-course-name').exists()).toBe(false)
    expect(courses[0].attributes('aria-label')).toBe('JC200 กลุ่ม 2 การสื่อสารและการเล่าเรื่องด้วยภาพสำหรับสื่อดิจิทัล เวลา 05:30–06:00 อ. เอ ลบออกจากตารางเรียน')
    expect(courses[0].attributes('style')).toContain('height: calc(var(--timetable-hour-height) * 0.5 - 8px)')
    expect(courses[1].attributes('style')).toContain('top: calc(var(--timetable-hour-height) * 1 + 4px)')
    expect(courses[2].find('.timetable-day-course-instructor').exists()).toBe(false)
    // Re-render and source-level removal must retain both meetings until confirmed.
    await wrapper.get('[aria-label="เลือกวันจันทร์"]').trigger('click')
    await wrapper.get('[aria-label="เลือกวันพฤหัสบดี"]').trigger('click')
    expect(wrapper.findAll('.timetable-day-course')).toHaveLength(3)
    await wrapper.findAll('.timetable-day-course')[0].trigger('click')
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.timetable-day-course')).toHaveLength(1)
    expect(wrapper.get('.timetable-day-course').text()).toContain('JC201')
    wrapper.unmount()
  })

  it.each(['success', 'failure'])('shows loading then the correct initial %s state', async (outcome) => {
    let finishLoad!: () => void
    fixture.loadGate = new Promise<void>((resolve) => { finishLoad = resolve })
    fixture.loadError = outcome === 'failure' ? 'โหลดตารางไม่สำเร็จ' : null
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(wrapper.get('.timetable-day-summary').text()).toContain('กำลังโหลดตารางเรียน…')
    expect(wrapper.find('.timetable-empty-mobile').exists()).toBe(false)
    finishLoad()
    await flushPromises()
    if (outcome === 'failure') {
      expect(wrapper.get('.timetable-error').text()).toBe('โหลดตารางไม่สำเร็จ')
      expect(wrapper.get('.timetable-day-summary').text()).toContain('ไม่สามารถโหลดตารางเรียนได้')
      expect(wrapper.text()).not.toContain('ตารางเรียนยังว่างเปล่า')
      expect(wrapper.find('.timetable-empty-mobile').exists()).toBe(false)
      fixture.loadError = null
      await wrapper.get('[aria-label="กลับหน้ารายวิชา"]').trigger('click')
      await wrapper.get('nav .btn-light').trigger('click')
      await flushPromises()
      expect(wrapper.find('.timetable-error').exists()).toBe(false)
    }
    expect(wrapper.get('.timetable-day-summary').text()).toContain('ตารางเรียนยังว่างเปล่า')
    wrapper.unmount()
  })

  it('preserves the browsed day on reload and clear, then resets to Bangkok today on reopening', async () => {
    fixture.timetable = [
      { offering_id: 'first', course_code: 'JC100', course_name: 'วิชาแรก', section: '1', day_of_week: 1, starts_at: '09:00:00', ends_at: '10:00:00', instructor_name: null },
      { offering_id: 'second', course_code: 'JC200', course_name: 'วิชาที่สอง', section: '2', day_of_week: 1, starts_at: '11:00:00', ends_at: '12:00:00', instructor_name: null },
    ]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await wrapper.get('[aria-label="เลือกวันจันทร์"]').trigger('click')
    await wrapper.findAll('.timetable-day-course')[0].trigger('click')
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="เลือกวันจันทร์"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.timetable-day-course')).toHaveLength(1)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await timetableMenuAction(wrapper, 'ล้างตาราง')
    expect(fixture.calls.some(({ name }) => name === 'clear_my_timetable')).toBe(false)
    confirm.mockReturnValue(true)
    await timetableMenuAction(wrapper, 'ล้างตาราง')
    await flushPromises()
    expect(fixture.calls.filter(({ name }) => name === 'clear_my_timetable')).toHaveLength(1)
    expect(wrapper.get('[aria-label="เลือกวันจันทร์"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.timetable-empty-mobile').text()).toContain('ตารางเรียนยังว่างเปล่า')
    vi.setSystemTime(new Date('2026-09-26T18:00:00.000Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(wrapper.get('[aria-label="เลือกวันจันทร์"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="กลับหน้ารายวิชา"]').trigger('click')
    expect(wrapper.find('.course-card').exists()).toBe(true)
    await wrapper.get('nav .btn-light').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="เลือกวันอาทิตย์"]').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('keeps Contact, My Reviews, Back, Escape dismissal and Sign Out available in the compact account menu', async () => {
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await wrapper.get('.timetable-mobile-account > button').trigger('click')
    expect(wrapper.get('.timetable-account-menu').text()).not.toContain('แดชบอร์ดผู้ดูแล')
    await wrapper.get('.timetable-account-menu').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.timetable-account-menu').exists()).toBe(false)
    expect(wrapper.get('.timetable-mobile-account > button').attributes('aria-expanded')).toBe('false')
    await timetableMenuAction(wrapper, 'แจ้งปัญหา/ติดต่อ')
    expect(wrapper.find('.contact-panel').exists()).toBe(true)
    await wrapper.get('.contact-panel .btn-close').trigger('click')
    await timetableMenuAction(wrapper, 'รีวิวของฉัน')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'list_my_reviews')).toBe(true)
    expect(wrapper.find('.timetable-mobile-header').exists()).toBe(false)
    await wrapper.get('nav .btn-light').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="กลับหน้ารายวิชา"]').trigger('click')
    expect(wrapper.find('.course-card').exists()).toBe(true)
    await wrapper.get('nav .btn-light').trigger('click')
    await flushPromises()
    await timetableMenuAction(wrapper, 'ออกจากระบบ')
    await flushPromises()
    expect(fixture.signOutCalls).toBe(1)
    expect(wrapper.text()).toContain('เข้าสู่ระบบด้วย Google')
    wrapper.unmount()
  })

  it.each(['owner', 'administrator'] as const)('keeps role-appropriate admin navigation available for %s', async (role) => {
    fixture.role = role
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await timetableMenuAction(wrapper, 'แดชบอร์ดผู้ดูแล')
    await flushPromises()
    expect(wrapper.find('.admin-dashboard').exists()).toBe(true)
    expect(wrapper.classes()).not.toContain('mobile-timetable-screen')
    expect(wrapper.find('.mobile-navigation-row').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('silently migrates a saved timetable before opening the timetable screen', async () => {
    const legacy = JSON.stringify([{ code: 'JC232', name: 'เทคนิคการถ่ายทำ', sec: '320001', teacher: 'อ. อ้อม', day: 'พฤหัสบดี', start: '09:30', end: '12:30' }])
    window.localStorage.setItem('my_tu_schedule_student@example.com', legacy)
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(fixture.calls).toContainEqual(expect.objectContaining({ name: 'migrate_legacy_timetable_entry' }))
    expect(wrapper.find('.legacy-import').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('เดิม')
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(false)
    expect(window.localStorage.getItem('my_tu_schedule_student@example.com')).toBe(legacy)
    await wrapper.get('[aria-label="เลือกวันพฤหัสบดี"]').trigger('click')
    expect(wrapper.get('.timetable-day-course').text()).toContain('09:30–12:30')
    wrapper.unmount()
  })

  it('uses a chronological list for a sub-30-minute class and for overlapping intervals', async () => {
    fixture.timetable = [
      { offering_id: 'short', course_code: 'JC111', course_name: 'Short class full detail', section: '1', day_of_week: 4, starts_at: '09:00:00', ends_at: '09:20:00', instructor_name: 'อ. สั้น' },
      { offering_id: 'normal', course_code: 'JC112', course_name: 'Following class', section: '2', day_of_week: 4, starts_at: '10:00:00', ends_at: '11:00:00', instructor_name: null },
    ]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(wrapper.find('.timetable-day-list').exists()).toBe(true)
    expect(wrapper.findAll('.timetable-day-course').map((course) => course.text())).toEqual([
      expect.stringContaining('09:00–09:20'),
      expect.stringContaining('10:00–11:00'),
    ])
    expect(wrapper.findAll('.timetable-day-course')[0].text()).toContain('Short class full detail')
    wrapper.unmount()

    fixture.timetable = [
      { offering_id: 'overlap-a', course_code: 'JC201', course_name: 'First overlap', section: '1', day_of_week: 4, starts_at: '09:00:00', ends_at: '10:30:00', instructor_name: null },
      { offering_id: 'overlap-b', course_code: 'JC202', course_name: 'Second overlap', section: '2', day_of_week: 4, starts_at: '10:00:00', ends_at: '11:00:00', instructor_name: null },
    ]
    const overlapping = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(overlapping.find('.timetable-day-list').exists()).toBe(true)
    expect(overlapping.findAll('.timetable-day-course').map((course) => course.text())).toEqual([
      expect.stringContaining('First overlap'),
      expect.stringContaining('Second overlap'),
    ])
    overlapping.unmount()
  })

  it('keeps adjacent intervals on the proportional timeline and distinguishes an empty day from an empty timetable', async () => {
    fixture.timetable = [
      { offering_id: 'adjacent-a', course_code: 'JC201', course_name: 'First adjacent', section: '1', day_of_week: 4, starts_at: '09:00:00', ends_at: '10:00:00', instructor_name: null },
      { offering_id: 'adjacent-b', course_code: 'JC202', course_name: 'Second adjacent', section: '2', day_of_week: 4, starts_at: '10:00:00', ends_at: '11:00:00', instructor_name: null },
    ]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(wrapper.find('.timetable-day-list').exists()).toBe(false)
    expect(wrapper.findAll('.timetable-day-course')).toHaveLength(2)
    await wrapper.get('.timetable-day-button[aria-label="เลือกวันจันทร์"]').trigger('click')
    expect(wrapper.get('.timetable-empty-day').text()).toBe('ไม่มีเรียนวันจันทร์')
    expect(wrapper.findAll('.timetable-day-button')).toHaveLength(7)
    wrapper.unmount()

    fixture.timetable = []
    const empty = await openTimetableAt('2026-09-24T04:00:00.000Z')
    expect(empty.get('.timetable-empty-mobile').text()).toContain('ตารางเรียนยังว่างเปล่า')
    expect(empty.findAll('.timetable-day-button')).toHaveLength(7)
    expect(empty.get('.timetable-mobile-header').text()).not.toContain('เลือกวิชาเรียน')
    empty.unmount()
  })

  it('removes a review-reported class only after confirmation and retains it after cancel', async () => {
    fixture.offerings = []
    fixture.reported = [{ review_id: 'review-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await wrapper.get('.timetable-day-course').trigger('click')
    await flushPromises()
    expect(wrapper.get('.confirm-message').text()).toContain('JC232')
    await wrapper.get('.confirm-cancel').trigger('click')
    expect(fixture.calls.some(({ name }) => name === 'remove_my_timetable_review')).toBe(false)
    expect(wrapper.find('.timetable-day-course').exists()).toBe(true)
    await wrapper.get('.timetable-day-course').trigger('click')
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'remove_my_timetable_review', args: { p_review_id: 'review-1' } })
    expect(wrapper.find('.timetable-day-course').exists()).toBe(false)
    wrapper.unmount()
  })

  it('cancels and confirms official removal, and reports failed removal without dropping the class', async () => {
    fixture.timetable = [{ offering_id: 'offering-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
    const wrapper = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await wrapper.get('.timetable-day-course').trigger('click')
    await flushPromises()
    await wrapper.get('.confirm-cancel').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'remove_my_timetable_offering')).toBe(false)
    expect(wrapper.find('.timetable-day-course').exists()).toBe(true)

    await wrapper.get('.timetable-day-course').trigger('click')
    await flushPromises()
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'remove_my_timetable_offering', args: { p_offering_id: 'offering-1' } })
    expect(wrapper.find('.timetable-day-course').exists()).toBe(false)
    wrapper.unmount()

    fixture.timetable = [{ offering_id: 'offering-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: 'อ. อ้อม' }]
    fixture.removeError = 'remove failed'
    const failed = await openTimetableAt('2026-09-24T04:00:00.000Z')
    await failed.get('.timetable-day-course').trigger('click')
    await flushPromises()
    await failed.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(failed.get('[role="alert"]').text()).toContain('remove failed')
    expect(failed.find('.timetable-day-course').exists()).toBe(true)
    expect(fixture.timetable).toHaveLength(1)
    failed.unmount()
  })

  it('shows a private selection save failure without claiming success', async () => {
    fixture.offerings = []
    fixture.writeError = 'save failed'
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.course-review-body [role="alert"]').text()).toContain('save failed')
    expect(fixture.reported).toHaveLength(0)
    wrapper.unmount()
  })

  it('shows the approved meeting when the review reports a different time', async () => {
    fixture.meetings = [{ day_of_week: 2, starts_at: '13:00:00', ends_at: '15:00:00' }]
    const wrapper = await openReview()
    const review = wrapper.get('.review-card')
    expect(review.text()).toContain('อังคาร 13:00–15:00')
    expect(review.text()).toContain('วันพฤหัสบดี')
    expect(review.text()).toContain('09:30 - 12:30 น.')
    wrapper.unmount()
  })

  it('offers a private review schedule when the approved class has no meeting', async () => {
    fixture.meetings = []
    const wrapper = await openReview()
    expect(wrapper.get('.review-card').text()).not.toContain('ข้อมูลกลุ่มเรียนที่อนุมัติ')
    expect(wrapper.find('.review-card button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('offers only a private review schedule when multiple approved classes match a review', async () => {
    fixture.offerings.push({ id: 'offering-2', section: '320001', academic_year: 2568, semester: '1', instructor_name: 'อ. อ้อม' })
    const wrapper = await openReview()
    expect(wrapper.get('.review-card').text()).not.toContain('ข้อมูลกลุ่มเรียนที่อนุมัติ')
    expect(wrapper.find('.review-card button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the selected state instead of adding the same class twice', async () => {
    fixture.timetable = [{ offering_id: 'offering-1', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320001', day_of_week: 4, starts_at: '09:30:00', ends_at: '12:30:00', instructor_name: null }]
    const wrapper = await openReview()
    expect(wrapper.get('.review-card').text()).toContain('อยู่ในตารางแล้ว')
    expect(wrapper.find('.review-card button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not add a class if approval changes after the dialog opens', async () => {
    const wrapper = await openReview()
    fixture.offerings = []
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.course-review-body [role="alert"]').text()).toContain('ไม่ได้เปิดให้เพิ่มลงตาราง')
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(false)
    wrapper.unmount()
  })

  it('uses the private reported schedule if the approved period changes before selection', async () => {
    const wrapper = await openReview()
    fixture.offerings[0].semester = '2'
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(false)
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_review')).toBe(true)
    wrapper.unmount()
  })

  it('shows a changed official meeting before allowing a review-linked selection', async () => {
    const wrapper = await openReview()
    fixture.meetings = [{ day_of_week: 2, starts_at: '13:00:00', ends_at: '15:00:00' }]
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(false)
    expect(wrapper.get('.review-card').text()).toContain('อังคาร 13:00–15:00')
    expect(wrapper.get('.course-review-body [role="alert"]').text()).toContain('เวลาเรียนทางการเปลี่ยนไป')
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(true)
    wrapper.unmount()
  })

  it('asks before replacing an existing section and leaves it alone when canceled', async () => {
    fixture.timetable = [{ offering_id: 'old-offering', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320002', day_of_week: 4, starts_at: '13:00:00', ends_at: '15:00:00', instructor_name: null }]
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.confirm-message').text()).toContain('เปลี่ยนเป็นกลุ่ม 320001')
    await wrapper.get('.confirm-cancel').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'replace_my_timetable_offering')).toBe(false)
    expect(fixture.timetable[0].section).toBe('320002')
    wrapper.unmount()
  })

  it('replaces the selected section after confirmation', async () => {
    fixture.timetable = [{ offering_id: 'old-offering', course_code: 'JC232', course_name: 'เทคนิคการถ่ายทำ', section: '320002', day_of_week: 4, starts_at: '13:00:00', ends_at: '15:00:00', instructor_name: null }]
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    await wrapper.get('.confirm-accept').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'replace_my_timetable_offering', args: { p_offering_id: 'offering-1' } })
    expect(fixture.timetable.map((entry) => entry.section)).toEqual(['320001'])
    wrapper.unmount()
  })

  it('warns about another course that overlaps and saves only after confirmation', async () => {
    fixture.timetable = [{ offering_id: 'other-offering', course_code: 'AP164', course_name: 'เศรษฐศาสตร์', section: '1', day_of_week: 4, starts_at: '10:00:00', ends_at: '11:00:00', instructor_name: null }]
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.confirm-message').text()).toContain('AP164')
    await wrapper.get('.confirm-cancel').trigger('click')
    await flushPromises()
    expect(fixture.calls.some(({ name }) => name === 'add_my_timetable_offering')).toBe(false)
    wrapper.unmount()
  })

  it('keeps the dialog open after saving when the user declines the timetable view', async () => {
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    await wrapper.get('.confirm-cancel').trigger('click')
    await flushPromises()
    expect(fixture.timetable[0].offering_id).toBe('offering-1')
    expect(wrapper.get('.review-card').text()).toContain('อยู่ในตารางแล้ว')
    expect(wrapper.find('.course-review-modal').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows a save error in the dialog without claiming success', async () => {
    fixture.writeError = 'save failed'
    const wrapper = await openReview()
    await wrapper.get('.review-card button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.course-review-body [role="alert"]').text()).toContain('save failed')
    expect(fixture.timetable).toHaveLength(0)
    expect(wrapper.find('.course-review-modal').exists()).toBe(true)
    wrapper.unmount()
  })
})
