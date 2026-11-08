'use client'

import { useSearchParams } from 'next/navigation'

import AuthShell from '../(components)/auth-shell'
import LoginForm from '../(components)/login-form'
import { Routes } from '@/config/routes'

export default function LoginPage() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')

  return (
    <AuthShell
      title='Welcome back'
      description='Log in to manage your devices and messages.'
      switchPrompt='New to textbee?'
      switchLabel='Create an account'
      showLastUsed
      switchHref={{
        pathname: Routes.register,
        query: {
          redirect: redirect ? decodeURIComponent(redirect) : undefined,
        },
      }}
    >
      <LoginForm />
    </AuthShell>
  )
}
