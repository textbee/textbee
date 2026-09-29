'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Github,
  MessageSquare,
  Linkedin,
  Twitter,
  Share2,
  LinkIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { ExternalLinks } from '@/config/external-links'
import { useState } from 'react'
import { toast } from '@/hooks/use-toast'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'

export default function CommunityLinks() {
  const [socialOpen, setSocialOpen] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState('')
  const socials = [
    {
      icon: '/images/facebook.svg',
      name: 'Facebook',
      url: 'https://www.facebook.com/sharer/sharer.php?u=https://textbee.dev',
    },
    {
      icon: '/images/x.svg',
      name: 'Twitter',
      url: 'https://twitter.com/intent/tweet?url=https://textbee.dev&text=🚀+Just+discovered+@textbeedotdev+-+an+amazing+SMS+gateway+platform!+Perfect+for+those+who+need+reliable+sms+integration.',
    },
    {
      icon: '/images/linkedin2.svg',
      name: 'LinkedIn',
      url: 'https://www.linkedin.com/sharing/share-offsite/?url=https://textbee.dev',
    },
    {
      icon: '/images/reddit.svg',
      name: 'Reddit',
      url: 'https://www.reddit.com/submit?url=https://textbee.dev&title=textbee.dev+-+Developer-friendly+SMS+Gateway+Platform',
    },
    {
      icon: '/images/whatsapp.svg',
      name: 'WhatsApp',
      url: "https://api.whatsapp.com/send?text=Hey!+Check+out+textbee.dev+-+it's+a+fantastic+SMS+gateway+platform+perfect+for+those+who+need+reliable+sms+integration+🚀+https://textbee.dev",
    },
    {
      icon: '/images/telegram.svg',
      name: 'Telegram',
      url: 'https://t.me/share/url?url=https://textbee.dev&text=🔥+Found+an+awesome+SMS+gateway+platform+-+textbee.dev!+Great+for+those+who+need+reliable+sms+integration.',
    },
    {
      icon: '/images/gmail.svg',
      name: 'Email',
      url: "mailto:?subject=Check+out+textbee.dev+-+SMS+Gateway+Platform&body=Hi!%0A%0AI+wanted+to+share+textbee.dev+with+you+-+it's+an+excellent+SMS+gateway+platform+that's+perfect+for+those+who+need+reliable+sms+integration.%0A%0ACheck+it+out:+https://textbee.dev%0A%0ABest+regards!",
    },
  ]
  const [currentUrl, setCurrentUrl] = useState(socials[0].url)

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedUrl(content)

    toast({
      title: 'Link copied!',
      description: 'The Link has been copied to your clipboard.',
    })
    setTimeout(() => setCopiedUrl(''), 3000)
  }

  return (
    <>
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>
              Check out our source code and contribute to the project.
            </p>
            <Button asChild className='w-full'>
              <Link href={ExternalLinks.github} prefetch={false} target='_blank'>
                <Github className='mr-2 h-4 w-4' />
                View Source
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discord</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>
              Join our community for support and updates.
            </p>
            <Button asChild className='w-full' variant='outline'>
              <Link href={ExternalLinks.discord} prefetch={false} target='_blank'>
                <MessageSquare className='mr-2 h-4 w-4' />
                Join Discord
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>X (Twitter)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>
              Follow us on X for the latest updates and announcements.
            </p>
            <Button asChild className='w-full' variant='outline'>
              <Link href={ExternalLinks.twitter} prefetch={false} target='_blank'>
                <Twitter className='mr-2 h-4 w-4' />
                Follow on X
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LinkedIn</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>
              Connect with us on LinkedIn for updates and news.
            </p>
            <Button asChild className='w-full' variant='outline'>
              <Link href={ExternalLinks.linkedin} prefetch={false} target='_blank'>
                <Linkedin className='mr-2 h-4 w-4' />
                Connect on LinkedIn
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Spread the Word</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>
              Help others discover textbee.dev by sharing it with your network.
            </p>

            <Button
              variant='outline'
              className='w-full'
              onClick={() => setSocialOpen(true)}
            >
              <Share2 className='mr-2 h-4 w-4' /> Share textbee.dev
            </Button>
          </CardContent>
        </Card>
      </div>
      <Dialog open={socialOpen} onOpenChange={setSocialOpen}>
        <DialogContent className='sm:max-w-[600px] text-base'>
          <DialogHeader>
            <DialogTitle className='text-primary mb-2 text-xl font-semibold sm:text-2xl'>
              Share textbee.dev with Others
            </DialogTitle>
            {/* A bare <p> here left the dialog with no aria-describedby. */}
            <DialogDescription>
              Help us grow by sharing textbee.dev with your friends and
              colleagues.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-6 mt-4'>
            <div className='space-y-3'>
              <h3 className='text-lg font-semibold'>Choose your platform</h3>
              {/* Not an overflow fix: 7 platforms at grid-cols-4 did fit at
                  375px, verified against the overflow guard. It just read
                  badly, a 4 + 3 split with a stranded last row. Three columns
                  on the smallest screens, then one clean row of seven. */}
              <div className='grid grid-cols-3 gap-2 rounded-lg bg-muted/30 p-3 sm:grid-cols-7 sm:gap-3 sm:p-4'>
                {socials.map(({ icon, name, url }) => (
                  <button
                    key={name}
                    type='button'
                    title={`Share on ${name}`}
                    // Selection was signalled by a ring alone, which is colour
                    // only. aria-pressed states it outright.
                    aria-pressed={currentUrl === url}
                    onClick={() => setCurrentUrl(url)}
                    className={`${
                      currentUrl === url
                        ? 'ring-2 ring-primary bg-primary/10 shadow-lg'
                        : 'hover:bg-card hover:border-primary/40 hover:shadow-md'
                    } group rounded-xl border bg-card/80 p-2 backdrop-blur-sm transition-colors duration-150 sm:p-3`}
                  >
                    <div className='mx-auto h-9 w-9 rounded-lg bg-white p-1 shadow-sm transition-shadow group-hover:shadow-md dark:bg-white sm:h-10 sm:w-10'>
                      <Image
                        src={icon}
                        alt={name}
                        width={20}
                        height={20}
                        className='h-full w-full object-contain'
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className='space-y-3'>
              <h3 className='text-lg font-semibold'>Share link</h3>
              <div className='flex items-center gap-3 p-3 bg-muted/50 rounded-lg border'>
                <LinkIcon className='w-5 h-5 flex-shrink-0 text-primary' />
                <Link
                  href={currentUrl}
                  className='text-sm text-muted-foreground hover:text-foreground break-all flex-1 transition-colors'
                  target='_blank'
                >
                  {currentUrl}
                </Link>
              </div>
              <div className='flex gap-2'>
                <Button
                  onClick={() => copyToClipboard(currentUrl)}
                  className='flex-1'
                  variant={copiedUrl === currentUrl ? 'secondary' : 'default'}
                >
                  {copiedUrl === currentUrl ? 'Copied!' : 'Copy Link'}
                </Button>
                <Button
                  onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
                  variant='outline'
                  className='flex-1'
                >
                  Open & Share
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
