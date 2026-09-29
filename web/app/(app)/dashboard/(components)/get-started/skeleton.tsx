import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Compact loading placeholder (fixed low height): the checklist renders only
// once real data arrives, so this must not dominate the page like the old
// full-height 6-row skeleton did.
export default function GetStartedCardSkeleton() {
  return (
    <Card className='border-primary/15'>
      <CardContent className='flex h-[90px] flex-col justify-center gap-3 py-4'>
        <div className='flex items-center justify-between'>
          <Skeleton className='h-4 w-36' />
          <Skeleton className='h-4 w-14' />
        </div>
        <Skeleton className='h-1.5 w-full rounded-full' />
      </CardContent>
    </Card>
  )
}
