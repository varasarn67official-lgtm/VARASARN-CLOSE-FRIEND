import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  calls: [] as string[],
  legacy: [] as Array<Record<string, unknown>>,
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: fixture.user } }), signOut: async () => undefined },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fixture.calls.push(name)
      if (name === 'list_approved_catalog') return { data: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาแกน' }], error: null }
      if (name === 'list_approved_offerings') return { data: [{ id: 'offering-1', section: '1', academic_year: 2569, semester: '1', instructor_name: 'อาจารย์ใหม่' }], error: null }
      if (name === 'list_approved_offering_meetings') return { data: [{ day_of_week: 1, starts_at: '09:00:00', ends_at: '11:00:00' }], error: null }
      if (name === 'list_my_timetable' || name === 'list_my_reported_timetable' || name === 'list_categories') return { data: [], error: null }
      if (name === 'list_my_legacy_timetable') return { data: fixture.legacy, error: null }
      if (name === 'migrate_legacy_timetable_entry') {
        const row = args?.p_entry as Record<string, string>
        const id = `legacy-${fixture.legacy.length + 1}`
        fixture.legacy.push({ legacy_entry_id: id, course_code: row.code, course_name: row.name, section: row.sec, instructor_name: row.teacher, day_of_week: ['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'].indexOf(row.day) + 1, starts_at: `${row.start}:00`, ends_at: `${row.end}:00` })
        return { data: { outcome: 'added-legacy', legacy_entry_id: id }, error: null }
      }
      if (name === 'current_access') return { data: [{ role: null }], error: null }
      if (name === 'remove_my_legacy_timetable_entry') { fixture.legacy = fixture.legacy.filter((row) => row.legacy_entry_id !== args?.p_legacy_entry_id); return { data: null, error: null } }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

describe('automatic timetable migration after authentication', () => {
  beforeEach(() => { window.localStorage.clear(); fixture.calls.length = 0; fixture.legacy.length = 0; fixture.user = null })

  it('migrates in the background and shows the result in the normal timetable without import UI', async () => {
    fixture.user = { id: 'user-1', email: 'student@example.com', name: 'Student' }
    const raw = JSON.stringify([{ code: 'JC100', name: 'วารสารศาสตร์', sec: '1', teacher: 'อาจารย์เดิม', day: 'จันทร์', start: '09:00', end: '11:00' }])
    window.localStorage.setItem('my_tu_schedule_student@example.com', raw)
    const wrapper = mount(App)
    await flushPromises()
    expect(fixture.calls).toContain('migrate_legacy_timetable_entry')
    expect(wrapper.text()).not.toContain('เดิม')
    expect(wrapper.find('.legacy-import').exists()).toBe(false)
    expect(fixture.calls).not.toContain('add_my_timetable_offering')
    expect(window.localStorage.getItem('my_tu_schedule_student@example.com')).toBe(raw)

    await wrapper.find('.mobile-timetable-btn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('JC100')
    expect(wrapper.find('.legacy-import').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not scan storage or run a migration while signed out', async () => {
    window.localStorage.setItem('my_tu_schedule_student@example.com', 'not-json')
    const keyRead = vi.spyOn(window.localStorage, 'key')
    try {
      const wrapper = mount(App)
      await flushPromises()
      expect(wrapper.text()).toContain('เข้าสู่ระบบด้วย Google')
      expect(keyRead).not.toHaveBeenCalled()
      expect(fixture.calls).not.toContain('migrate_legacy_timetable_entry')
      wrapper.unmount()
    } finally { keyRead.mockRestore() }
  })

  it('leaves the ordinary timetable flow alone when there is no legacy key', async () => {
    fixture.user = { id: 'user-1', email: 'student@example.com', name: 'Student' }
    const wrapper = mount(App)
    await flushPromises()
    expect(fixture.calls).not.toContain('migrate_legacy_timetable_entry')
    expect(wrapper.find('.legacy-import').exists()).toBe(false)
    wrapper.unmount()
  })
})
