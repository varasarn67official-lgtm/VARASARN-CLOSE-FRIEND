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
  signInCalls: 0,
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
    fixture.signInCalls += 1
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
  fixture.signInCalls = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); history.replaceState(null, '', '/') })

const recoveryMessage = 'ลองเข้าสู่ระบบด้วย Google อีกครั้ง'

describe('login failure feedback at the App root', () => {
  it('explains a rejected session restoration without displaying the technical error', async () => {
    fixture.sessionFailure = new Error('HTTP 400')
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toContain(recoveryMessage)
    expect(wrapper.get('.google-signin-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('HTTP 400')
  })

  it('shows recovery advice when the adapter returns a session error result', async () => {
    fixture.sessionError = { message: 'HTTP 400', status: 400 }
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toContain(recoveryMessage)
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
    expect(wrapper.get('.login-card [role="alert"]').text()).toContain(recoveryMessage)
    expect(wrapper.text()).not.toContain('HTTP 400')
  })

  it.each(['iPhone Line/14.0', 'Android Instagram 123', 'iPhone FBAN/FBIOS;FBAV/123'])('gives %s a browser-opening route instead of a redundant Google button', async userAgent => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    expect(fixture.signInCalls).toBe(0)
    expect(wrapper.find('.google-signin-btn').exists()).toBe(false)
    expect(wrapper.get('.login-browser-help').attributes('open')).toBeDefined()
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
  })

  it('continues Google once in the destination browser and consumes the request before auth', async () => {
    history.replaceState(null, '', '/?continue=google')
    wrapper = mount(App)
    await flushPromises()
    expect(fixture.signInCalls).toBe(1)
    expect(location.search).toBe('')
    wrapper.unmount()
    wrapper = mount(App)
    await flushPromises()
    expect(fixture.signInCalls).toBe(1)
  })

  it('keeps a continuation that stayed in Instagram on the browser instructions', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Instagram 123')
    history.replaceState(null, '', '/?continue=google')
    wrapper = mount(App)
    await flushPromises()
    expect(fixture.signInCalls).toBe(0)
    expect(location.search).toBe('')
    expect(wrapper.get('.browser-menu-steps').text()).toContain('Instagram')
  })

  it('uses an existing destination-browser session without starting Google again', async () => {
    fixture.session = { user: { id: 'synthetic-member' } }
    history.replaceState(null, '', '/?continue=google')
    wrapper = mount(App)
    await flushPromises()
    expect(fixture.signInCalls).toBe(0)
    expect(location.search).toBe('')
    expect(wrapper.find('.login-card').exists()).toBe(false)
  })

  it('allows manual recovery after a failed continuation without restarting on reload', async () => {
    fixture.signInFailure = new Error('HTTP 400')
    history.replaceState(null, '', '/?continue=google')
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toContain(recoveryMessage)
    expect(fixture.signInCalls).toBe(1)
    wrapper.unmount()
    wrapper = mount(App)
    await flushPromises()
    expect(fixture.signInCalls).toBe(1)
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
  })

  it('clears the previous failure as soon as the user retries Google sign-in', async () => {
    fixture.sessionFailure = new Error('HTTP 400')
    wrapper = mount(App)
    await flushPromises()
    let resolveSignIn!: () => void
    fixture.signInPending = new Promise<void>((resolve) => { resolveSignIn = resolve })
    await wrapper.get('.google-signin-btn').trigger('click')
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
    expect(wrapper.get('.google-signin-btn').attributes('disabled')).toBeDefined()
    await wrapper.get('.google-signin-btn').trigger('click')
    expect(fixture.signInCalls).toBe(1)
    resolveSignIn()
    await flushPromises()
    expect(wrapper.find('.login-card [role="alert"]').exists()).toBe(false)
  })

  it('explains an OAuth error return and cleans its error parameters', async () => {
    history.replaceState(null, '', '/?authError=oauth&error=private-description')
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('.login-card [role="alert"]').text()).toContain(recoveryMessage)
    expect(wrapper.get('.login-browser-help').attributes('open')).toBeUndefined()
    expect(location.search).toBe('')
    expect(wrapper.text()).not.toContain('private-description')
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
