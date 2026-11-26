'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Routes } from '@/config/routes'
import { takeTypedCode } from '@/lib/device-link'

export default function SignedOutPanel({ returnTo }: { returnTo: string }) {
  // The stored code is removed on every load of the page, used or not
  useEffect(() => {
    takeTypedCode()
  }, [])

  const back = encodeURIComponent(returnTo)

  return (
    <Card className='w-full max-w-md rounded-2xl'>
      <CardContent className='flex flex-col gap-5 px-5 py-6 sm:px-7 sm:py-8'>
        <h1 className='text-xl font-semibold leading-7 tracking-tight'>
          Log in or create a free account to connect this phone
        </h1>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <Button asChild className='sm:flex-1'>
            <a href={`${Routes.login}?redirect=${back}`}>Log in</a>
          </Button>
          <Button asChild variant='outline' className='sm:flex-1'>
            <a href={`${Routes.register}?redirect=${back}`}>Create account</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
