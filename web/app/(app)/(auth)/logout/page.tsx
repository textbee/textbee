'use client'

import { Routes } from '@/config/routes'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SIGN_OUT_FAILED_TEXT, signOutTo } from '@/lib/sign-out'

export default function Logout() {
  const session = useSession()
  const router = useRouter()
  const signingOut = useRef(false)
  // The page signs out by itself once; after that only the button retries
  const started = useRef(false)
  const [failed, setFailed] = useState(false)

  // To this site's login page. After a failure the page stays: the login
  // page would send a still signed-in visitor back to the dashboard, whose
  // next 401 would lead here again
  const logOut = useCallback(() => {
    if (signingOut.current) return
    signingOut.current = true
    void signOutTo(Routes.login).then((signedOut) => {
      if (signedOut) return
      signingOut.current = false
      setFailed(true)
    })
  }, [])

  useEffect(() => {
    if (session.status === 'authenticated') {
      if (started.current) return
      started.current = true
      logOut()
    } else if (session.status === 'unauthenticated') {
      router.push(Routes.login)
    }
  }, [router, session.status, logOut])

  if (failed) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center'>
        <p role='alert'>{SIGN_OUT_FAILED_TEXT}</p>
        <Button
          variant='outline'
          onClick={() => {
            setFailed(false)
            logOut()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className='text-center min-h-screen flex items-center justify-center'>
      Logging out...
    </div>
  )
}
