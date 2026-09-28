import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

type Row = { id: string; code: string; name_th: string; category_name: string; review_count?: number; average_rating?: number | null }
type Page = { data: Row[] | null; error: { message: string } | null; count?: number }

const fixture = vi.hoisted(() => ({
  catalog: [] as Row[],
  categories: [] as Array<{ id: string; name: string }>,
  // When set, list_approved_catalog behaves like the real Data API builder: `.range()` pages of
  // `pageSize` rows with an exact count, and the listed page offsets fail.
  paged: null as null | { pageSize: number; failingOffsets: number[] },
  failures: 0,
  gate: null as Promise<void> | null,
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: { getSession: async () => ({ data: { user: { id: 'user-1', email: 'reader@example.com', name: 'Reader' } } }), signOut: async () => undefined },
    rpc: (name: string) => {
      if (name === 'list_approved_catalog') {
        if (fixture.paged) {
          const { pageSize, failingOffsets } = fixture.paged
          return {
            range: async (from: number): Promise<Page> => failingOffsets.includes(from)
              ? { data: null, error: { message: 'page failed' } }
              : { data: fixture.catalog.slice(from, from + pageSize), error: null, count: fixture.catalog.length },
          }
        }
        return (async (): Promise<Page> => {
          if (fixture.gate) await fixture.gate
          if (fixture.failures > 0) { fixture.failures -= 1; return { data: null, error: { message: 'โหลดไม่ได้' } } }
          return { data: fixture.catalog, error: null }
        })()
      }
      if (name === 'list_categories') return Promise.resolve({ data: fixture.categories, error: null })
      if (name === 'current_access') return Promise.resolve({ data: [], error: null })
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => undefined,
}))

const codes = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.course-card .card-title').map((node) => node.text())
const pill = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('.category-menu .category-btn').find((node) => node.text().startsWith(label))!

describe('course catalog page', () => {
  beforeEach(() => {
    fixture.categories = [{ id: 'core', name: 'วิชาแกน' }, { id: 'ge', name: 'ศึกษาทั่วไป' }, { id: 'empty', name: 'หมวดว่าง' }]
    fixture.catalog = [
      { id: '1', code: 'JC101', name_th: 'วารสารศาสตร์เบื้องต้น', category_name: 'วิชาแกน', review_count: 2, average_rating: 3.5 },
      { id: '2', code: 'JC221', name_th: 'การผลิตสื่อดิจิทัล', category_name: 'วิชาแกน', review_count: 0, average_rating: null },
      { id: '3', code: 'TU100', name_th: 'พลเมืองกับการสื่อสาร', category_name: 'ศึกษาทั่วไป', review_count: 5, average_rating: 4.8 },
      { id: '4', code: 'TU101', name_th: 'ทักษะชีวิต', category_name: 'ศึกษาทั่วไป', review_count: 1, average_rating: 4.8 },
    ]
    fixture.paged = null
    fixture.failures = 0
    fixture.gate = null
  })

  it('matches codes regardless of case and spaces, and offers ways out of an empty result', async () => {
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.get('.search-wrap input').setValue('jc 2 21')
    expect(codes(wrapper)).toEqual(['JC221'])
    expect(wrapper.get('.catalog-result-count').text()).toContain('พบ 1')
    expect(wrapper.get('.catalog-result-count').classes()).toContain('visually-hidden')
    await wrapper.get('.search-wrap input').setValue('ไม่มีวิชานี้')
    expect(wrapper.find('.course-card').exists()).toBe(false)
    expect(wrapper.get('.catalog-empty').text()).toContain('ไม่พบรายวิชาที่ตรงกับ “ไม่มีวิชานี้”')
    await wrapper.get('.search-clear').trigger('click')
    expect(codes(wrapper)).toHaveLength(4)
    expect(wrapper.get('.catalog-result-count').text()).toBe('ทั้งหมด 4 วิชา')
    wrapper.unmount()
  })

  it('shows per-category counts that follow the search, with pressed state on the active pill', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(pill(wrapper, 'ทั้งหมด').text()).toBe('ทั้งหมด4')
    expect(pill(wrapper, 'วิชาแกน').text()).toBe('วิชาแกน2')
    expect(pill(wrapper, 'หมวดว่าง').classes()).toContain('is-empty')
    await pill(wrapper, 'ศึกษาทั่วไป').trigger('click')
    expect(pill(wrapper, 'ศึกษาทั่วไป').attributes('aria-pressed')).toBe('true')
    expect(pill(wrapper, 'ทั้งหมด').attributes('aria-pressed')).toBe('false')
    expect(codes(wrapper)).toEqual(['TU100', 'TU101'])
    await wrapper.get('.search-wrap input').setValue('jc')
    expect(pill(wrapper, 'วิชาแกน').text()).toBe('วิชาแกน2')
    expect(pill(wrapper, 'ศึกษาทั่วไป').text()).toBe('ศึกษาทั่วไป0')
    expect(wrapper.get('.catalog-empty').text()).toContain('ดูทุกหมวด')
    wrapper.unmount()
  })

  it('toggles an active category back to all while retaining other filters', async () => {
    const wrapper = mount(App)
    await flushPromises()
    await pill(wrapper, 'วิชาแกน').trigger('click')
    await pill(wrapper, 'วิชาแกน').trigger('click')
    expect(codes(wrapper)).toHaveLength(4)
    expect(pill(wrapper, 'ทั้งหมด').attributes('aria-pressed')).toBe('true')
    expect(pill(wrapper, 'วิชาแกน').attributes('aria-pressed')).toBe('false')
    await wrapper.get('.search-wrap input').setValue('1')
    await wrapper.get('.catalog-reviewed-toggle').trigger('click')
    await wrapper.get('.catalog-sort').setValue('rating')
    await pill(wrapper, 'วิชาแกน').trigger('click')
    expect(codes(wrapper)).toEqual(['JC101'])
    await pill(wrapper, 'วิชาแกน').trigger('click')
    expect(codes(wrapper)).toEqual(['TU100', 'TU101', 'JC101'])
    expect(wrapper.get('.catalog-reviewed-toggle').attributes('aria-pressed')).toBe('true')
    expect((wrapper.get('.search-wrap input').element as HTMLInputElement).value).toBe('1')
    await pill(wrapper, 'ทั้งหมด').trigger('click')
    expect(codes(wrapper)).toEqual(['TU100', 'TU101', 'JC101'])
    wrapper.unmount()
  })

  it('filters to reviewed courses and sorts by review count or rating', async () => {
    const wrapper = mount(App)
    await flushPromises()
    const toggle = wrapper.get('.catalog-reviewed-toggle')
    expect(wrapper.get('label[for="catalog-sort"]').text()).toBe('เรียงตาม:')
    expect(wrapper.get('label[for="catalog-sort"]').classes()).toContain('visually-hidden')
    expect(wrapper.get('.catalog-sort option[value="rating"]').text()).toBe('★ คะแนนสูงสุด')
    expect(toggle.text()).toContain('3')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(codes(wrapper)).toEqual(['JC101', 'TU100', 'TU101'])
    await wrapper.get('.catalog-sort').setValue('reviews')
    expect(codes(wrapper)).toEqual(['TU100', 'JC101', 'TU101'])
    // Equal ratings fall back to review count, then code.
    await wrapper.get('.catalog-sort').setValue('rating')
    expect(codes(wrapper)).toEqual(['TU100', 'TU101', 'JC101'])
    await toggle.trigger('click')
    expect(codes(wrapper).at(-1)).toBe('JC221')
    expect(codes(wrapper)).toHaveLength(4)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('opens the contact dialog from the single floating contact button', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.catalog-contact-btn').exists()).toBe(false)
    const contact = wrapper.find('.floating-contact-btn')
    expect(contact.exists()).toBe(true)
    await contact.trigger('click')
    expect(contact.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[role="dialog"][aria-label="ติดต่อผู้ดูแล"]').exists()).toBe(true)
    expect(wrapper.get('.contact-line').attributes('href')).toBe('https://line.me/R/ti/p/@293shldn')
    await wrapper.get('.contact-modal-header .btn-close').trigger('click')
    expect(contact.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.contact-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reveals all categories without filtering and collapses after choosing one', async () => {
    const wrapper = mount(App)
    await flushPromises()
    const disclosure = wrapper.find('button[aria-controls="catalog-categories"]')
    expect(disclosure.exists()).toBe(true)
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(disclosure.text()).toContain('ทุกหมวด')
    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('true')
    expect(codes(wrapper)).toHaveLength(4)
    await pill(wrapper, 'ศึกษาทั่วไป').trigger('click')
    await flushPromises()
    expect(codes(wrapper)).toEqual(['TU100', 'TU101'])
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(pill(wrapper, 'ศึกษาทั่วไป').attributes('aria-pressed')).toBe('true')
    await disclosure.trigger('click')
    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(codes(wrapper)).toEqual(['TU100', 'TU101'])
    wrapper.unmount()
  })

  it('keeps the toolbar at the viewport top when choosing from expanded categories while stuck', async () => {
    const wrapper = mount(App)
    await flushPromises()
    let scrollY = 2000
    const scrollPosition = vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      scrollY = (options as ScrollToOptions).top ?? scrollY
    })
    // Browser layout seam: the sentinel is 700px down the document. Collapsing
    // an expanded row can make scrollIntoView move its outer scrolling ancestor.
    const sentinel = wrapper.get('.catalog-toolbar-sentinel').element as HTMLElement
    sentinel.getBoundingClientRect = () => ({ top: 700 - scrollY }) as DOMRect
    const category = pill(wrapper, 'ศึกษาทั่วไป')
    ;(category.element as HTMLElement).scrollIntoView = () => { scrollY -= 280 }
    try {
      await wrapper.get('.catalog-category-disclosure').trigger('click')
      await category.trigger('click')
      await flushPromises()
      expect(scrollY).toBe(701)
      expect(codes(wrapper)).toEqual(['TU100', 'TU101'])
    } finally {
      scrollPosition.mockRestore()
      scrollTo.mockRestore()
      wrapper.unmount()
    }
  })

  it('keeps the banner visible with placeholder cards while the catalog loads', async () => {
    let release!: () => void
    fixture.gate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.hero-banner').exists()).toBe(true)
    expect(wrapper.findAll('.course-card-skeleton')).toHaveLength(6)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('ไม่พบรายวิชา')
    release()
    await flushPromises()
    expect(wrapper.find('.course-card-skeleton').exists()).toBe(false)
    expect(codes(wrapper)).toHaveLength(4)
    wrapper.unmount()
  })

  it('shows a retryable load error instead of the no-match message when nothing loaded', async () => {
    fixture.failures = 1
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.catalog-state').text()).toContain('โหลดรายวิชาไม่สำเร็จ')
    expect(wrapper.get('.catalog-state').text()).toContain('กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง')
    expect(wrapper.text()).not.toContain('โหลดไม่ได้')
    expect(wrapper.get('.catalog-result-count').text()).not.toMatch(/0/)
    expect(wrapper.find('.category-count').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('ไม่พบรายวิชา')
    await wrapper.get('.catalog-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.catalog-state').exists()).toBe(false)
    expect(codes(wrapper)).toHaveLength(4)
    wrapper.unmount()
  })

  it('shows zero counts and dimmed clickable categories after an empty catalog loads successfully', async () => {
    fixture.catalog = []
    const wrapper = mount(App)
    await flushPromises()
    expect(pill(wrapper, 'ทั้งหมด').text()).toBe('ทั้งหมด0')
    expect(pill(wrapper, 'วิชาแกน').text()).toBe('วิชาแกน0')
    expect(pill(wrapper, 'วิชาแกน').classes()).toContain('is-empty')
    expect(wrapper.get('.catalog-reviewed-toggle .category-count').text()).toBe('0')
    await pill(wrapper, 'วิชาแกน').trigger('click')
    expect(pill(wrapper, 'วิชาแกน').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('keeps the rows from pages that loaded when a later page fails, with a warning', async () => {
    fixture.catalog = Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, code: `JC10${index}`, name_th: `วิชา ${index}`, category_name: 'วิชาแกน' }))
    fixture.paged = { pageSize: 2, failingOffsets: [4] }
    const wrapper = mount(App)
    await flushPromises()
    expect(codes(wrapper)).toEqual(['JC100', 'JC101', 'JC102', 'JC103'])
    expect(wrapper.get('.catalog-load-warning').text()).toContain('โหลดรายวิชาได้ไม่ครบ')
    expect(wrapper.text()).not.toContain('page failed')
    fixture.paged.failingOffsets = []
    await wrapper.get('.catalog-load-warning .catalog-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.catalog-load-warning').exists()).toBe(false)
    expect(codes(wrapper)).toHaveLength(5)
    wrapper.unmount()
  })
})
