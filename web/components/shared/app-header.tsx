'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Menu, LogOut, LayoutDashboard } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'
import { Routes } from '@/config/routes'
import { Session } from 'next-auth'

// Deliberately minimal: identity and brand only. Navigation lives in the
// sidebar (desktop) and the bottom tab bar (mobile), search in the command
// palette, and the theme control in the sidebar footer.
// Nullable: the root layout renders this for signed-out visitors too, and the
// body already guards with session?.user throughout.
export default function AppHeader({
  session: serverSession,
}: {
  session: Session | null
}) {
  const router = useRouter()
  // The (app) layout that renders this header stays mounted across client
  // navigation, so the server session prop goes stale after an in-app sign in
  // or sign out. The client session follows signIn/signOut immediately.
  const { data: clientSession, status } = useSession()
  const session = status === 'loading' ? serverSession : clientSession

  const handleLogout = () => {
    signOut()
    router.push(Routes.login)
  }

  const isAuthenticated = useMemo(() => session?.user, [session?.user])

  const AuthenticatedMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='relative h-8 gap-2 px-1.5'>
          <Avatar className='h-8 w-8'>
            <AvatarImage
              src={session?.user?.avatar ?? undefined}
              alt={session?.user?.name ?? undefined}
            />
            <AvatarFallback>{session?.user?.name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className='hidden text-sm font-medium md:block'>
            {session?.user?.name?.split(' ')[0]}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56' align='end' forceMount>
        <DropdownMenuItem className='flex flex-col items-start'>
          <div className='font-medium'>{session?.user?.name}</div>
          <div className='text-xs text-muted-foreground'>
            {session?.user?.email}
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={Routes.dashboard} className='flex w-full items-center'>
            <LayoutDashboard className='mr-2 h-4 w-4' />
            <span>Dashboard</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout} className='text-destructive'>
          <LogOut className='mr-2 h-4 w-4' />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // Only unauthenticated visitors need a sheet: signed-in users already have
  // the bottom tab bar for navigation and the avatar menu for identity.
  const SignedOutMobileMenu = () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant='ghost' className='md:hidden' size='icon'>
          <Menu className='h-5 w-5' />
          <span className='sr-only'>Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side='right' className='w-[300px] sm:w-[400px]'>
        <nav aria-label='Account' className='flex flex-col gap-4'>
          <Button asChild variant='ghost' className='justify-start'>
            <Link href={Routes.login}>Log in</Link>
          </Button>
          <Button
            asChild
            className='rounded-full bg-primary text-primary-foreground hover:bg-primary/90'
          >
            <Link href={Routes.register}>Get started</Link>
          </Button>
        </nav>
      </SheetContent>
    </Sheet>
  )

  return (
    <header className='sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/80'>
      <div className='flex h-14 items-center gap-2 px-4'>
        <Link className='flex items-center space-x-2' href={Routes.landingPage}>
          <Image
            src='/images/logo.png'
            alt='textbee Logo'
            width={24}
            height={24}
            className='h-6 w-6 rounded-full bg-white'
          />
          <span className='font-semibold tracking-tight'>
            text<span className='text-primary'>bee</span>
            <span className='align-center text-xs text-muted-foreground'>
              .dev
            </span>
          </span>
        </Link>

        <div className='flex flex-1 items-center justify-end gap-2'>
          {isAuthenticated ? (
            <AuthenticatedMenu />
          ) : (
            <>
              <div className='hidden md:flex md:items-center md:gap-2'>
                <Button asChild variant='ghost'>
                  <Link href={Routes.login}>Log in</Link>
                </Button>
                <Button
                  asChild
                  className='rounded-full bg-primary text-primary-foreground hover:bg-primary/90'
                >
                  <Link href={Routes.register}>Get started</Link>
                </Button>
              </div>
              <SignedOutMobileMenu />
            </>
          )}
        </div>
      </div>
    </header>
  )
}
