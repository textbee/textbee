'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CircleDollarSign,
  Heart,
  MessageSquare,
  Star,
  Coins,
  Check,
  Copy,
} from 'lucide-react'
import { Github } from '@/components/shared/brand-icons'
import Link from 'next/link'
import { ExternalLinks } from '@/config/external-links'
import { CRYPTO_ADDRESSES } from '@/lib/constants'
import Image from 'next/image'
import { useCurrentUser, useSubscription } from '@/lib/api'

// Add constants for localStorage and timing
const STORAGE_KEYS = {
  LAST_SHOWN: 'contribute_modal_last_shown',
  HAS_CONTRIBUTED: 'contribute_modal_has_contributed',
}

const SHOW_INTERVAL = 1 * 24 * 60 * 60 * 1000 // 1 days in milliseconds
const RANDOM_CHANCE = 0.3 // 30% chance to show when eligible

export function ContributeModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [cryptoOpen, setCryptoOpen] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState('')

  const copyToClipboard = (address: string) => {
    navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(''), 3000)
  }

  const {
    data: currentSubscription,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useSubscription()

  const {
    data: currentUser,
    isLoading: isLoadingUser,
    error: currentUserError,
  } = useCurrentUser()

  useEffect(() => {
    const checkAndShowModal = () => {
      if (isLoadingSubscription || isLoadingUser) return
      if (subscriptionError || currentUserError) return

      if (currentSubscription?.plan?.name?.toLowerCase() !== 'free') {
        return
      }

      // Check if user account is less than 3 days old
      if (currentUser?.createdAt) {
        const createdAt = new Date(currentUser?.createdAt)
        const now = new Date()
        const daysSinceCreation =
          (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)

        if (daysSinceCreation < 3) {
          return // Don't show modal for new users
        }
      }

      const hasContributed =
        localStorage.getItem(STORAGE_KEYS.HAS_CONTRIBUTED) === 'true'
      if (hasContributed) return

      const lastShown = localStorage.getItem(STORAGE_KEYS.LAST_SHOWN)
      const now = Date.now()

      if (!lastShown || now - parseInt(lastShown) >= SHOW_INTERVAL) {
        if (Math.random() < RANDOM_CHANCE) {
          setIsOpen(true)
          localStorage.setItem(STORAGE_KEYS.LAST_SHOWN, now.toString())
        }
      }
    }

    checkAndShowModal()

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkAndShowModal()
      }
    })
  }, [
    currentSubscription,
    currentUser,
    currentUserError,
    isLoadingSubscription,
    isLoadingUser,
    subscriptionError,
  ])

  const handleContributed = () => {
    localStorage.setItem(STORAGE_KEYS.HAS_CONTRIBUTED, 'true')
    setIsOpen(false)
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className='max-w-md max-h-[90vh] overflow-y-auto flex flex-col'>
          <DialogHeader>
            <DialogTitle>Support textbee.dev</DialogTitle>
            <DialogDescription>
              Your contribution helps keep this project alive and growing.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-6 flex-1'>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-lg'>
                  <CircleDollarSign className='h-5 w-5' />
                  Financial Support
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='space-y-4'>
                  <Button className='w-full' asChild>
                    <Link href={ExternalLinks.patreon} target='_blank'>
                      <Heart className='mr-2 h-4 w-4' />
                      Monthly Support on Patreon
                    </Link>
                  </Button>
                  <Button variant='outline' className='w-full' asChild>
                    <Link href={ExternalLinks.polar} target='_blank'>
                      <Star className='mr-2 h-4 w-4' />
                      One-time Donation via Polar.sh
                    </Link>
                  </Button>
                  <Button
                    variant='outline'
                    className='w-full'
                    onClick={() => setCryptoOpen(true)}
                  >
                    <Coins className='mr-2 h-4 w-4' />
                    Donate Cryptocurrency
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-lg'>
                  <Github className='h-5 w-5' />
                  Code Contributions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='flex flex-wrap gap-4'>
                  <Button asChild>
                    <Link href={ExternalLinks.github} target='_blank'>
                      <Star className='mr-2 h-4 w-4' />
                      Star on GitHub
                    </Link>
                  </Button>
                  <Button variant='outline' asChild>
                    <Link
                      href={`${ExternalLinks.github}/issues/new`}
                      target='_blank'
                    >
                      <MessageSquare className='mr-2 h-4 w-4' />
                      Report Issue
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className='sticky bottom-0 bg-background pt-4 border-t mt-auto'>
            <Button variant='ghost' onClick={handleContributed} asChild>
              <Link href='#'>I&apos;ve already donated</Link>
            </Button>
            <Button variant='secondary' onClick={() => setIsOpen(false)}>
              Remind me later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cryptoOpen} onOpenChange={setCryptoOpen}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Donate Cryptocurrency</DialogTitle>
          </DialogHeader>
          <div className='grid gap-2'>
            {CRYPTO_ADDRESSES.map((wallet, index) => (
              <div
                key={index}
                className='flex gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors'
              >
                <Image
                  src={wallet.icon}
                  alt={wallet.name}
                  width={32}
                  height={32}
                  className='shrink-0 mt-1'
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center justify-between'>
                    <div>
                      <p className='font-medium text-sm'>{wallet.name}</p>
                      <p className='text-xs text-muted-foreground'>
                        {wallet.network}
                      </p>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-8 px-2 shrink-0'
                      onClick={() => copyToClipboard(wallet.address)}
                    >
                      {copiedAddress === wallet.address ? (
                        <Check className='h-3.5 w-3.5' />
                      ) : (
                        <Copy className='h-3.5 w-3.5' />
                      )}
                    </Button>
                  </div>
                  <p
                    className='text-xs text-muted-foreground break-all'
                    title={wallet.address}
                  >
                    {wallet.address}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
