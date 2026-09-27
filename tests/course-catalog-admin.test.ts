import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  role: null as 'owner' | 'administrator' | null,
  categories: [{ id: 'cat-1', name: 'วิชาศึกษาทั่วไป' }],
  catalog: [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาแกน' }] as Array<{ id: string; code: string; name_th: string; category_name: string; review_count?: number; average_rating?: number | null }>,
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' } } }), signOut: async () => undefined },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      fixture.calls.push({ name, args })
      if (name === 'list_approved_catalog') return { data: fixture.catalog, error: null }
      if (name === 'list_categories') return { data: fixture.categories, error: null }
      if (name === 'current_access') return { data: [{ role: fixture.role }], error: null }
      if (name === 'create_course') {
        const { p_code: code, p_name_th: nameTh, p_category_id: categoryId } = args as { p_code?: string; p_name_th?: string; p_category_id?: string }
        if (fixture.catalog.some((course) => course.code === code)) return { data: null, error: { message: `รหัสวิชา ${code} มีอยู่แล้ว` } }
        const category = fixture.categories.find((item) => item.id === categoryId)
        fixture.catalog = [...fixture.catalog, { id: `course-${code}`, code: String(code), name_th: String(nameTh), category_name: category?.name ?? '' }]
        return { data: null, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

describe('add-course button on the catalog page', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    fixture.role = null
    fixture.catalog = [{ id: 'course-1', code: 'JC100', name_th: 'วารสารศาสตร์', category_name: 'วิชาแกน' }]
    fixture.calls.length = 0
  })

  it('is hidden for a signed-in reader with no admin role', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.add-course-btn').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows accessible rating summaries and no text at all for an unreviewed course', async () => {
    fixture.catalog = [
      { id: 'rated', code: 'JC101', name_th: 'มีรีวิว', category_name: 'วิชาแกน', review_count: 12, average_rating: 4.2 },
      { id: 'empty', code: 'JC102', name_th: 'ยังว่าง', category_name: 'วิชาแกน', review_count: 0, average_rating: null },
    ]
    const wrapper = mount(App)
    await flushPromises()
    const cards = wrapper.findAll('.course-card')
    expect(cards[0].text()).toContain('★★★★☆')
    expect(cards[0].text()).toContain('4.2 · 12 รีวิว')
    expect(cards[0].text()).toContain('คะแนนเฉลี่ย 4.2 จาก 5 จาก 12 รีวิว')
    expect(cards[1].text()).not.toContain('ยังไม่มีรีวิว')
    expect(cards[1].find('.course-rating-summary').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders no rating summary when the catalog row has no rating fields', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.course-card').text()).not.toContain('ยังไม่มีรีวิว')
    expect(wrapper.find('.course-rating-summary').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens a modal and creates a course for an administrator', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    const addButton = wrapper.get('.add-course-btn')
    expect(addButton.text()).toContain('เพิ่มรายวิชาใหม่')
    await addButton.trigger('click')
    await flushPromises()
    await wrapper.get('#new-course-code').setValue('JC200')
    await wrapper.get('#new-course-name').setValue('วิชาใหม่')
    await wrapper.get('.course-modal-body button.btn-purple').trigger('click')
    await flushPromises()
    expect(fixture.calls).toContainEqual({ name: 'create_course', args: { p_code: 'JC200', p_name_th: 'วิชาใหม่', p_category_id: 'cat-1' } })
    expect(wrapper.find('.course-modal-body').exists()).toBe(false)
    expect(wrapper.get('.toast-banner').text()).toContain('เพิ่มรายวิชาสำเร็จ')
    expect(fixture.calls).toContainEqual({ name: 'list_approved_catalog', args: undefined })
    const codes = wrapper.findAll('.course-card .card-title').map((node) => node.text())
    expect(codes).toContain('JC200')
    wrapper.unmount()
  })

  it('shows a friendly error and keeps the modal open for a duplicate course code', async () => {
    fixture.role = 'administrator'
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('.add-course-btn').trigger('click')
    await flushPromises()
    await wrapper.get('#new-course-code').setValue('JC100')
    await wrapper.get('#new-course-name').setValue('วารสารศาสตร์ (ซ้ำ)')
    await wrapper.get('.course-modal-body button.btn-purple').trigger('click')
    await flushPromises()
    expect(wrapper.get('.course-modal-body .alert-danger').text()).toContain('JC100 มีอยู่แล้ว')
    expect(wrapper.find('.course-modal-body').exists()).toBe(true)
    expect(wrapper.find('.toast-banner').exists()).toBe(false)
    wrapper.unmount()
  })
})
