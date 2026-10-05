import { createInternalNeonAuth } from '@neondatabase/auth'
import { NeonPostgrestClient, fetchWithToken } from '@neondatabase/postgrest-js'

const authUrl = import.meta.env.VITE_AUTH_PROXY_ENABLED === 'true'
  ? new URL('/api/auth', window.location.origin).href
  : import.meta.env.VITE_NEON_AUTH_URL
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL

const auth = authUrl ? createInternalNeonAuth(authUrl) : null
const dataApi = auth && dataApiUrl
  ? new NeonPostgrestClient({
      dataApiUrl,
      options: { global: { fetch: fetchWithToken(auth.getJWTToken) } },
    })
  : null

export const neon = auth && dataApi ? { auth: auth.adapter, rpc: dataApi.rpc.bind(dataApi) } : null

export async function signInWithGoogle() {
  if (!neon) throw new Error('ยังไม่ได้ตั้งค่า Neon Auth และ Data API')
  const result = await (neon.auth as any).signIn.social({
    provider: 'google', callbackURL: window.location.origin,
    errorCallbackURL: new URL('/?authError=oauth', window.location.origin).href,
  })
  if (result?.error) throw result.error
}
