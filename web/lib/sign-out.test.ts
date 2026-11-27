import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({ signOut }))
const loadPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', () => ({ loadPage }))

import { signOutTo } from './sign-out'

// In production the login library answers with an address on its own site
// setting, which is another site than the app
const OTHER_SITE = 'https://textbee.dev/login'

beforeEach(() => {
  signOut.mockReset()
  loadPage.mockReset()
})

describe('signOutTo', () => {
  it('signs out without the library redirect and loads the login page of this site', async () => {
    signOut.mockResolvedValue({ url: OTHER_SITE })
    expect(await signOutTo()).toBe(true)
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(loadPage).toHaveBeenCalledWith('/login')
    expect(loadPage).not.toHaveBeenCalledWith(OTHER_SITE)
  })

  it('keeps a same-site path with its query', async () => {
    signOut.mockResolvedValue({ url: OTHER_SITE })
    await signOutTo('/login?redirect=%2Flink-device')
    expect(loadPage).toHaveBeenCalledWith('/login?redirect=%2Flink-device')
  })

  it('stays on the page and answers false when signing out fails', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    expect(await signOutTo('/login')).toBe(false)
    expect(loadPage).not.toHaveBeenCalled()
  })

  it('loads the page after a failure only when asked to', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    expect(await signOutTo('/link-device', { loadOnFailure: true })).toBe(false)
    expect(loadPage).toHaveBeenCalledWith('/link-device')
  })

  it.each([
    'https://evil.example.net/login',
    '//evil.example.net/login',
    'javascript:alert(1)',
  ])('never loads %s', async (path) => {
    signOut.mockResolvedValue({ url: OTHER_SITE })
    await signOutTo(path)
    expect(loadPage).toHaveBeenCalledWith('/login')
  })
})
