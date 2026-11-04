'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Bitcoin,
  CircleDollarSign,
  Copy,
  Heart,
  MessageSquare,
  Star,
  Wallet,
  Shield,
  Coins,
} from 'lucide-react'
import { Github, Linkedin, Twitter } from '@/components/shared/brand-icons'
import Link from 'next/link'
import { ExternalLinks } from '@/config/external-links'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { CRYPTO_ADDRESSES } from '@/lib/constants'
import Image from 'next/image'

export default function ContributePage() {
  const { toast } = useToast()

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: `${type} address copied to clipboard`,
    })
  }

  return (
    <div className='min-h-screen p-4 md:p-8 space-y-8'>
      <div className='text-center space-y-4'>
        <h1 className='text-4xl font-bold'>Support textbee</h1>
        <p className='text-muted-foreground max-w-2xl mx-auto'>
          Your contribution, whether financial or through code, helps keep this
          project alive and growing.
        </p>
      </div>

      <div className='space-y-6 max-w-5xl mx-auto'>
        <Card className='overflow-hidden hidden'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <CircleDollarSign className='h-5 w-5' />
              Financial Support
            </CardTitle>
            <CardDescription>
              Help sustain textbee&apos;s development through financial
              contributions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid gap-6 md:grid-cols-2'>
              <div className='space-y-6'>
                <Card className='overflow-hidden'>
                  <CardHeader>
                    <CardTitle className='text-lg'>Monthly Support</CardTitle>
                    <CardDescription>
                      Become a patron and support us monthly
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className='w-full' asChild>
                      <Link href={ExternalLinks.patreon} target='_blank'>
                        <Heart className='mr-2 h-4 w-4' />
                        Support on Patreon
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
              <div className='space-y-6'>
                <Card className='overflow-hidden'>
                  <CardHeader>
                    <CardTitle className='text-lg'>One-time Support</CardTitle>
                    <CardDescription>
                      Make a one-time contribution
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant='outline' className='w-full' asChild>
                      <Link href={ExternalLinks.polar} target='_blank'>
                        <Heart className='mr-2 h-4 w-4' />
                        Donate on Polar
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <Card className='h-full overflow-hidden'>
                <CardHeader>
                  <CardTitle className='text-lg'>Crypto Donations</CardTitle>
                  <CardDescription>
                    Support us with cryptocurrency
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button className='w-full' variant='outline'>
                        <Wallet className='mr-2 h-4 w-4' />
                        View Crypto Addresses
                      </Button>
                    </DialogTrigger>
                    <DialogContent className='max-w-md'>
                      <DialogHeader>
                        <DialogTitle>
                          Cryptocurrency Donation Addresses
                        </DialogTitle>
                      </DialogHeader>
                      <div className='space-y-4'>
                        {CRYPTO_ADDRESSES.map((wallet, index) => (
                          <div key={index} className='space-y-2'>
                            <div className='flex items-center justify-between'>
                              <span className='flex items-center gap-2'>
                                <Image
                                  src={wallet.icon}
                                  alt={wallet.name}
                                  width={32}
                                  height={32}
                                />
                                {wallet.name}
                              </span>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() =>
                                  handleCopy(wallet.address, wallet.name)
                                }
                              >
                                <Copy className='h-4 w-4' />
                              </Button>
                            </div>
                            <code className='text-xs block bg-muted p-2 rounded break-all whitespace-pre-wrap'>
                              {wallet.address}
                            </code>
                            <p className='text-xs text-muted-foreground'>
                              Network: {wallet.network}
                            </p>
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <Card className='overflow-hidden'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Github className='h-5 w-5' />
              Code Contributions
            </CardTitle>
            <CardDescription>
              Help improve textbee by contributing to the codebase
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid gap-6 md:grid-cols-3'>
              <Card className='overflow-hidden'>
                <CardHeader>
                  <CardTitle className='text-lg'>Star the Project</CardTitle>
                  <CardDescription>
                    Show your support by starring the repository
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className='w-full' asChild>
                    <Link href={ExternalLinks.github} target='_blank'>
                      <Star className='mr-2 h-4 w-4' />
                      Star on GitHub
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className='overflow-hidden'>
                <CardHeader>
                  <CardTitle className='text-lg'>Report Issues</CardTitle>
                  <CardDescription>
                    Help us improve by reporting bugs and suggesting features
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className='w-full' variant='outline' asChild>
                    <Link
                      href={`${ExternalLinks.github}/issues/new`}
                      target='_blank'
                    >
                      <MessageSquare className='mr-2 h-4 w-4' />
                      Create Issue
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className='overflow-hidden'>
                <CardHeader>
                  <CardTitle className='text-lg'>Security Reports</CardTitle>
                  <CardDescription>
                    Report security vulnerabilities privately to{' '}
                    <a href='mailto:security@textbee.dev'>
                      security@textbee.dev
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className='w-full' variant='outline' asChild>
                    <Link href='mailto:security@textbee.dev'>
                      <Shield className='mr-2 h-4 w-4' />
                      Report Vulnerability
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <Card className='overflow-hidden'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <MessageSquare className='h-5 w-5' />
              Join the Community
            </CardTitle>
            <CardDescription>
              Follow our socials and connect with other contributors to get
              early access to new features and updates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
              <Button variant='outline' asChild>
                <Link href={ExternalLinks.discord} target='_blank'>
                  <MessageSquare className='mr-2 h-4 w-4' />
                  Join Discord
                </Link>
              </Button>
              <Button variant='outline' asChild>
                <Link href={ExternalLinks.twitter} target='_blank'>
                  <Twitter className='mr-2 h-4 w-4' />
                  Follow us on X (Twitter)
                </Link>
              </Button>
              <Button variant='outline' asChild>
                <Link href={ExternalLinks.linkedin} target='_blank'>
                  <Linkedin className='mr-2 h-4 w-4' />
                  Connect on LinkedIn
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
