'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2 } from 'lucide-react'
import type { AxiosError } from 'axios'
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
import { toast } from '@/hooks/use-toast'
import { useCorrectEmail, useCorrectEmailEligibility } from '@/lib/api'
import { suggestEmail } from '@/lib/email-typo'
import { apiErrorText } from '@/lib/utils/errorHandler'
import {
  isSupportChatEnabled,
  openSupportChat,
} from '@/components/shared/support-hq-widget'
import PasswordInput from '../(components)/password-input'
import EmailTypoHint from '../(components)/email-typo-hint'
import { authButtonClass, authFieldClass } from '../(components)/auth-styles'

const textButtonClass =
  'font-medium text-primary underline-offset-4 hover:underline'

const correctEmailSchema = z.object({
  newEmail: z.string().trim().email({ message: 'Invalid email address' }),
  currentPassword: z.string().min(1, { message: 'Enter your password' }),
})

type CorrectEmailValues = z.infer<typeof correctEmailSchema>

function CorrectEmailForm({
  defaultEmail,
  onDone,
  onCancel,
}: {
  defaultEmail: string
  onDone: () => void
  onCancel: () => void
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const { mutateAsync: correctEmail } = useCorrectEmail()

  const form = useForm<CorrectEmailValues>({
    resolver: zodResolver(correctEmailSchema),
    defaultValues: { newEmail: defaultEmail, currentPassword: '' },
  })

  useEffect(() => {
    form.setFocus('newEmail')
  }, [form])

  const onSubmit = async (values: CorrectEmailValues) => {
    try {
      const { message, email, sent } = await correctEmail(values)
      toast({
        title: sent ? `Email changed. We sent a link to ${email}.` : message,
      })
      onDone()
    } catch (error) {
      const text = apiErrorText(error, 'Could not change your email. Try again.')
      const status = (error as AxiosError)?.response?.status
      if (text === 'Your password is incorrect.') {
        form.setError('currentPassword', { type: 'server', message: text })
      } else if (status === 400 || text.startsWith('This email is already in use')) {
        form.setError('newEmail', { type: 'server', message: text })
      } else {
        form.setError('root', { type: 'server', message: text })
      }
    }
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          setSuggestion(suggestEmail(form.getValues('newEmail')))
          return form.handleSubmit(onSubmit)(event)
        }}
        className='space-y-4 rounded-md border p-4'
      >
        <FormField
          control={form.control}
          name='newEmail'
          render={({ field }) => (
            <FormItem>
              <FormLabel>New email</FormLabel>
              <FormControl>
                <Input
                  type='email'
                  autoComplete='email'
                  className={authFieldClass}
                  {...field}
                  onChange={(event) => {
                    field.onChange(event)
                    setSuggestion(null)
                  }}
                  onBlur={() => {
                    field.onBlur()
                    setSuggestion(suggestEmail(field.value))
                  }}
                />
              </FormControl>
              <EmailTypoHint
                suggestion={suggestion}
                onUse={(value) => {
                  form.setValue('newEmail', value, {
                    shouldDirty: true,
                    shouldValidate: form.formState.isSubmitted,
                  })
                  setSuggestion(null)
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='currentPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='current-password'
                  className={authFieldClass}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-sm text-muted-foreground'>
          We will send a new verification link to this address.
        </p>
        <div aria-live='polite'>
          {form.formState.errors.root && (
            <p className='text-sm font-medium text-destructive'>
              {form.formState.errors.root.message}
            </p>
          )}
        </div>
        <Button
          type='submit'
          className={authButtonClass}
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting && (
            <Loader2 className='animate-spin' aria-hidden />
          )}
          Change email and send link
        </Button>
        <Button
          type='button'
          variant='ghost'
          className='w-full'
          disabled={form.formState.isSubmitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </form>
    </Form>
  )
}

function ContactSupport() {
  return (
    <p className='text-sm text-muted-foreground'>
      Wrong email?{' '}
      {isSupportChatEnabled() ? (
        <button type='button' className={textButtonClass} onClick={openSupportChat}>
          Contact support
        </button>
      ) : (
        <Link href='/dashboard/account/support' className={textButtonClass}>
          Contact support
        </Link>
      )}
    </p>
  )
}

// Address line, typo warning and the self-serve fix for an unverified account.
export default function EmailAddressSection({
  email,
  startOpen = false,
  onChanged,
}: {
  email: string
  startOpen?: boolean
  onChanged?: () => void
}) {
  const { data: eligibility } = useCorrectEmailEligibility({ retry: false })
  const [formEmail, setFormEmail] = useState<string | null>(
    startOpen ? '' : null
  )

  const suggestion = suggestEmail(email)
  const eligible = eligibility?.eligible === true
  const contactSupport =
    eligibility?.reason === 'has_activity' ||
    eligibility?.reason === 'not_available'
  const formOpen = eligible && formEmail !== null

  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        We sent a verification link to{' '}
        <strong className='font-semibold text-foreground'>{email}</strong>.
        Check your inbox and spam.
      </p>
      {suggestion && !formOpen && (
        <div className='space-y-2 rounded-md border bg-muted/40 p-3 text-sm'>
          <p>This address looks like a typo. Did you mean {suggestion}?</p>
          {eligible && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setFormEmail(suggestion)}
            >
              Change to {suggestion}
            </Button>
          )}
        </div>
      )}
      {formOpen && formEmail !== null ? (
        <CorrectEmailForm
          key={formEmail}
          defaultEmail={formEmail}
          onDone={() => {
            setFormEmail(null)
            onChanged?.()
          }}
          onCancel={() => setFormEmail(null)}
        />
      ) : eligible ? (
        <p className='text-sm text-muted-foreground'>
          Wrong email?{' '}
          <button
            type='button'
            className={textButtonClass}
            onClick={() => setFormEmail('')}
          >
            Change it
          </button>
        </p>
      ) : contactSupport ? (
        <ContactSupport />
      ) : null}
    </div>
  )
}
