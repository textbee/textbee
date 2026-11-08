import { cn } from '@/lib/utils'

export default function LastUsedLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full border border-primary bg-card px-2 text-[11px] font-medium leading-4 text-primary',
        className
      )}
    >
      Last used
    </span>
  )
}
