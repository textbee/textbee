'use client'

import { Routes } from '@/config/routes'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { signOutTo } from '@/lib/sign-out'

export default function Logout() {
  const session = useSession()
  const router = useRouter()
  const signingOut = useRef(false)
  useEffect(() => {
    if (session.status === 'authenticated') {
      // Once, and to this site's login page
      if (signingOut.current) return
      signingOut.current = true
      void signOutTo(Routes.login)
    } else if (session.status === 'unauthenticated') {
      router.push(Routes.login)
    }
  }, [router, session.status])

  return (
    <div className='text-center min-h-screen flex items-center justify-center'>
      Logging out...
    </div>
  )
}
