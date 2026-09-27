import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  signOut: vi.fn(),
  catalog: [{ id: 'course-1', code: 'JC232', name_th: 'เทคนิคการถ่ายทำ', category_name: 'วิชาเอก' }],
  myReviews: [{ id: 'review-1', course_id: 'course-1', offering_id: null, rating: 4, text: 'สนุกมาก', author_active: true, created_at: '2026-09-23T16:57:55.624035+00:00' }],
  revisions: [{ id: 'rev-1', rating: 3, text: 'เก่ากว่านี้', revised_at: '2026-09-20T10:00:00+00:00' }],
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: { id: 'user-1', email: 'student@example.com', name: 'Student' } } }), signOut: fixture.signOut },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'list_approved_catalog') return { data: fixture.catalog, error: null }
      if (name === 'list_categories') return { data: [], error: null }
      if (name === 'current_access') return { data: [{ role: null }], error: null }
      if (name === 'list_my_reviews') return { data: fixture.myReviews, error: null }
      if (name === 'list_my_review_revisions') return { data: args?.p_review_id === 'review-1' ? fixture.revisions : [], error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

async function openMyReviews() {
  const wrapper = mount(App)
  await flushPromises()
  await wrapper.get('.account-menu .dropdown-toggle').trigger('click')
  await wrapper.get('.account-menu-list .dropdown-item').trigger('click')
  await flushPromises()
  return wrapper
}

describe('My Reviews page', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    fixture.signOut.mockClear()
    fixture.myReviews = [{ id: 'review-1', course_id: 'course-1', offering_id: null, rating: 4, text: 'สนุกมาก', author_active: true, created_at: '2026-09-23T16:57:55.624035+00:00' }]
  })

  it('keeps the mobile account menu available and signs out from My Reviews', async () => {
    const wrapper = await openMyReviews()
    expect(wrapper.find('.mobile-account-menu').exists()).toBe(true)
    await wrapper.get('.mobile-account-menu > button').trigger('click')
    await wrapper.get('.mobile-account-menu .text-danger').trigger('click')
    await flushPromises()
    expect(fixture.signOut).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('identifies each card by its course instead of repeating a generic title', async () => {
    const wrapper = await openMyReviews()
    const card = wrapper.get('.review-box')
    expect(card.text()).toContain('JC232')
    expect(card.text()).toContain('เทคนิคการถ่ายทำ')
    expect(card.text()).not.toContain('รีวิวของฉัน รีวิวของฉัน')
    wrapper.unmount()
  })

  it('shows a human-readable date instead of the raw ISO timestamp', async () => {
    const wrapper = await openMyReviews()
    const card = wrapper.get('.review-box')
    expect(card.text()).not.toContain('2026-09-23T16:57:55.624035+00:00')
    expect(card.text()).toContain('2569')
    wrapper.unmount()
  })

  it('falls back gracefully when the review’s course is not in the approved catalog', async () => {
    fixture.myReviews = [{ id: 'review-2', course_id: 'course-missing', offering_id: null, rating: 5, text: 'ok', author_active: true, created_at: '2026-09-23T16:57:55.624035+00:00' }]
    const wrapper = await openMyReviews()
    expect(wrapper.get('.review-box').text()).toContain('ไม่พบข้อมูลรายวิชา')
    wrapper.unmount()
  })

  it('formats revision history timestamps too', async () => {
    const wrapper = await openMyReviews()
    const historyButton = wrapper.findAll('button').find((button) => button.text().includes('ดูประวัติการแก้ไข'))!
    await historyButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('2026-09-20T10:00:00+00:00')
    expect(wrapper.text()).toContain('2569')
    expect(wrapper.get('.review-box').text()).toContain('★★★★☆')
    expect(wrapper.get('.review-box').text()).toContain('ให้คะแนน 4 จาก 5 ดาว')
    expect(wrapper.get('.review-box').text()).not.toContain('>')
    expect(wrapper.text()).toContain('★★★☆☆')
    expect(wrapper.text()).toContain('ให้คะแนน 3 จาก 5 ดาว')
    wrapper.unmount()
  })
})
