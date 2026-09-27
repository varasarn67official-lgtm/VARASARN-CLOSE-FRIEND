import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  role: null as 'owner' | 'administrator' | null,
  categories: [{ id: 'cat-1', name: 'วิชาศึกษาทั่วไป' }],
  catalog: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาศึกษาทั่วไป' }],
  managedCourses: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_id: 'cat-1', category_name: 'วิชาศึกษาทั่วไป', status: 'approved' }],
  periods: [] as Array<{ id: string; academic_year: number; semester: string }>,
  proposals: [{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }],
  moderationReviews: [{ id: 'review-1', rating: 5, text: 'ดีมาก', author_active: true, moderation_state: 'visible' as 'visible' | 'hidden' | 'removed', created_at: '2026-01-01' }],
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
      if (name === 'list_categories') return { data: fixture.categories, error: null }
      if (name === 'list_manageable_courses') return { data: fixture.managedCourses, error: null }
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
    fixture.role = null
    fixture.calls.length = 0
    fixture.catalog = [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาศึกษาทั่วไป' }]
    fixture.managedCourses = [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_id: 'cat-1', category_name: 'วิชาศึกษาทั่วไป', status: 'approved' }]
    fixture.proposals = [{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }]
    fixture.moderationReviews = [{ id: 'review-1', rating: 5, text: 'ดีมาก', author_active: true, moderation_state: 'visible' as const, created_at: '2026-01-01' }]
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

  it('hides ผู้ดูแลระบบ from an administrator and shows it with Thai role labels for an owner', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    expect(navItem(wrapper, 'ผู้ดูแลระบบ')).toBeUndefined()
    wrapper.unmount()

    fixture.role = 'owner'
    const ownerWrapper = mount(App)
    await flushPromises()
    await openDashboard(ownerWrapper)
    const rolesItem = navItem(ownerWrapper, 'ผู้ดูแลระบบ')
    expect(rolesItem).toBeDefined()
    await rolesItem!.trigger('click')
    await flushPromises()
    expect(fixture.calls.some((call) => call.name === 'list_role_assignments')).toBe(true)
    expect(fixture.calls.some((call) => call.name === 'list_verified_accounts')).toBe(true)
    expect(ownerWrapper.get('.admin-content').text()).toContain('เจ้าของระบบ')
    ownerWrapper.unmount()
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

  it('shows the pending-proposal badge and drops the count when a proposal is approved', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)

    expect(navItem(wrapper, 'ขอกลุ่มเรียน')!.text()).toContain('1')
    await navItem(wrapper, 'ขอกลุ่มเรียน')!.trigger('click')
    await flushPromises()
    await wrapper.get('.admin-content .btn-purple').trigger('click')
    await flushPromises()

    expect(fixture.calls).toContainEqual({ name: 'resolve_offering_proposal', args: { p_proposal_id: 'proposal-1', p_approve: true } })
    expect(wrapper.find('.admin-nav-badge').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reloads the moderation list when the state filter changes and sends the typed reason', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'รีวิว')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.admin-content').text()).toContain('★★★★★')
    expect(wrapper.get('.admin-content').text()).toContain('ให้คะแนน 5 จาก 5 ดาว')
    fixture.calls.length = 0

    await wrapper.get('#admin-review-state').setValue('hidden')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'list_moderation_reviews', args: { p_state: 'hidden' } })

    await wrapper.get('#admin-review-state').setValue('all')
    await flushPromises()
    await wrapper.get('[aria-label="เหตุผลสำหรับรีวิว review-1"]').setValue('ไม่เหมาะสม')
    await wrapper.get('.admin-content .btn-outline-danger').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'moderate_review', args: { p_review_id: 'review-1', p_state: 'hidden', p_reason: 'ไม่เหมาะสม' } })
    wrapper.unmount()
  })

  it('keeps pasted bulk-import text after switching to another section and back', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'นำเข้ารายวิชา')!.trigger('click')
    await flushPromises()
    await wrapper.get('textarea[aria-label="ข้อมูลนำเข้ากลุ่มเรียน (JSON)"]').setValue('[{"draft":true}]')

    await navItem(wrapper, 'รายวิชา')!.trigger('click')
    await flushPromises()
    await navItem(wrapper, 'นำเข้ารายวิชา')!.trigger('click')
    await flushPromises()

    expect((wrapper.get('textarea[aria-label="ข้อมูลนำเข้ากลุ่มเรียน (JSON)"]').element as HTMLTextAreaElement).value).toBe('[{"draft":true}]')
    wrapper.unmount()
  })

  it('renders the unchanged import example in a preformatted code block', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await openDashboard(wrapper)
    await navItem(wrapper, 'นำเข้ารายวิชา')!.trigger('click')
    await flushPromises()

    expect(wrapper.get('.admin-code-example code').text()).toBe('[{"courseCode":"JC100","academicYear":2569,"semester":"1","section":"2","instructorName":"อาจารย์เอ","dayOfWeek":2,"startsAt":"09:00","endsAt":"11:00"}]')
    wrapper.unmount()
  })
})
