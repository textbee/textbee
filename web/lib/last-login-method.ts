import { useEffect, useState } from 'react'

export type LoginMethod = 'google' | 'password'

const STORAGE_KEY = 'textbee.lastLoginMethod'

// Storage can throw when blocked, and login must work without it.
export function readLastLoginMethod(): LoginMethod | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'google' || value === 'password' ? value : null
  } catch {
    return null
  }
}

export function saveLastLoginMethod(method: LoginMethod) {
  try {
    window.localStorage.setItem(STORAGE_KEY, method)
  } catch {
    // Only a convenience, so a failed write is ignored.
  }
}

// Read after mount so the server and client render the same markup.
export function useLastLoginMethod() {
  const [method, setMethod] = useState<LoginMethod | null>(null)
  useEffect(() => {
    setMethod(readLastLoginMethod())
  }, [])
  return method
}
