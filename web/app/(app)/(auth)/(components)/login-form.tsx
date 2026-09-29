'use client'

import { useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
          message: 'Invalid email or password',
        })
        return
      }

      router.push(Routes.dashboard)
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
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  placeholder='m@example.com'
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
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type='password'
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
          className='w-full'
          type='submit'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              {/* <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> */}
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </Button>
      </form>
    </Form>
  )
}
