'use client'

import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import LoginWithGoogle from '../(components)/login-with-google'
import RegisterForm from '../(components)/register-form'
import { Routes } from '@/config/routes'
import { useSearchParams } from 'next/navigation'

export default function RegisterPage() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')

  return (
    <div className='flex items-center justify-center min-h-screen bg-background'>
      <Card className='w-full max-w-[450px]'>
        <CardHeader className='space-y-1'>
          <CardTitle className='text-2xl font-semibold text-center'>
            Create an account
          </CardTitle>
          <CardDescription className='text-center'>
            Enter your details to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
          <div className='relative mt-4'>
            <div className='absolute inset-0 flex items-center'>
              <span className='w-full border-t' />
            </div>
            <div className='relative flex justify-center text-xs uppercase'>
              <span className='bg-card px-2 font-mono text-[11px] text-muted-foreground'>
                Or
              </span>
            </div>
          </div>
          <div className='mt-4 flex justify-center'>
            <LoginWithGoogle />
          </div>
        </CardContent>
        <CardFooter className='text-center'>
          <p className='text-sm text-muted-foreground'>
            Already have an account?{' '}
            <Link
              href={{
                pathname: Routes.login,
                query: {
                  redirect: redirect ? decodeURIComponent(redirect) : undefined,
                },
              }}
              className='font-medium text-primary hover:underline'
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
