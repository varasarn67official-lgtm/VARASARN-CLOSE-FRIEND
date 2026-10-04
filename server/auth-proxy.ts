import { handleAuthProxyRequest, parseSetCookies, resolveNeonAuthLogging, serializeSetCookie, validateCookieConfig } from '@neondatabase/auth/server'

type AuthEnvironment = { NEON_AUTH_BASE_URL?: string; NEON_AUTH_COOKIE_SECRET?: string }
const methods: Record<string, string> = {
  'get-session': 'GET',
  token: 'GET',
  'sign-in/social': 'POST',
  'sign-out': 'POST',
}
const silentLog = resolveNeonAuthLogging({ logLevel: 'silent' })

function finish(response: Response, path: string, code?: string): Response {
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (response.status >= 400) {
    const reference = crypto.randomUUID()
    response.headers.set('X-Auth-Reference', reference)
    // Do not log URLs, exception text, request/response bodies, or SDK metadata.
    console.warn('[auth-proxy]', { path, status: response.status, code: code ?? 'AUTH_UPSTREAM_ERROR', reference })
  }
  return response
}

export async function handleGoogleAuth(request: Request, environment: AuthEnvironment): Promise<Response> {
  const url = new URL(request.url)
  const routeParts = url.searchParams.getAll('authPath')
  const path = url.pathname.startsWith('/api/auth/')
    ? url.pathname.slice('/api/auth/'.length) : routeParts.length === 1 ? routeParts[0]! : ''
  const reject = (status: number, code: string) => finish(Response.json({ code }, { status }), Object.hasOwn(methods, path) ? path : 'unknown', code)
  if (routeParts.length > 1 || !Object.hasOwn(methods, path)) return reject(404, 'AUTH_ROUTE_NOT_FOUND')
  if (request.method !== methods[path]) return reject(405, 'AUTH_METHOD_NOT_ALLOWED')
  if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return reject(403, 'AUTH_ORIGIN_REJECTED')
  if (request.headers.get('sec-fetch-site') === 'cross-site') return reject(403, 'AUTH_ORIGIN_REJECTED')
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return reject(403, 'AUTH_ORIGIN_REJECTED')

  let baseUrl: string
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET ?? ''
  try {
    const upstream = new URL(environment.NEON_AUTH_BASE_URL ?? '')
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error()
    baseUrl = upstream.href.replace(/\/$/, '')
    validateCookieConfig({ secret: cookieSecret })
  } catch { return reject(503, 'AUTH_PROXY_NOT_CONFIGURED') }

  // Vercel rewrite metadata is not an upstream Auth API parameter.
  url.searchParams.delete('authPath')
  // The browser Data API adapter needs the fresh set-auth-jwt header. The
  // toolkit's cookie-cache response contains an opaque token without that header.
  if (path === 'get-session') url.searchParams.set('disableCookieCache', 'true')
  let body: string | undefined
  if (request.method === 'POST') {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reject(415, 'AUTH_JSON_REQUIRED')
    try { body = await request.text() } catch { return reject(400, 'AUTH_INVALID_REQUEST') }
    if (body.length > 8192) return reject(413, 'AUTH_BODY_TOO_LARGE')
    if (path === 'sign-in/social') {
      try {
        const data = JSON.parse(body)
        if (data.provider !== 'google') return reject(400, 'AUTH_GOOGLE_ONLY')
        if (data.callbackURL !== new URL('/', url.origin).href && data.callbackURL !== url.origin) return reject(400, 'AUTH_CALLBACK_REJECTED')
        // Only this app's Google redirect flow is exposed, including its error landing.
        body = JSON.stringify({ provider: 'google', callbackURL: new URL('/', url.origin).href, errorCallbackURL: new URL('/?authError=oauth', url.origin).href })
      } catch { return reject(400, 'AUTH_INVALID_REQUEST') }
    }
  }
  try {
    let response = await handleAuthProxyRequest({
      request: new Request(url, { method: request.method, headers: request.headers, body }),
      path, baseUrl, cookieSecret, sameSite: 'lax', domain: url.hostname, log: silentLog,
    })
    let failureCode: string | undefined
    if (path === 'get-session' && response.ok && !response.headers.get('set-auth-jwt')) {
      const data = await response.clone().json()
      if (data?.session && data?.user) {
        failureCode = 'AUTH_JWT_MISSING'
        // Retain newly issued session cookies so a manual retry can recover.
        response = Response.json({ code: failureCode }, { status: 502, headers: response.headers })
      }
    }
    // Node fetch decodes upstream compression before forwarding the body.
    response.headers.delete('content-encoding')
    const cookies = response.headers.getSetCookie()
    response.headers.delete('set-cookie')
    for (const cookie of cookies) {
      for (const parsed of parseSetCookies(cookie)) {
        // Host-only, first-party cookies; preserve expiry/deletion and all values.
        response.headers.append('set-cookie', serializeSetCookie({ ...parsed, domain: undefined, path: '/', httpOnly: true, secure: true, sameSite: 'lax', partitioned: undefined }))
      }
    }
    return finish(response, path, failureCode)
  } catch { return reject(502, 'AUTH_PROXY_FAILED') }
}
