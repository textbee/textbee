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
    await signOutTo()
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(loadPage).toHaveBeenCalledWith('/login')
    expect(loadPage).not.toHaveBeenCalledWith(OTHER_SITE)
  })

  it('keeps a same-site path with its query', async () => {
    signOut.mockResolvedValue({ url: OTHER_SITE })
    await signOutTo('/login?redirect=%2Flink-device')
    expect(loadPage).toHaveBeenCalledWith('/login?redirect=%2Flink-device')
  })

  it('still loads the page when signing out fails', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    await signOutTo('/login')
    expect(loadPage).toHaveBeenCalledWith('/login')
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
