'use client'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTurnstile } from '@/lib/turnstile'

const SupportFormSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  email: z.string().email({ message: 'Invalid email address' }),
  phone: z.string().optional(),
  category: z.enum(['general', 'technical', 'billing-and-payments', 'other'], {
    message: 'Support category is required',
  }),
  message: z.string().min(1, { message: 'Message is required' }),
  turnstileToken: z
    .string()
    .min(1, { message: 'Please complete the bot verification' }),
})

export default function SupportForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitSuccessful, setIsSubmitSuccessful] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const router = useRouter()

  const { data: session } = useSession()

  const form = useForm({
    resolver: zodResolver(SupportFormSchema),
    defaultValues: {
      name: session?.user?.name || '',
      email: session?.user?.email || '',
      phone: session?.user?.phone || '',
      category: 'general',
      message: '',
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

  const onSubmit = async (data: any) => {
    setIsSubmitting(true)
    setErrorMessage(null)

    if (!data.turnstileToken) {
      form.setError('turnstileToken', {
        type: 'manual',
        message: 'Please complete the bot verification',
      })
      setIsSubmitting(false)
      return
    }

    try {
      // Use the existing httpBrowserClient to call the NestJS endpoint
      const response = await httpBrowserClient.post(
        ApiEndpoints.support.customerSupport(),
        data
      )

      setIsSubmitSuccessful(true)

      toast({
        title: 'Support request submitted',
        description: response.data.message || 'We will get back to you soon.',
      })
    } catch (error) {
      console.error('Error submitting support request:', error)

      setErrorMessage(
        'Error submitting support request. Please try again later.'
      )

      toast({
        title: 'Error submitting support request',
        description: 'Please try again later',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <FormField
          control={form.control}
          name='category'
          disabled={isSubmitting}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Support Category</FormLabel>
              <Select
                onValueChange={field.onChange}
                disabled={isSubmitting}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder='Select support category' />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value='general'>General Inquiry</SelectItem>
                  <SelectItem value='technical'>Technical Support</SelectItem>
                  <SelectItem value='billing-and-payments'>
                    Billing and Payments
                  </SelectItem>
                  <SelectItem value='other'>Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='name'
          disabled={isSubmitting}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder='Your name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='email'
          disabled={isSubmitting}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder='your@email.com' type='email' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='phone'
          disabled={isSubmitting}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (Optional)</FormLabel>
              <FormControl>
                <Input placeholder='+1234567890' type='tel' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='message'
          disabled={isSubmitting}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  placeholder='How can we help you?'
                  className='min-h-[100px]'
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
          disabled={isSubmitting}
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
        {isSubmitSuccessful && (
          <div className='flex items-center gap-2 text-success'>
            <Check className='h-4 w-4' /> We have received your message, we will
            get back to you soon.
          </div>
        )}

        {errorMessage && (
          <div className='flex items-center gap-2 text-destructive'>
            <AlertTriangle className='h-4 w-4' /> {errorMessage}
          </div>
        )}
        <Button type='submit' disabled={isSubmitting} className='w-full'>
          {isSubmitting ? (
            <>
              <Loader2 className='h-4 w-4 animate-spin mr-2' /> Submitting...
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </form>
    </Form>
  )
}
