import { describe, expect, it } from 'vitest'
import { createSessionStore } from '../src/session'

describe('session store', () => {
  it('clears the signed-in user and protected data on sign-out', async () => {
    const signedOut: string[] = []
    const store = createSessionStore({
      getSession: async () => ({ user: { id: 'user-a', displayName: 'A' } }),
      signOut: async () => { signedOut.push('called') },
    })

    await store.refresh()
    store.setProtectedDataLoaded(true)
    await store.signOut()

    expect(signedOut).toEqual(['called'])
    expect(store.user.value).toBeNull()
    expect(store.protectedDataLoaded.value).toBe(false)
  })
})
