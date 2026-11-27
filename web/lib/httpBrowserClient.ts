import axios from 'axios'
import { getSession } from 'next-auth/react'
import { Routes } from '@/config/routes'
import { signOutTo } from '@/lib/sign-out'

const httpBrowserClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || '',
})

// Navigation seam for testing; defaults to real window.location assignment.
let navigate: (url: string) => void = (url) => {
  if (typeof window !== 'undefined') {
    window.location.href = url
  }
}

export function setNavigate(fn: (url: string) => void) {
  navigate = fn
}

// API access token, seeded from the server-fetched session by Providers and
// kept current by its SessionTokenBridge. Held in module state so the request
// interceptor attaches it synchronously instead of paying a /api/auth/session
// round trip per request (Vercel cost and added latency). undefined means not
// seeded yet; null means known signed out, so auth pages never fetch either.
let sessionToken: string | null | undefined

export function setSessionToken(token: string | null) {
  sessionToken = token
}

// Fallback for the rare request that fires before the token is seeded (deep
// hard load). One shared promise so a burst of queries costs one session call.
let sessionFetch: Promise<string | null> | null = null

function fetchSessionToken() {
  if (!sessionFetch) {
    sessionFetch = getSession()
      .then((session) => {
        sessionToken = session?.user?.accessToken ?? null
        return sessionToken
      })
      .finally(() => {
        sessionFetch = null
      })
  }
  return sessionFetch
}

httpBrowserClient.interceptors.request.use(async (config) => {
  const token =
    sessionToken === undefined ? await fetchSessionToken() : sessionToken

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Global session-expiry handling: only a 401 carrying the API's auth-failure
// code means the stored token is no longer valid, so send the user to logout.
// Other 401s stay with the caller. This replaces the previous per-navigation
// whoAmI check in the layout wrapper.
httpBrowserClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      typeof window !== 'undefined' &&
      error?.response?.status === 401 &&
      error?.response?.data?.code === 'AUTH_INVALID'
    ) {
      const { pathname, search } = window.location
      if (pathname === Routes.linkDevice) {
        // The link page sends the user to log in and come back to it
        setSessionToken(null)
        const back = encodeURIComponent(`${pathname}${search}`)
        // A path on this site; the login library never picks the address
        void signOutTo(`${Routes.login}?redirect=${back}`, {
          loadOnFailure: true,
        })
      } else if (
        !pathname.includes('/logout') &&
        !pathname.includes('/login')
      ) {
        setSessionToken(null)
        navigate('/logout')
      }
    }
    return Promise.reject(error)
  }
)

export default httpBrowserClient
