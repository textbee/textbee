'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PasswordInput from './password-input'
import { authButtonClass, authFieldClass } from './auth-styles'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Routes } from '@/config/routes'
import { useTurnstile } from '@/lib/turnstile'
import { redirectFromLocation } from '@/lib/auth-redirect'
import { saveLastLoginMethod, useLastLoginMethod } from '@/lib/last-login-method'
import LastUsedLabel from './last-used-label'

const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
  turnstileToken: z
    .string()
    .min(1, { message: 'Please complete the bot verification' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginForm() {
  const router = useRouter()
  const lastMethod = useLastLoginMethod()

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      turnstileToken: '',
    },
  })

  const {
    containerRef: turnstileRef,
    token: turnstileToken,
    error: turnstileError,
  } = useTurnstile({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    onToken: (token) =>
      form.setValue('turnstileToken', token, { shouldValidate: true }),
    onError: (message) =>
      form.setError('turnstileToken', { type: 'manual', message }),
    onExpire: (message) =>
      form.setError('turnstileToken', { type: 'manual', message }),
  })

  useEffect(() => {
    if (turnstileToken) {
      form.clearErrors('turnstileToken')
    }
  }, [turnstileToken, form])

  useEffect(() => {
    if (turnstileError) {
      form.setError('turnstileToken', { type: 'manual', message: turnstileError })
    }
  }, [turnstileError, form])

  const onSubmit = async (data: LoginFormValues) => {
    form.clearErrors()

    if (!data.turnstileToken) {
      form.setError('turnstileToken', {
        type: 'manual',
        message: 'Please complete the bot verification',
      })
      return
    }

    try {
      // redirect:false so the result is returned here. With redirect:true
      // next-auth navigates on both success and failure, which reloaded the
      // page and made the error branch below dead code.
      const result = await signIn('email-password-login', {
        redirect: false,
        email: data.email,
        password: data.password,
        turnstileToken: data.turnstileToken,
      })

      if (result?.error) {
        form.setError('root', {
          type: 'manual',
          message:
            lastMethod === 'google' && process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
              ? 'Invalid email or password. You last logged in with Google on this browser.'
              : 'Invalid email or password',
        })
        return
      }

      saveLastLoginMethod('password')
      router.push(redirectFromLocation() ?? Routes.dashboard)
      router.refresh()
    } catch (error) {
      console.error('login error:', error)
      form.setError('root', {
        type: 'manual',
        message: 'An unexpected error occurred. Please try again.',
      })
    }
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className='space-y-4'
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <div className='flex min-h-5 items-center justify-between gap-3'>
                <FormLabel>Email</FormLabel>
                {lastMethod === 'password' && <LastUsedLabel />}
              </div>
              <FormControl>
                <Input
                  type='email'
                  autoComplete='email'
                  placeholder='you@company.com'
                  className={authFieldClass}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-center justify-between gap-3'>
                <FormLabel>Password</FormLabel>
                <Link
                  href={Routes.resetPassword}
                  className='text-sm font-medium text-primary underline-offset-4 hover:underline'
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <PasswordInput
                  autoComplete='current-password'
                  placeholder='Enter your password'
                  className={authFieldClass}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='turnstileToken'
          render={() => (
            <FormItem>
              <FormControl>
                <div
                  ref={turnstileRef}
                  className='min-h-[65px] w-full flex justify-center'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p className='text-sm font-medium text-destructive'>
            {form.formState.errors.root.message}
          </p>
        )}
        <Button
          className={authButtonClass}
          type='submit'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className='animate-spin' aria-hidden />
              Logging in...
            </>
          ) : (
            'Log in'
          )}
        </Button>
      </form>
    </Form>
  )
}
