'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotificationProvider } from '@/components/notifications/notification-provider'
import { NotificationTileStack } from '@/components/notifications/notification-tile-stack'
import { NotificationModalHost } from '@/components/notifications/notification-modal-host'
import Footer from '@/components/shared/footer'
import ThemeToggle from '@/components/shared/theme-toggle'
import BreadcrumbNav from './(components)/breadcrumb-nav'
import CommandMenu from './(components)/search/command-menu'
import SearchTrigger from './(components)/search/search-trigger'
import {
  isNavItemActive,
  mobileNavItems,
  navItems,
  type NavItem,
} from './(components)/nav-items'
import { cn } from '@/lib/utils'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // Owned here, not inside the palette, so both the sidebar trigger (desktop)
  // and the app header search button (mobile) open the same dialog.
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    // One feed query, shared by the tile slot and the modal host, so they cannot
    // disagree about which implementation is live.
    <NotificationProvider>
    <div className='min-h-[calc(100vh-3.5rem)]'>
      {/* Visible only on focus. Without it, keyboard users tab through the
          whole sidebar on every page before reaching the content. */}
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
      >
        Skip to content
      </a>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Desktop sidebar, sits below the sticky app header (h-14). */}
      <aside className='fixed inset-y-0 left-0 top-14 z-30 hidden w-60 flex-col border-r border-border bg-shell md:flex'>
        <div className='flex-1 overflow-y-auto px-3 py-4'>
          <div className='mb-4'>
            <SearchTrigger onOpen={() => setSearchOpen(true)} />
          </div>
          {/* Distinct labels: several nav landmarks on one page are otherwise
              indistinguishable in a screen reader's landmark list. */}
          <nav className='flex flex-col gap-1' aria-label='Main'>
            {navItems.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                isActive={isNavItemActive(item, pathname)}
              />
            ))}
          </nav>
        </div>
        <div className='space-y-3 border-t border-border px-4 py-3'>
          <p className='text-xs text-muted-foreground'>
            Need help?{' '}
            <a
              href='https://textbee.dev/quickstart'
              target='_blank'
              rel='noreferrer'
              className='font-medium text-primary hover:underline'
            >
              Quick start
            </a>
          </p>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content, offset for the fixed sidebar on desktop. */}
      <div className='md:pl-60'>
        <BreadcrumbNav />
        <NotificationTileStack />
        <main id='main-content' tabIndex={-1}>
          {children}
        </main>
        {/* Inside the sidebar-offset column so the fixed sidebar cannot paint
            over it, and padded clear of the fixed mobile tab bar. */}
        <div className='pb-20 pt-8 md:pb-0'>
          <Footer />
        </div>
      </div>

      {/* Mobile bottom tab bar (max 4 items; the rest are desktop/palette only). */}
      <nav
        aria-label='Primary (mobile)'
        className='fixed inset-x-0 bottom-0 z-40 border-t border-border bg-shell/95 backdrop-blur supports-[backdrop-filter]:bg-shell/85 md:hidden'
      >
        <div className='flex h-16 items-center justify-around'>
          {mobileNavItems.map((item) => (
            <MobileNavLink
              key={item.href}
              item={item}
              isActive={isNavItemActive(item, pathname)}
            />
          ))}
        </div>
      </nav>

      <NotificationModalHost />
    </div>
    </NotificationProvider>
  )
}

function SidebarLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      prefetch
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-card text-primary shadow-[0_0_0_1px_hsl(var(--border))]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className='h-[18px] w-[18px] shrink-0 stroke-[1.75]' />
      <span>{item.label}</span>
    </Link>
  )
}

function MobileNavLink({
  item,
  isActive,
}: {
  item: NavItem
  isActive: boolean
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      prefetch
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
        isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className='h-5 w-5 stroke-[1.75]' />
      <span>{item.label}</span>
    </Link>
  )
}
