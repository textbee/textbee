import { Alert, AlertDescription } from '@/components/ui/alert'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { AlertTriangle } from 'lucide-react'

export default function AccountDeletionAlert() {
  const {
    data: userData,
    isLoading: isLoadingUserData,
    error: userDataError,
  } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.auth.whoAmI())
        .then((res) => res.data.data),
  })

  if (isLoadingUserData || !userData || userDataError) {
    return null
  }

  // Only show the alert if the user has requested account deletion
  if (!userData.accountDeletionRequestedAt) {
    return null
  }

  // Calculate days remaining until deletion (assuming 7-day window)
  const deletionDate = new Date(userData.accountDeletionRequestedAt)
  deletionDate.setDate(deletionDate.getDate() + 7)
  const daysRemaining = Math.max(
    0,
    Math.ceil(
      (deletionDate.getTime() - new Date().getTime()) / (1000 * 3600 * 24)
    )
  )

  return (
    <Alert className='border-destructive/30 bg-destructive/[0.07] text-foreground'>
      <AlertDescription className='flex items-center gap-2'>
        <AlertTriangle className='h-5 w-5 flex-shrink-0 text-destructive' />
        <div className='text-sm md:text-base'>
          <span className='font-medium'>Your account is pending deletion.</span>{' '}
          Your data will be permanently deleted{' '}
          {daysRemaining > 0
            ? `in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}.`
            : 'very soon.'}{' '}
          If you would like to cancel this request, please email{' '}
          <span className='font-medium'>support@textbee.dev</span>.
        </div>
      </AlertDescription>
    </Alert>
  )
}
