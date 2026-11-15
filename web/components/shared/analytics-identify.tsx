'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { isEnabled } from '@/lib/analytics/config'
import { useCurrentUser } from '@/lib/api'

export default function AnalyticsIdentify() {
  const { data: session } = useSession()
  const hasUser = Boolean(session?.user)
  const { data: currentUser } = useCurrentUser({ enabled: hasUser })
  const userId = (hasUser && currentUser?._id) || session?.user?.id || ''

  useEffect(() => {
    if (!userId || !isEnabled('clarity')) return
    window.clarity?.('set', 'userId', userId)
  }, [userId])

  return null
}
