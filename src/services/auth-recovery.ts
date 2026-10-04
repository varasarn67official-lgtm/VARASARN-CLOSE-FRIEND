export type EmbeddedBrowser = 'LINE' | 'Instagram' | 'Facebook' | 'Messenger' | null

export function embeddedBrowser(userAgent: string): EmbeddedBrowser {
  if (/\bLine\//i.test(userAgent)) return 'LINE'
  if (/\bInstagram\b/i.test(userAgent)) return 'Instagram'
  if (/\bMessenger\b/i.test(userAgent)) return 'Messenger'
  if (/\b(?:FBAN|FBAV|FB_IAB)\b/i.test(userAgent)) return 'Facebook'
  return null
}

// Recovery must start a new login. Never copy OAuth verifiers or other URL state.
export function recoveryLink(origin: string, external = false, continueGoogle = false): string {
  const url = new URL('/', origin)
  if (external) url.searchParams.set('openExternalBrowser', '1')
  if (continueGoogle) url.searchParams.set('continue', 'google')
  return url.href
}

export function chromeRecoveryLink(origin: string, continueGoogle = false): string {
  const url = new URL(recoveryLink(origin, false, continueGoogle))
  return `intent://${url.host}/${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`
}

export function recordAuthFailure(stage: 'sign-in' | 'session', cause: unknown): void {
  const status = typeof cause === 'object' && cause !== null && 'status' in cause
    && typeof cause.status === 'number' && Number.isInteger(cause.status)
    && cause.status >= 400 && cause.status <= 599 ? cause.status : null
  // No exception text, URL, headers, account data, or response body in diagnostics.
  console.warn('[auth-recovery]', {
    stage,
    status,
    browser: embeddedBrowser(navigator.userAgent) ?? 'other',
    code: status ? 'AUTH_HTTP_ERROR' : 'AUTH_REQUEST_FAILED',
  })
}
