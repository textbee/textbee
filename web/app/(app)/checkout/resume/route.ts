import { NextRequest } from 'next/server'
import { emailLinkRedirect } from '@/lib/email-links'

export const dynamic = 'force-dynamic'

// Checkout link from emails; the API checks the token and picks the checkout.
export async function GET(request: NextRequest) {
  return emailLinkRedirect(request, '/billing/checkout/resume')
}
