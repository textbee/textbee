'use client'

import { useEffect } from 'react'
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
import { signIn } from 'next-auth/react'
import { Checkbox } from '@/components/ui/checkbox'
import { Routes } from '@/config/routes'
import { useTurnstile } from '@/lib/turnstile'
import { readAttribution } from '@/lib/analytics/attribution'
import { track } from '@/lib/analytics/track'

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
        track('sign_up', { method: 'email' })
        router.push(`${Routes.verifyEmail}?verificationEmailSent=1`)
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
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder='John Doe' {...field} />
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
                <Input placeholder='m@example.com' {...field} />
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
                <Input type='password' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='phone'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (optional)</FormLabel>
              <FormControl>
                <Input placeholder='+1 (555) 000-0000' {...field} />
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

        <FormField
          control={form.control}
          name='marketingOptIn'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-center space-x-3 space-y-0'>
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className='text-sm'>
                  I want to receive updates about new features and promotions
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          className='w-full'
          type='submit'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              {/* <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> */}
              Creating account...
            </>
          ) : (
            'Sign Up'
          )}
        </Button>
      </form>
    </Form>
  )
}
