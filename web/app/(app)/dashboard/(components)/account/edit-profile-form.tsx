'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Shield, Loader2, Mail, Check, UserCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useToast } from '@/hooks/use-toast'
import { useCurrentUser, useUpdateProfile, useSendEmailVerification } from '@/lib/api'
import { Spinner } from '@/components/ui/spinner'
import { useSession } from 'next-auth/react'

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional(),
  phone: z
    .string()
    .regex(/^\+?\d{0,14}$/, 'Invalid phone number')
    .optional(),
})

type UpdateProfileFormData = z.infer<typeof updateProfileSchema>

export default function EditProfileForm() {
  const { toast } = useToast()
  const { update: updateSession } = useSession()

  const {
    data: currentUser,
    isLoading: isLoadingUser,
    refetch: refetchCurrentUser,
  } = useCurrentUser()

  const updateProfileForm = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: currentUser?.name,
      email: currentUser?.email,
      phone: currentUser?.phone,
    },
  })

  const sendEmailVerification = useSendEmailVerification({
    onSuccess: () => {
      toast({
        title: 'Verification email sent!',
        description: 'Check your inbox for the verification link.',
      })
    },
    onError: () => {
      toast({
        title: 'Failed to send verification email',
        variant: 'destructive',
      })
    },
  })

  const handleVerifyEmail = () => {
    sendEmailVerification.mutate()
  }

  const {
    mutate: updateProfile,
    isPending: isUpdatingProfile,
    error: updateProfileError,
    isSuccess: isUpdateProfileSuccess,
  } = useUpdateProfile({
    onSuccess: () => {
      refetchCurrentUser()
      toast({
        title: 'Profile updated successfully!',
      })
      updateSession({
        name: updateProfileForm.getValues().name,
        phone: updateProfileForm.getValues().phone,
      })
    },
    onError: () => {
      toast({
        title: 'Failed to update profile',
      })
    },
  })

  if (isLoadingUser)
    return (
      <div className='flex justify-center items-center h-full min-h-[200px]'>
        <Spinner size='sm' />
      </div>
    )

  return (
    <form
      onSubmit={updateProfileForm.handleSubmit((data) => updateProfile(data))}
      className='space-y-4'
    >
      <div className='space-y-2'>
        <Label htmlFor='name'>Full Name</Label>
        <Input
          id='name'
          {...updateProfileForm.register('name')}
          placeholder='Enter your full name'
          defaultValue={currentUser?.name}
        />
        {updateProfileForm.formState.errors.name && (
          <p className='text-sm text-destructive'>
            {updateProfileForm.formState.errors.name.message}
          </p>
        )}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='email' className='flex items-center gap-2'>
          Email Address
          {currentUser?.emailVerifiedAt && (
            <Badge variant='secondary' className='ml-2'>
              <Shield className='h-3 w-3 mr-1' />
              Verified
            </Badge>
          )}
        </Label>
        <div className='flex gap-2'>
          <Input
            id='email'
            type='email'
            {...updateProfileForm.register('email')}
            placeholder='Enter your email'
            defaultValue={currentUser?.email}
            disabled
          />
          {!currentUser?.emailVerifiedAt ? (
            <Button
              type='button'
              variant='outline'
              onClick={handleVerifyEmail}
              disabled={sendEmailVerification.isPending}
            >
              {sendEmailVerification.isPending ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Mail className='h-4 w-4 mr-2' />
              )}
              Verify
            </Button>
          ) : (
            <Button variant='outline' disabled>
              <Check className='h-4 w-4 mr-2' />
              Verified
            </Button>
          )}
        </div>
        {updateProfileForm.formState.errors.email && (
          <p className='text-sm text-destructive'>
            {updateProfileForm.formState.errors.email.message}
          </p>
        )}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='phone'>Phone Number</Label>
        <Input
          id='phone'
          type='tel'
          {...updateProfileForm.register('phone')}
          placeholder='Enter your phone number'
          defaultValue={currentUser?.phone}
        />
        {updateProfileForm.formState.errors.phone && (
          <p className='text-sm text-destructive'>
            {updateProfileForm.formState.errors.phone.message}
          </p>
        )}
      </div>

      {isUpdateProfileSuccess && (
        <p className='text-sm text-green-500'>
          Profile updated successfully!
        </p>
      )}

      <Button
        type='submit'
        className='w-full mt-6'
        disabled={isUpdatingProfile}
      >
        {isUpdatingProfile ? (
          <Loader2 className='h-4 w-4 animate-spin mr-2' />
        ) : null}
        Save Changes
      </Button>
    </form>
  )
} 