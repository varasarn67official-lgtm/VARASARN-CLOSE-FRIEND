import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  courseGate: null as Promise<void> | null,
  courseSaveGate: null as Promise<void> | null,
  courseFailures: 0,
  categoryFailures: 0,
  role: null as 'owner' | 'administrator' | null,
  categories: [{ id: 'cat-1', name: 'วิชาศึกษาทั่วไป' }],
  catalog: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาศึกษาทั่วไป' }],
  managedCourses: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_id: 'cat-1', category_name: 'วิชาศึกษาทั่วไป', status: 'approved' }],
  periods: [] as Array<{ id: string; academic_year: number; semester: string }>,
  proposals: [{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }],
  moderationReviews: [{ id: 'review-1', rating: 5, text: 'ดีมาก', author_active: true, moderation_state: 'visible' as 'visible' | 'hidden' | 'removed', created_at: '2026-01-01', course_code: undefined as string | undefined, course_name: undefined as string | undefined }],
  moderationAudit: [] as Array<{ id: string; prior_state: string; new_state: string; reason: string; actor_name: string; created_at: string }>,
  members: [{ user_id: 'owner-1', name: 'Owner', email: 'owner@example.com', role: 'owner' as const, granted_at: '2026-01-01' }],
  verifiedAccounts: [{ id: 'user-2', name: 'Bee', email: 'bee@example.com' }],
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' } } }), signOut: async () => undefined },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fixture.calls.push({ name, args })
      if (name === 'current_access') return { data: [{ role: fixture.role }], error: null }
      if (name === 'list_approved_catalog') return { data: fixture.catalog, error: null }
      if (name === 'list_categories') {
        if (fixture.categoryFailures > 0) { fixture.categoryFailures--; return { data: null, error: { message: 'failed' } } }
        return { data: fixture.categories, error: null }
      }
      if (name === 'update_category' || name === 'create_category') return { data: null, error: null }
      if (name === 'list_manageable_courses') {
        if (fixture.courseGate) await fixture.courseGate
        if (fixture.courseFailures > 0) { fixture.courseFailures--; return { data: null, error: { message: 'network failed' } } }
        return { data: fixture.managedCourses, error: null }
      }
      if (name === 'list_academic_periods') return { data: fixture.periods, error: null }
      if (name === 'list_pending_offering_proposals') return { data: fixture.proposals, error: null }
      if (name === 'list_moderation_reviews') {
        const state = (args as { p_state?: string | null } | undefined)?.p_state
        return { data: state ? fixture.moderationReviews.filter((review) => review.moderation_state === state) : fixture.moderationReviews, error: null }
      }
      if (name === 'list_review_moderation_audit') return { data: fixture.moderationAudit, error: null }
      if (name === 'list_role_assignments') return { data: fixture.members, error: null }
      if (name === 'list_verified_accounts') return { data: fixture.verifiedAccounts, error: null }
      if (name === 'create_course') {
        if (fixture.courseSaveGate) await fixture.courseSaveGate
        const { p_code: code, p_name_th: nameTh, p_category_id: categoryId } = args as { p_code?: string; p_name_th?: string; p_category_id?: string }
        if (fixture.catalog.some((course) => course.code === code)) return { data: null, error: { message: `รหัสวิชา ${code} มีอยู่แล้ว` } }
        const category = fixture.categories.find((item) => item.id === categoryId)
        fixture.catalog = [...fixture.catalog, { id: `course-${code}`, code: String(code), name_th: String(nameTh), category_name: category?.name ?? '' }]
        fixture.managedCourses = [...fixture.managedCourses, { id: `course-${code}`, code: String(code), name_th: String(nameTh), category_id: String(categoryId), category_name: category?.name ?? '', status: 'approved' }]
        return { data: null, error: null }
      }
      if (name === 'archive_course') {
        const { p_course_id: courseId } = args as { p_course_id?: string }
        fixture.managedCourses = fixture.managedCourses.map((course) => course.id === courseId ? { ...course, status: 'archived' } : course)
        return { data: null, error: null }
      }
      if (name === 'resolve_offering_proposal') {
        const { p_proposal_id: proposalId } = args as { p_proposal_id?: string; p_approve?: boolean }
        fixture.proposals = fixture.proposals.filter((proposal) => proposal.id !== proposalId)
        return { data: null, error: null }
      }
      if (name === 'moderate_review') {
        const { p_review_id: reviewId, p_state: state } = args as { p_review_id?: string; p_state?: 'visible' | 'hidden' | 'removed' }
        fixture.moderationReviews = fixture.moderationReviews.map((review) => review.id === reviewId ? { ...review, moderation_state: state ?? review.moderation_state } : review)
        return { data: null, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

async function openDashboard(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('.account-menu .user-dropdown-btn').trigger('click')
  const items = wrapper.findAll('.account-menu .dropdown-item')
  const dashboardItem = items.find((item) => item.text().includes('แดชบอร์ดผู้ดูแล'))
  await dashboardItem!.trigger('click')
  await flushPromises()
}

function navItem(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('.admin-nav-item').find((item) => item.text().includes(label))
}

describe('admin dashboard', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    fixture.courseGate = null
    fixture.courseSaveGate = null
    fixture.courseFailures = 0
    fixture.categoryFailures = 0
    fixture.categories = [{ id: 'cat-1', name: 'วิชาศึกษาทั่วไป' }]
    fixture.role = null
    fixture.calls.length = 0
    fixture.catalog = [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาศึกษาทั่วไป' }]
    fixture.managedCourses = [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_id: 'cat-1', category_name: 'วิชาศึกษาทั่วไป', status: 'approved' }]
    fixture.proposals = [{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }]
    fixture.moderationReviews = [{ id: 'review-1', rating: 5, text: 'ดีมาก', author_active: true, moderation_state: 'visible' as const, created_at: '2026-01-01', course_code: undefined, course_name: undefined }]
    fixture.moderationAudit = []
  })

  it('lands on รายวิชา with courses listed, no role/moderation RPCs fired yet (lazy loading)', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)

    expect(wrapper.find('.mobile-account-menu').exists()).toBe(true)
    expect(navItem(wrapper, 'รายวิชา')!.attributes('aria-current')).toBe('page')
    expect(wrapper.get('.admin-content').text()).toContain('JC100')
    expect(fixture.calls.some((call) => call.name === 'list_role_assignments')).toBe(false)
    expect(fixture.calls.some((call) => call.name === 'list_verified_accounts')).toBe(false)
    expect(fixture.calls.some((call) => call.name === 'list_moderation_reviews')).toBe(false)
    wrapper.unmount()
  })

  it.each(['administrator', 'owner'] as const)('shows only three tabs for %s without fetching hidden sections', async (role) => {
    fixture.role = role
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    expect(wrapper.findAll('.admin-nav-item').map((item) => item.text())).toEqual(['รายวิชา', 'หมวดหมู่', 'รีวิว'])
    expect(wrapper.find('.admin-nav-badge').exists()).toBe(false)
    for (const name of ['list_pending_offering_proposals', 'list_academic_periods', 'list_role_assignments', 'list_verified_accounts']) {
      expect(fixture.calls.some((call) => call.name === name)).toBe(false)
    }
    wrapper.unmount()
  })

  it('creates a course with the normalised code, toasts, and refetches the public catalog', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    fixture.calls.length = 0

    await wrapper.get('.admin-content button.btn-purple').trigger('click')
    await flushPromises()
    await wrapper.get('#admin-course-code').setValue(' jc200 ')
    await wrapper.get('#admin-course-name').setValue('วิชาใหม่')
    await wrapper.get('.course-modal-body button.btn-purple').trigger('click')
    await flushPromises()

    expect(fixture.calls).toContainEqual({ name: 'create_course', args: { p_code: 'JC200', p_name_th: 'วิชาใหม่', p_category_id: 'cat-1' } })
    expect(wrapper.get('.toast-banner').text()).toContain('เพิ่มรายวิชาสำเร็จ')
    expect(fixture.calls.some((call) => call.name === 'list_approved_catalog')).toBe(true)
    wrapper.unmount()
  })

  it('keeps keyboard focus in the course dialog and returns to its trigger on Escape', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    await openDashboard(wrapper)
    const add = wrapper.get('.admin-course-add')
    ;(add.element as HTMLButtonElement).focus()
    await add.trigger('click')
    expect(document.activeElement).toBe(wrapper.get('#admin-course-modal-title').element)
    const save = wrapper.get('.course-modal-body button.btn-purple')
    ;(save.element as HTMLButtonElement).focus()
    await save.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(wrapper.get('[role="dialog"] .btn-close').element)
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(add.element)
    wrapper.unmount()
  })

  it('prevents duplicate course writes and keeps the draft open while saving', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await wrapper.get('.admin-course-add').trigger('click')
    await wrapper.get('#admin-course-code').setValue('JC222')
    await wrapper.get('#admin-course-name').setValue('การรายงานข่าว')
    let finishSave!: () => void
    fixture.courseSaveGate = new Promise<void>((resolve) => { finishSave = resolve })
    const save = wrapper.get('.course-modal-body button.btn-purple')
    await save.trigger('click')
    await save.trigger('click')
    expect(fixture.calls.filter((call) => call.name === 'create_course')).toHaveLength(1)
    expect(save.attributes('disabled')).toBeDefined()
    expect(wrapper.get('#admin-course-code').attributes('disabled')).toBeDefined()
    await wrapper.get('.course-modal-body .btn-outline-secondary').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    finishSave()
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('.toast-banner').text()).toContain('เพิ่มรายวิชาสำเร็จ')
    wrapper.unmount()
  })

  it('confirms before archiving a course and only archives when confirmed', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    fixture.calls.length = 0

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('.admin-content .btn-outline-danger').trigger('click')
    await flushPromises()
    expect(fixture.calls.some((call) => call.name === 'archive_course')).toBe(false)

    confirmSpy.mockReturnValue(true)
    await wrapper.get('.admin-content .btn-outline-danger').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'archive_course', args: { p_course_id: 'course-1' } })
    confirmSpy.mockRestore()
    wrapper.unmount()
  })

  it('shows review course/date and requires choosing an action then a reason, with one panel at a time', async () => {
    fixture.role = 'administrator'
    fixture.moderationReviews = [
      { id: 'review-1', rating: 5, text: 'ดีมาก', author_active: true, moderation_state: 'visible', created_at: '2026-09-25T05:00:00Z', course_code: 'JC100', course_name: 'วารสารศาสตร์' },
      { id: 'review-2', rating: 2, text: 'อีกรีวิว', author_active: true, moderation_state: 'visible', created_at: '2026-09-25T05:00:00Z', course_code: 'TU100', course_name: 'สังคม' },
    ]
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'รีวิว')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admin-content').text()).toContain('★★★★★')
    expect(wrapper.get('.admin-content').text()).toContain('ให้คะแนน 5 จาก 5 ดาว')
    expect(wrapper.get('.admin-content').text()).toContain('JC100')
    expect(wrapper.get('.admin-content').text()).toContain('วารสารศาสตร์')
    expect(wrapper.get('.admin-content').text()).toContain('25 ก.ย. 2569')
    expect(wrapper.find('textarea').exists()).toBe(false)
    const rows = wrapper.findAll('.admin-review-row')
    await rows[0]!.findAll('button').find((b) => b.text() === 'ซ่อน')!.trigger('click')
    expect(wrapper.get('.admin-reason-panel button.btn-purple').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('   ')
    expect(wrapper.get('.admin-reason-panel button.btn-purple').attributes('disabled')).toBeDefined()
    await rows[1]!.findAll('button').find((b) => b.text() === 'ซ่อน')!.trigger('click')
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    expect(wrapper.find('[aria-label="เหตุผลสำหรับรีวิว review-1"]').exists()).toBe(false)
    await wrapper.get('textarea').setValue('ไม่เหมาะสม')
    expect(wrapper.get('.admin-reason-panel button.btn-purple').attributes('disabled')).toBeUndefined()
    await wrapper.get('.admin-reason-panel').trigger('submit')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'moderate_review', args: { p_review_id: 'review-2', p_state: 'hidden', p_reason: 'ไม่เหมาะสม' } })
    expect(wrapper.get('.toast-banner').text()).toContain('เปลี่ยนสถานะรีวิวสำเร็จ')
    expect(wrapper.find('textarea').exists()).toBe(false)
    await wrapper.findAll('.admin-review-chips button').find((b) => b.text() === 'ซ่อน')!.trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'list_moderation_reviews', args: { p_state: 'hidden' } })
    wrapper.unmount()
  })

  it('shows six busy skeleton rows without counts or no-match text until courses arrive', async () => {
    fixture.role = 'administrator'
    let release!: () => void
    fixture.courseGate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    expect(wrapper.get('.admin-course-results').attributes('aria-busy')).toBe('true')
    expect(wrapper.findAll('.admin-skeleton-row')).toHaveLength(6)
    expect(wrapper.get('.admin-content').text()).not.toContain('พบ 0')
    expect(wrapper.get('.admin-content').text()).not.toContain('ไม่พบรายวิชา')
    expect(wrapper.find('.admin-chip-count').exists()).toBe(false)
    release()
    await flushPromises()
    expect(wrapper.get('.admin-course-results').attributes('aria-busy')).toBe('false')
    expect(wrapper.get('.admin-content').text()).toContain('JC100')
    wrapper.unmount()
  })

  it('retries a failed course list while categories still load independently', async () => {
    fixture.role = 'administrator'
    fixture.courseFailures = 1
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    expect(wrapper.get('.admin-content').text()).toContain('โหลดรายวิชาไม่สำเร็จ')
    expect(wrapper.get('.admin-content').text()).not.toContain('ไม่พบรายวิชา')
    expect(wrapper.find('.admin-chip-count').exists()).toBe(false)
    await navItem(wrapper, 'หมวดหมู่')!.trigger('click')
    expect(wrapper.get('.admin-content').text()).toContain('วิชาศึกษาทั่วไป')
    await navItem(wrapper, 'รายวิชา')!.trigger('click')
    await wrapper.findAll('.admin-content button').find((b) => b.text() === 'ลองใหม่')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admin-content').text()).toContain('JC100')
    expect(wrapper.get('.admin-content').text()).not.toContain('โหลดรายวิชาไม่สำเร็จ')
    wrapper.unmount()
  })

  it('matches course codes without case or spaces, counts statuses, and clears each empty filter', async () => {
    fixture.role = 'administrator'
    fixture.managedCourses.push({ id: 'archived', code: 'JC101', name_th: 'เก่า', category_id: 'cat-1', category_name: 'วิชาศึกษาทั่วไป', status: 'archived' })
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await wrapper.get('#admin-course-search').setValue('jc 1')
    const chip = (label: string) => wrapper.findAll('.admin-status-chips button').find((b) => b.text().startsWith(label))!
    expect(chip('ทั้งหมด').text()).toBe('ทั้งหมด2')
    expect(chip('ใช้งานอยู่').text()).toBe('ใช้งานอยู่1')
    expect(chip('อยู่ในคลัง').text()).toBe('อยู่ในคลัง1')
    await chip('อยู่ในคลัง').trigger('click')
    expect(chip('อยู่ในคลัง').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.get('tbody').text()).toContain('JC101')
    expect(wrapper.get('tbody').text()).toContain('อยู่ในคลัง')
    expect(wrapper.find('tbody .btn-outline-danger').exists()).toBe(false)
    expect(wrapper.get('tbody button').attributes('aria-label')).toBe('แก้ไข JC101')
    await wrapper.get('#admin-course-category').setValue('cat-1')
    await wrapper.get('#admin-course-search').setValue('missing')
    expect(chip('ทั้งหมด').text()).toBe('ทั้งหมด0')
    expect(wrapper.get('.admin-empty').text()).toContain('“missing”')
    expect(wrapper.findAll('.admin-empty button').map((b) => b.text())).toEqual(['ล้างคำค้นหา', 'ทุกหมวดหมู่', 'ทุกสถานะ'])
    await wrapper.get('.admin-empty button').trigger('click')
    expect(wrapper.get('tbody').text()).toContain('JC101')
    expect(wrapper.get('tbody').text()).not.toContain('JC100')
    wrapper.unmount()
  })

  it('shows category counts including archived courses, marks zero, saves Enter and cancels Escape', async () => {
    fixture.role = 'administrator'
    fixture.categories.push({ id: 'empty', name: 'หมวดว่าง' })
    fixture.managedCourses.push({ ...fixture.managedCourses[0]!, id: 'archived', status: 'archived' })
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'หมวดหมู่')!.trigger('click')
    expect(wrapper.findAll('tbody tr')[0]!.text()).toContain('2')
    expect(wrapper.findAll('tbody tr')[1]!.text()).toContain('ไม่มีรายวิชา')
    await wrapper.get('tbody button').trigger('click')
    const field = wrapper.get('tbody input')
    expect(document.activeElement).toBe(field.element)
    await field.setValue('ชื่อใหม่')
    await field.trigger('keydown.enter')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'update_category', args: { p_category_id: 'cat-1', p_name: 'ชื่อใหม่' } })
    expect(wrapper.get('.toast-banner').text()).toContain('แก้ไขหมวดหมู่สำเร็จ')
    fixture.calls.length = 0
    await wrapper.get('tbody button').trigger('click')
    await wrapper.get('tbody input').setValue('ยกเลิกชื่อ')
    await wrapper.get('tbody input').trigger('keydown.esc')
    expect(wrapper.find('tbody input').exists()).toBe(false)
    expect(fixture.calls.some((c) => c.name === 'update_category')).toBe(false)
    await wrapper.get('#admin-new-category').setValue('ใหม่')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'create_category', args: { p_name: 'ใหม่' } })
    wrapper.unmount()
  })

  it('retries category loading and never labels unknown course counts as zero', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    fixture.categoryFailures = 1
    fixture.courseFailures = 1
    await openDashboard(wrapper)
    await navItem(wrapper, 'หมวดหมู่')!.trigger('click')
    expect(wrapper.get('.admin-content').text()).toContain('โหลดหมวดหมู่ไม่สำเร็จ')
    expect(wrapper.get('.admin-content').text()).not.toContain('ยังไม่มีหมวดหมู่')
    await wrapper.findAll('.admin-content button').find((b) => b.text() === 'ลองใหม่')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain('วิชาศึกษาทั่วไป')
    wrapper.unmount()

    fixture.courseFailures = 1
    const second = mount(App)
    await flushPromises()
    await openDashboard(second)
    await navItem(second, 'หมวดหมู่')!.trigger('click')
    expect(second.get('tbody').text()).toContain('วิชาศึกษาทั่วไป')
    expect(second.get('tbody').text()).not.toContain('ไม่มีรายวิชา')
    expect(second.get('.admin-content').text()).toContain('โหลดรายวิชาไม่สำเร็จ')
    second.unmount()
  })

  it('searches reviews by course without spaces and keeps pre-migration reviews usable', async () => {
    fixture.role = 'administrator'
    fixture.moderationReviews.push({ ...fixture.moderationReviews[0]!, id: 'review-new', text: 'ใหม่', course_code: 'JC232', course_name: 'สื่อสารมวลชน' })
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'รีวิว')!.trigger('click')
    await flushPromises()
    const oldRow = wrapper.findAll('.admin-review-row')[0]!
    expect(oldRow.find('.admin-review-course').exists()).toBe(false)
    expect(oldRow.text()).not.toContain('undefined')
    await wrapper.get('#admin-review-search').setValue('jc 2')
    expect(wrapper.findAll('.admin-review-row')).toHaveLength(1)
    expect(wrapper.get('.admin-review-row').text()).toContain('ใหม่')
    await wrapper.get('#admin-review-search').setValue('สื่อสาร')
    expect(wrapper.findAll('.admin-review-row')).toHaveLength(1)
    await wrapper.get('#admin-review-search').setValue('')
    await wrapper.get('.admin-history-toggle').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'list_review_moderation_audit', args: { p_review_id: 'review-1' } })
    expect(wrapper.get('.admin-review-row').text()).toContain('ยังไม่เคยมีการเปลี่ยนสถานะ')
    await wrapper.findAll('.admin-review-chips button').find((b) => b.text() === 'นำออก')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admin-empty').text()).toContain('ไม่พบรีวิว')
    await wrapper.get('.admin-empty button').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'list_moderation_reviews', args: { p_state: null } })
    wrapper.unmount()
  })

  it('hides the floating contact control in the dashboard and restores it on return', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.floating-contact-btn').exists()).toBe(true)
    await openDashboard(wrapper)
    expect(wrapper.find('.floating-contact-btn').exists()).toBe(false)
    await wrapper.get('.admin-back-btn').trigger('click')
    expect(wrapper.find('.floating-contact-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows and retries a category failure on Courses while retaining the loaded course rows', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    fixture.categoryFailures = 1
    await openDashboard(wrapper)
    expect(wrapper.get('tbody').text()).toContain('JC100')
    expect(wrapper.get('.admin-content').text()).toContain('โหลดหมวดหมู่ไม่สำเร็จ')
    expect(wrapper.get('#admin-course-category').attributes('disabled')).toBeDefined()
    await wrapper.findAll('.admin-content button').find((b) => b.text() === 'ลองใหม่')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('#admin-course-category').text()).toContain('วิชาศึกษาทั่วไป')
    expect(wrapper.get('#admin-course-category').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.admin-content').text()).not.toContain('โหลดหมวดหมู่ไม่สำเร็จ')
    wrapper.unmount()
  })

  it('keeps a half-typed category name across tab switches', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'หมวดหมู่')!.trigger('click')
    await wrapper.get('#admin-new-category').setValue('หมวดใหม่')
    await navItem(wrapper, 'รายวิชา')!.trigger('click')
    await navItem(wrapper, 'หมวดหมู่')!.trigger('click')
    expect((wrapper.get('#admin-new-category').element as HTMLInputElement).value).toBe('หมวดใหม่')
    wrapper.unmount()
  })
})
