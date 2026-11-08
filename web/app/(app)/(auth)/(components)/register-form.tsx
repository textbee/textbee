'use client'

import { useEffect } from 'react'
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { signIn } from 'next-auth/react'
import { Checkbox } from '@/components/ui/checkbox'
import { Routes } from '@/config/routes'
import { useTurnstile } from '@/lib/turnstile'
import { readAttribution } from '@/lib/analytics/attribution'
import { track } from '@/lib/analytics/track'
import { redirectFromLocation } from '@/lib/auth-redirect'
import { saveLastLoginMethod } from '@/lib/last-login-method'

const registerSchema = z.object({
  name: z
    .string()
    .min(2, { message: 'Name must be at least 2 characters long' }),
  email: z.string().email({ message: 'Invalid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' }),
  phone: z.string().optional(),
  marketingOptIn: z.boolean().optional().default(true),
  turnstileToken: z
    .string()
    .min(1, { message: 'Please complete the bot verification' }),
})

// marketingOptIn is `.optional().default(true)`, so zod's input and output
// types differ: optional going in, guaranteed coming out. The form holds the
// input shape and the submit handler receives the output shape, which is what
// useForm's third generic is for. Using z.infer (the output) for both made the
// resolver unassignable.
type RegisterFormInput = z.input<typeof registerSchema>
type RegisterFormValues = z.output<typeof registerSchema>

export default function RegisterForm() {
  const router = useRouter()

  const form = useForm<RegisterFormInput, unknown, RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      phone: '',
      marketingOptIn: true,
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

  const onSubmit = async (data: RegisterFormValues) => {
    form.clearErrors()

    if (!data.turnstileToken) {
      form.setError('turnstileToken', {
        type: 'manual',
        message: 'Please complete the bot verification',
      })
      return
    }

    // Spread conditionally: next-auth serialises these options through
    // URLSearchParams, so an undefined value would arrive as the string
    // "undefined" and fail to parse on the other side.
    const attribution = readAttribution()

    try {
      const result = await signIn('email-password-register', {
        redirect: false,
        email: data.email,
        password: data.password,
        name: data.name,
        phone: data.phone,
        marketingOptIn: data.marketingOptIn,
        ...(attribution && { attribution: JSON.stringify(attribution) }),
        turnstileToken: data.turnstileToken,
      })

      if (result?.error) {
        console.log(result.error)
        form.setError('root', {
          type: 'manual',
          message: 'Failed to create account',
        })
      } else {
        saveLastLoginMethod('password')
        track('sign_up', { method: 'email' })
        router.push(
          redirectFromLocation() ?? `${Routes.verifyEmail}?verificationEmailSent=1`
        )
      }
    } catch (error) {
      console.error('register error:', error)
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
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input
                  autoComplete='name'
                  placeholder='Jane Cooper'
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
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
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
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  placeholder='Create a password'
                  className={authFieldClass}
                  {...field}
                />
              </FormControl>
              <FormDescription>At least 8 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='phone'
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Phone{' '}
                <span className='font-normal text-muted-foreground'>
                  (optional)
                </span>
              </FormLabel>
              <FormControl>
                <Input
                  type='tel'
                  autoComplete='tel'
                  placeholder='+1 202 555 0123'
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
          name='marketingOptIn'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-start gap-3 space-y-0'>
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className='mt-0.5'
                  />
                </FormControl>
                <FormLabel className='text-sm font-normal leading-5 text-muted-foreground'>
                  Email me about new features and offers
                </FormLabel>
              </div>
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
              Creating account...
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </form>
    </Form>
  )
}
