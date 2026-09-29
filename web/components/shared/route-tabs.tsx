'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export type RouteTab = {
  href: string
  label: string
  // Exact-match only (used for index routes like /dashboard/messaging so they
  // don't stay active on sibling subroutes).
  exact?: boolean
}

function isTabActive(tab: RouteTab, pathname: string): boolean {
  if (tab.exact) return pathname === tab.href
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`)
}

// Link-based segmented control: tabs are real routes, so the active tab
// survives refresh and deep links are shareable. Mobile: horizontally
// scrollable pills; the active pill scrolls into view on load. Links opt into
// full prefetch because these routes are dynamic (session cookie in the app
// layout), which the router's default prefetch skips.
export default function RouteTabs({
  tabs,
  className,
}: {
  tabs: RouteTab[]
  className?: string
}) {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement | null>(null)
  const activeRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    // Deep links must land with the selected pill visible on small screens.
    // Strip only: scrollIntoView also scrolled the page past the breadcrumbs.
    const nav = navRef.current
    const active = activeRef.current
    if (!nav || !active) return
    const navBox = nav.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    nav.scrollLeft +=
      activeBox.left + activeBox.width / 2 - (navBox.left + navBox.width / 2)
  }, [pathname])

  return (
    <nav
      ref={navRef}
      className={cn(
        'flex gap-1 overflow-x-auto rounded-xl border bg-shell p-1',
        'scrollbar-none w-full sm:w-fit',
        className
      )}
      aria-label='Section navigation'
    >
      {tabs.map((tab) => {
        const active = isTabActive(tab, pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            ref={active ? activeRef : undefined}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border)),0_1px_2px_rgb(0_0_0/0.08)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
