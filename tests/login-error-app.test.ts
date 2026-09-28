import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'

const fixture = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  sessionError: null as { message: string; status: number } | null,
  sessionFailure: null as Error | null,
  signInFailure: null as Error | null,
  signInPending: null as Promise<void> | null,
  categoryFailure: false,
  accessFailure: false,
  catalogFailure: false,
  accessPending: null as Promise<void> | null,
  owner: false,
  calls: [] as string[],
}))

vi.mock('../src/neon', () => ({
  neon: {
    auth: {
      getSession: async () => {
        if (fixture.sessionFailure) throw fixture.sessionFailure
        return { data: fixture.session, error: fixture.sessionError }
      },
      signOut: async () => undefined,
    },
    rpc: async (name: string) => {
      fixture.calls.push(name)
      if (name === 'current_access') {
        if (fixture.accessPending) await fixture.accessPending
        if (fixture.accessFailure) throw new Error('HTTP 400')
        return { data: fixture.owner ? [{ role: 'owner' }] : [], error: null }
      }
      if (name === 'list_approved_catalog' && fixture.catalogFailure) throw new Error('HTTP 400')
      if (name === 'list_categories' && fixture.categoryFailure) return { data: null, error: { message: 'category load failed' } }
      if (['current_access', 'list_approved_catalog', 'list_categories'].includes(name)) return { data: [], error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  },
  signInWithGoogle: async () => {
    if (fixture.signInFailure) throw fixture.signInFailure
    if (fixture.signInPending) await fixture.signInPending
  },
}))

let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  fixture.session = null
  fixture.sessionError = null
  fixture.sessionFailure = null
  fixture.signInFailure = null
  fixture.signInPending = null
  fixture.categoryFailure = false
  fixture.accessFailure = false
  fixture.catalogFailure = false
  fixture.accessPending = null
  fixture.owner = false
  fixture.calls = []
})
afterEach(() => wrapper?.unmount())

const recoveryMessage = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองเข้าสู่ระบบด้วย Google อีกครั้ง หากยังพบปัญหา กรุณาติดต่อผู้ดูแล'

describe('login failure feedback at the App root', () => {
  it('explains a rejected session restoration without displaying the technical error', async () => {
    fixture.sessionFailure = new Error('HTTP 400')
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toBe(recoveryMessage)
    expect(wrapper.get('.google-signin-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('HTTP 400')
  })

  it('shows recovery advice when the adapter returns a session error result', async () => {
    fixture.sessionError = { message: 'HTTP 400', status: 400 }
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toBe(recoveryMessage)
  })

  it('keeps an ordinary signed-out visit free of failure messages', async () => {
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.google-signin-btn').exists()).toBe(true)
  })

  it('explains a failure to start Google sign-in', async () => {
    wrapper = mount(App)
    await flushPromises()
    fixture.signInFailure = new Error('HTTP 400')
    await wrapper.get('.google-signin-btn').trigger('click')
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toBe(recoveryMessage)
    expect(wrapper.text()).not.toContain('HTTP 400')
  })

  it('clears the previous failure as soon as the user retries Google sign-in', async () => {
    fixture.sessionFailure = new Error('HTTP 400')
    wrapper = mount(App)
    await flushPromises()
    let resolveSignIn!: () => void
    fixture.signInPending = new Promise<void>((resolve) => { resolveSignIn = resolve })
    await wrapper.get('.google-signin-btn').trigger('click')
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
    resolveSignIn()
    await flushPromises()
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
  })

  it('does not label a category fetch failure as failed Google sign-in', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    fixture.categoryFailure = true
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.login-card').exists()).toBe(false)
    expect(wrapper.get('.startup-data-warning').text()).toContain('โหลดหมวดหมู่ไม่สำเร็จ')
    expect(wrapper.text()).not.toContain('category load failed')
    expect(fixture.calls.filter(name => name === 'list_categories')).toHaveLength(1)
    fixture.categoryFailure = false
    await wrapper.get('.startup-data-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.startup-data-warning').exists()).toBe(false)
  })
  it('keeps a valid session when access fails and allows a manual role retry', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    fixture.accessFailure = true
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.login-card').exists()).toBe(false)
    expect(wrapper.get('.startup-data-warning').text()).toContain('ตรวจสอบสิทธิ์การใช้งานไม่สำเร็จ')
    expect(wrapper.text()).not.toContain('HTTP 400')
    await wrapper.get('.user-dropdown-btn').trigger('click')
    expect(wrapper.text()).not.toContain('แดชบอร์ดผู้ดูแล')
    expect(fixture.calls.filter(name => name === 'current_access')).toHaveLength(1)
    fixture.accessFailure = false
    fixture.owner = true
    await wrapper.get('.startup-data-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.startup-data-warning').exists()).toBe(false)
    expect(wrapper.text()).toContain('แดชบอร์ดผู้ดูแล')
  })

  it('treats an empty access result as an ordinary member, without suggesting sign-in failed', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.login-card').exists()).toBe(false)
    expect(wrapper.find('.startup-data-warning').exists()).toBe(false)
    await wrapper.get('.user-dropdown-btn').trigger('click')
    expect(wrapper.text()).not.toContain('แดชบอร์ดผู้ดูแล')
  })

  it('shows friendly catalog feedback for a thrown network error without signing out', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    fixture.catalogFailure = true
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.login-card').exists()).toBe(false)
    expect(wrapper.get('.catalog-state').text()).toContain('กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง')
    expect(wrapper.text()).not.toContain('HTTP 400')
    fixture.catalogFailure = false
    await wrapper.get('.catalog-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('.catalog-retry').exists()).toBe(false)
  })

  it('prevents overlapping manual data retries and ignores a role result after sign-out', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    fixture.accessFailure = true
    wrapper = mount(App)
    await flushPromises()
    fixture.accessFailure = false
    fixture.owner = true
    let resolveAccess!: () => void
    fixture.accessPending = new Promise<void>(resolve => { resolveAccess = resolve })
    await wrapper.get('.startup-data-retry').trigger('click')
    expect(wrapper.get('.startup-data-retry').attributes('disabled')).toBeDefined()
    await wrapper.get('.startup-data-retry').trigger('click')
    expect(fixture.calls.filter(name => name === 'current_access')).toHaveLength(2)
    await wrapper.get('.user-dropdown-btn').trigger('click')
    const signOutButton = wrapper.findAll('button').find(button => button.text().includes('ออกจากระบบ'))!
    await signOutButton.trigger('click')
    await flushPromises()
    resolveAccess()
    await flushPromises()
    expect(wrapper.find('.login-card').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('แดชบอร์ดผู้ดูแล')
  })
})
