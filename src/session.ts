import { ref } from 'vue'

export type SessionUser = { id: string; displayName: string }
type AuthClient = { getSession(): Promise<{ user: SessionUser } | null>; signOut(): Promise<unknown> }

export function createSessionStore(auth: AuthClient) {
  const user = ref<SessionUser | null>(null)
  const protectedDataLoaded = ref(false)
  return {
    user,
    protectedDataLoaded,
    async refresh() { user.value = (await auth.getSession())?.user ?? null },
    setProtectedDataLoaded(value: boolean) { protectedDataLoaded.value = value },
    async signOut() { await auth.signOut(); user.value = null; protectedDataLoaded.value = false },
  }
}
