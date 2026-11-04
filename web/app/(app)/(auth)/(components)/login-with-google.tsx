'use client'

import { useEffect, useRef, useState } from 'react'
import { Routes } from '@/config/routes'
import { toast } from '@/hooks/use-toast'
import {
  CredentialResponse,
  GoogleLogin,
  GoogleOAuthProvider,
} from '@react-oauth/google'
import { getSession, signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { readAttribution } from '@/lib/analytics/attribution'
import { track } from '@/lib/analytics/track'
import { safeRedirect } from '@/lib/auth-redirect'

// The provider lives here rather than in the app-wide tree so the Google
// Identity SDK is only loaded on the two pages that render this button
// (login and register) instead of on every dashboard page.
export default function LoginWithGoogle() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  // Without a client id there is no Google sign-in to offer, and rendering the
  // provider anyway would load Google's SDK on a self-hosted instance that
  // never configured it.
  if (!clientId) return null

  return (
    <GoogleOAuthProvider clientId={clientId} locale='en'>
      <GoogleLoginButton />
    </GoogleOAuthProvider>
  )
}

function GoogleLoginButton() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const [buttonWidth, setButtonWidth] = useState<number>()

  // Google renders the button at a fixed pixel width between 200 and 400.
  // Small changes are ignored because each new width re-runs One Tap.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const width = Math.min(400, Math.max(200, el.offsetWidth))
      setButtonWidth((prev) =>
        prev && Math.abs(prev - width) < 8 ? prev : width
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onGoogleLoginSuccess = async (
    credentialResponse: CredentialResponse
  ) => {
    // This button also serves /login, so attribution is sent every time and the
    // API applies it only when it creates the account.
    const attribution = readAttribution()
    const destination =
      safeRedirect(redirect, window.location.origin) ?? Routes.dashboard

    // redirect:false on purpose: with redirect:true the browser navigates away
    // and this promise never resolves, so a first sign-in could never be told
    // apart from a returning one.
    const result = await signIn('google-id-token-login', {
      redirect: false,
      idToken: credentialResponse.credential,
      ...(attribution && { attribution: JSON.stringify(attribution) }),
    })

    if (result?.error) {
      toast({
        title: 'Error',
        description: 'Could not sign you in with Google',
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Success',
      description: 'You are logged in with Google',
      variant: 'default',
    })

    const session = await getSession()
    if (session?.user?.isNewUser) track('sign_up', { method: 'google' })

    router.push(destination)
  }

  const onGoogleLoginError = () => {
    toast({
      title: 'Error',
      description: 'Something went wrong',
      variant: 'destructive',
    })
  }
  // Wait for the theme and width so the button and One Tap render only once.
  // A light color-scheme stops the iframe painting a white box in dark mode.
  return (
    <div
      ref={containerRef}
      className='flex min-h-10 w-full justify-center [color-scheme:light]'
    >
      {resolvedTheme && buttonWidth && (
        <GoogleLogin
          onSuccess={onGoogleLoginSuccess}
          onError={onGoogleLoginError}
          useOneTap={true}
          width={buttonWidth}
          size='large'
          shape='rectangular'
          theme={resolvedTheme === 'dark' ? 'filled_black' : 'outline'}
          text='continue_with'
        />
      )}
    </div>
  )
}
