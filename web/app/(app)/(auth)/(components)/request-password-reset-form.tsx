'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
// import { Icons } from "@/components/ui/icons"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'
import { useTurnstile } from '@/lib/turnstile'

const requestPasswordResetSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  turnstileToken: z
    .string()
    .min(1, { message: 'Please complete the bot verification' }),
})

type RequestPasswordResetFormValues = z.infer<typeof requestPasswordResetSchema>

export default function RequestPasswordResetForm() {
  const form = useForm<RequestPasswordResetFormValues>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: {
      email: '',
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

  const onRequestPasswordReset = async (
    data: RequestPasswordResetFormValues
  ) => {
    form.clearErrors()

    if (!data.turnstileToken) {
      form.setError('turnstileToken', {
        type: 'manual',
        message: 'Please complete the bot verification',
      })
      return
    }

    try {
      await httpBrowserClient.post(
        ApiEndpoints.auth.requestPasswordReset(),
        data
      )
    } catch (error) {
      form.setError('email', { message: 'Invalid email address' })
    }
  }

  return (
    <div className='flex items-center justify-center min-h-screen bg-background'>
      <Card className='w-full max-w-[400px]'>
        <CardHeader className='space-y-1'>
          <CardTitle className='text-2xl font-semibold text-center'>
            Reset your password
          </CardTitle>
          <CardDescription className='text-center'>
            Enter your email address and we&apos;ll send you a link to reset
            your password
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!form.formState.isSubmitted ? (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onRequestPasswordReset)}
                className='space-y-4'
              >
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
                <Button
                  className='w-full'
                  type='submit'
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? (
                    <>
                      {/* <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> */}
                      Sending reset link...
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </Button>
              </form>
            </Form>
          ) : (
            <Alert>
              {/* <Icons.checkCircle className="h-4 w-4" /> */}
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>
                If an account exists for {form.getValues().email}, you will
                receive a password reset link shortly.
              </AlertDescription>
              <AlertDescription className='mt-4 text-sm text-muted-foreground italic'>
                If you don&apos;t receive an email, please check your spam
                folder or contact support.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className='text-center'>
          <Link
            href={Routes.login}
            className='text-sm text-primary hover:underline'
          >
            Back to login
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
