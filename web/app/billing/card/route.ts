import { NextRequest } from 'next/server'
import { emailLinkRedirect } from '@/lib/email-links'

export const dynamic = 'force-dynamic'

// Card update link from billing emails; the API checks the token.
export async function GET(request: NextRequest) {
  return emailLinkRedirect(request, '/billing/card')
}
