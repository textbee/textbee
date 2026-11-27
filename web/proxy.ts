import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { Routes } from './config/routes'

// Next 16 renamed the "middleware" convention to "proxy". This guards the
// dashboard: authenticated routing based on the NextAuth session token.
export async function proxy(request: NextRequest) {
  // Extract token using the secret for session-based authentication
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })
  const { pathname } = request.nextUrl

  // if path is /app redirect to login or dashboard based on auth status
  if (pathname === '/app') {
    if (!token) {
      const loginUrl = new URL(Routes.login, request.url)
      return NextResponse.redirect(loginUrl)
    }
    const dashboardUrl = new URL(Routes.dashboard, request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  // Check if the path starts with /app/dashboard
  if (pathname.startsWith(Routes.dashboard)) {
    if (!token) {
      // Redirect to login if not authenticated
      const loginUrl = new URL(Routes.login, request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  // If user is authenticated and visiting /app/login or /app/register, redirect to /app/dashboard
  if (token && (pathname === Routes.login || pathname === Routes.register)) {
    const dashboardUrl = new URL(Routes.dashboard, request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  // Set the pathname in the response headers
  const response = NextResponse.next()
  response.headers.set('x-pathname', pathname)

  request.headers?.set('x-current-url', request.nextUrl?.href ?? '')

  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  })
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * - version (build id for open tabs, public and checked often)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|version$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
