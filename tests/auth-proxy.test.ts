// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGoogleAuth } from '../server/auth-proxy'

const origin = 'https://app.example.com'
const upstream = 'https://auth.example.com/neondb/auth'
const environment = { NEON_AUTH_BASE_URL: upstream, NEON_AUTH_COOKIE_SECRET: 'synthetic-cookie-secret-at-least-32-characters' }
const session = { user: { id: 'synthetic-user', name: 'Synthetic', email: 'synthetic@example.com', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, session: { id: 'synthetic-session', token: 'opaque-token', userId: 'synthetic-user', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' } }
const remote = vi.fn<typeof fetch>()
let logs: ReturnType<typeof vi.spyOn>
function request(path: string, options: RequestInit = {}) {
  return new Request(`${origin}/api/auth/${path}`, options)
}
function social(data: unknown = { provider: 'google', callbackURL: origin }) {
  return request('sign-in/social', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) })
}
beforeEach(() => {
  remote.mockReset()
  vi.stubGlobal('fetch', remote)
  logs = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('same-origin Google Auth with the real Neon server toolkit', () => {
  it('forwards Google sign-in and makes its challenge cookie first-party', async () => {
    remote.mockResolvedValueOnce(Response.json({ url: 'https://accounts.google.com/synthetic', redirect: true }, { headers: { 'set-cookie': '__Secure-neon-auth.session_challenge=synthetic-challenge; Domain=auth.example.com; Path=/; Secure; HttpOnly; SameSite=None; Partitioned' } }))
    const response = await handleGoogleAuth(social(), environment)
    expect(response.status).toBe(200)
    const [target, init] = remote.mock.calls[0]!
    expect(target).toBe(`${upstream}/sign-in/social`)
    expect(JSON.parse(init!.body as string)).toEqual({ provider: 'google', callbackURL: `${origin}/`, errorCallbackURL: `${origin}/?authError=oauth` })
    const cookie = response.headers.getSetCookie()[0]!
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toMatch(/Domain=|Partitioned/)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('exchanges the OAuth verifier, forwards JWT, and preserves multiple cookies', async () => {
    const headers = new Headers({ 'set-auth-jwt': 'synthetic.data.jwt' })
    headers.append('set-cookie', '__Secure-neon-auth.session_token=synthetic-session; Path=/; Secure; HttpOnly; SameSite=None')
    headers.append('set-cookie', '__Secure-neon-auth.session_challenge=; Path=/; Secure; HttpOnly; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    remote.mockResolvedValueOnce(Response.json(session, { headers })).mockResolvedValue(Response.json(session))
    const response = await handleGoogleAuth(request('get-session?neon_auth_session_verifier=synthetic-verifier', { headers: { cookie: '__Secure-neon-auth.session_challenge=synthetic-challenge; unrelated=private' } }), environment)
    expect(response.status).toBe(200)
    const [target, init] = remote.mock.calls[0]!
    expect(new URL(target as string).searchParams.get('neon_auth_session_verifier')).toBe('synthetic-verifier')
    expect(new Headers(init!.headers).get('cookie')).not.toContain('unrelated')
    expect(response.headers.get('set-auth-jwt')).toBe('synthetic.data.jwt')
    const cookies = response.headers.getSetCookie()
    expect(cookies.some(cookie => cookie.includes('session_token=synthetic-session'))).toBe(true)
    expect(cookies.some(cookie => cookie.includes('session_challenge=') && cookie.includes('Max-Age=0'))).toBe(true)
    expect(cookies.every(cookie => !/Domain=|Partitioned/.test(cookie))).toBe(true)
  })

  it('restores sessions from upstream instead of returning a cached opaque Data API token', async () => {
    remote.mockResolvedValue(Response.json(session, { headers: { 'set-auth-jwt': 'fresh.data.jwt' } }))
    const response = await handleGoogleAuth(request('get-session', { headers: { cookie: '__Secure-neon-auth.session_token=synthetic; __Secure-neon-auth.local.session_data=stale' } }), environment)
    expect(remote).toHaveBeenCalledTimes(1)
    expect(new URL(remote.mock.calls[0]![0] as string).searchParams.get('disableCookieCache')).toBe('true')
    expect(response.headers.get('set-auth-jwt')).toBe('fresh.data.jwt')
  })

  it('forwards sign-out cookie deletion without caching it', async () => {
    remote.mockResolvedValueOnce(Response.json({ success: true }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=; Path=/; Secure; HttpOnly; Max-Age=0' } }))
    const response = await handleGoogleAuth(request('sign-out', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }), environment)
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('strips Vercel route metadata while retaining the verifier query', async () => {
    remote.mockResolvedValueOnce(Response.json(null))
    await handleGoogleAuth(new Request(`${origin}/api/auth?authPath=get-session&neon_auth_session_verifier=synthetic`), environment)
    const target = new URL(remote.mock.calls[0]![0] as string)
    expect(target.pathname).toBe('/neondb/auth/get-session')
    expect(target.searchParams.has('authPath')).toBe(false)
    expect(target.searchParams.get('neon_auth_session_verifier')).toBe('synthetic')
  })

  it.each(['sign-in/email', 'sign-up/email', 'admin/list-users', '../get-session', 'https://evil.example.com'])('does not expose %s', async path => {
    const response = await handleGoogleAuth(new Request(`${origin}/api/auth?authPath=${encodeURIComponent(path)}`), environment)
    expect(response.status).toBe(404)
    expect(remote).not.toHaveBeenCalled()
  })

  it('rejects cross-site mutations and arbitrary OAuth providers/callbacks', async () => {
    expect((await handleGoogleAuth(request('sign-out', { method: 'POST', headers: { origin: 'https://evil.example.com' }, body: '{}' }), environment)).status).toBe(403)
    expect((await handleGoogleAuth(social({ provider: 'github', callbackURL: origin }), environment)).status).toBe(400)
    expect((await handleGoogleAuth(social({ provider: 'google', callbackURL: 'https://evil.example.com' }), environment)).status).toBe(400)
    expect(remote).not.toHaveBeenCalled()
  })

  it('fails clearly with no configuration and does not fall back to direct auth', async () => {
    const response = await handleGoogleAuth(request('get-session'), {})
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'AUTH_PROXY_NOT_CONFIGURED' })
    expect(remote).not.toHaveBeenCalled()
  })

  it('logs only safe fields on a network failure', async () => {
    remote.mockRejectedValue(new TypeError('fetch failed secret-token user@example.com https://auth.example.com/?verifier=private', { cause: { code: 'ECONNRESET' } }))
    const response = await handleGoogleAuth(request('get-session?neon_auth_session_verifier=private'), environment)
    expect(response.status).toBe(502)
    expect(response.headers.get('x-auth-reference')).toBeTruthy()
    const output = JSON.stringify(logs.mock.calls)
    expect(output).not.toMatch(/secret-token|user@example.com|verifier|https:/)
    expect(logs.mock.calls[0]![1]).toMatchObject({ path: 'get-session', status: 502 })
  })

  it('fails safely when an authenticated response has no Data API JWT', async () => {
    remote.mockImplementation(async () => Response.json(session, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=synthetic-session; Path=/; Secure; HttpOnly' } }))
    const response = await handleGoogleAuth(request('get-session'), environment)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ code: 'AUTH_JWT_MISSING' })
    expect(response.headers.getSetCookie().some(cookie => cookie.includes('session_token=synthetic-session'))).toBe(true)
  })

  it('removes upstream compression headers from the body already decoded by Node fetch', async () => {
    remote.mockResolvedValueOnce(Response.json(null, { headers: { 'content-encoding': 'gzip' } }))
    const response = await handleGoogleAuth(request('get-session'), environment)
    expect(response.headers.has('content-encoding')).toBe(false)
    expect(await response.json()).toBeNull()
  })

  it('supplies the Data API JWT through the actual browser SDK adapter', async () => {
    const { createInternalNeonAuth } = await import('@neondatabase/auth')
    remote.mockImplementation(async (input, init) => {
      if (String(input).startsWith(`${origin}/api/auth`)) {
        return handleGoogleAuth(new Request(String(input), init as RequestInit), environment)
      }
      return Response.json(session, { headers: { 'set-auth-jwt': 'synthetic.data.jwt' } })
    })
    const client = createInternalNeonAuth(`${origin}/api/auth`)
    const result = await client.adapter.getSession()
    expect(result.data?.session.token).toBe('synthetic.data.jwt')
    expect(await client.getJWTToken()).toBe('synthetic.data.jwt')
  })
})
