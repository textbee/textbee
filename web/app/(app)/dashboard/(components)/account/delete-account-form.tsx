'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useMutation } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTurnstile } from '@/lib/turnstile'
import { useCurrentUser } from '@/lib/api'

export default function DeleteAccountForm() {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleteReason, setDeleteReason] = useState('')
  const [turnstileError, setTurnstileError] = useState<string | null>(null)
  const { toast } = useToast()

  const { data: currentUser } = useCurrentUser()

  const {
    containerRef: turnstileRef,
    token: turnstileToken,
    error: turnstileHookError,
  } = useTurnstile({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  })

  useEffect(() => {
    if (turnstileToken) {
      setTurnstileError(null)
    }
  }, [turnstileToken])

  useEffect(() => {
    if (turnstileHookError) {
      setTurnstileError(turnstileHookError)
    }
  }, [turnstileHookError])

  const handleDeleteAccount = () => {
    if (deleteConfirmEmail !== currentUser?.email) {
      toast({
        title: 'Please enter your correct email address',
      })
      return
    } else if (deleteReason.length < 4) {
      toast({
        title: 'Please enter a reason for deletion',
      })
      return
    } else if (!turnstileToken) {
      setTurnstileError('Please complete the bot verification')
      return
    }
    requestAccountDeletion()
  }

  const {
    mutate: requestAccountDeletion,
    isPending: isRequestingAccountDeletion,
    error: requestAccountDeletionError,
    isSuccess: isRequestAccountDeletionSuccess,
  } = useMutation({
    mutationFn: () =>
      httpBrowserClient.post(ApiEndpoints.support.requestAccountDeletion(), {
        message: deleteReason,
        turnstileToken,
      }),
    onSuccess: () => {
      toast({
        title: 'Account deletion request submitted',
      })
      setIsDeleteDialogOpen(false)
    },
    onError: () => {
      toast({
        title: 'Failed to submit account deletion request',
      })
    },
  })

  return (
    <>
      <p className='text-sm text-muted-foreground mb-6'>
        Once you delete your account, there is no going back. This action
        permanently removes all your data, cancels subscriptions, and revokes
        access to all services.
      </p>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <Button
          variant='destructive'
          className='w-full'
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <AlertTriangle className='mr-2 h-4 w-4' />
          Delete Account
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <AlertTriangle className='h-5 w-5 text-destructive' />
              Delete Account
            </DialogTitle>
            {/* Description holds prose only. The form controls used to live
                inside it, and Radix points the dialog's aria-describedby here,
                so opening the dialog read the labels, placeholders and all
                back as one long description string. */}
            <DialogDescription className='pt-4'>
              <p className='mb-4'>
                Are you sure you want to delete your account? This action:
              </p>
              <ul className='list-disc list-inside space-y-2'>
                <li>Cannot be undone</li>
                <li>Will permanently delete all your data</li>
                <li>Will cancel all active subscriptions</li>
                <li>Will remove access to all services</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='deleteReason'>Reason for deletion</Label>
              {/* htmlFor pointed at an id this field never had, so the label
                  was decorative and the textarea was announced unlabelled. */}
              <Textarea
                id='deleteReason'
                placeholder='Enter your reason for deletion'
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='deleteConfirmEmail'>
                Type your email address to confirm
              </Label>
              <Input
                id='deleteConfirmEmail'
                type='email'
                autoComplete='off'
                placeholder='Enter your email address'
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <div
                ref={turnstileRef}
                className='min-h-[65px] w-full flex justify-center'
              />
              {turnstileError && (
                <p role='alert' className='text-sm text-destructive'>
                  {turnstileError}
                </p>
              )}
            </div>

            {requestAccountDeletionError && (
              <p role='alert' className='text-sm text-destructive'>
                {(requestAccountDeletionError as any).response?.data?.message ||
                  requestAccountDeletionError.message ||
                  'Failed to submit account deletion request'}
              </p>
            )}

            {isRequestAccountDeletionSuccess && (
              <p role='status' className='text-sm text-success'>
                Account deletion request submitted
              </p>
            )}
          </div>

          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              variant='outline'
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteAccount}
              disabled={isRequestingAccountDeletion || !deleteConfirmEmail}
            >
              {isRequestingAccountDeletion ? (
                <Loader2 className='h-4 w-4 animate-spin mr-2' />
              ) : (
                <AlertTriangle className='h-4 w-4 mr-2' />
              )}
              Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
