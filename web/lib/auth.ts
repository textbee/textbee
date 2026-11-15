import CredentialsProvider from 'next-auth/providers/credentials'
import { httpServerClient } from './httpServerClient'
import type { DefaultSession, NextAuthOptions } from 'next-auth'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'
import { clientContextFromHeaders } from '@/lib/analytics/client-context'

// add custom fields to the session and user interfaces
declare module 'next-auth' {
  interface Session {
    user: {
      id?: string
      role?: string
      phone?: string
      avatar?: string
      accessToken?: string
      isNewUser?: boolean
    } & DefaultSession['user']
  }

  interface User {
    // The backend returns Mongo documents, so the id arrives as _id and is
    // copied onto the token below.
    _id?: string
    role?: string
    phone?: string
    avatar?: string
    accessToken?: string
    isNewUser?: boolean
  }
}

// The jwt/session callbacks read and write these, so the token has to declare
// them or every callback parameter falls back to an implicit any.
declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: string
    phone?: string
    avatar?: string
    accessToken?: string
    isNewUser?: boolean
  }
}


// Credentials cross the wire as strings, so the attribution blob arrives as
// JSON. A bad value must not block a signup, so parsing failures are dropped.
function parseAttribution(raw: unknown) {
  if (typeof raw !== 'string' || !raw || raw === 'undefined') return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'email-password-login',
      name: 'email-password-login',
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        turnstileToken: { label: 'Turnstile Token', type: 'text' },
      },
      async authorize(credentials, req) {
        // NextAuth can invoke authorize with no credentials at all. There is
        // nothing to authenticate in that case, so refuse rather than posting
        // undefined fields to the login endpoint.
        if (!credentials) return null
        const { email, password, turnstileToken } = credentials
        try {
          const res = await httpServerClient.post(ApiEndpoints.auth.login(), {
            email,
            password,
            turnstileToken,
            client: clientContextFromHeaders(req?.headers),
          })

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
          }
        } catch {
          return null
        }
      },
    }),
    CredentialsProvider({
      id: 'email-password-register',
      name: 'email-password-register',
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        name: { label: 'Name', type: 'text' },
        phone: { label: 'Phone', type: 'text' },
        marketingOptIn: { label: 'Marketing Opt In', type: 'text' },
        attribution: { label: 'Attribution', type: 'text' },
        turnstileToken: { label: 'Turnstile Token', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials) return null
        const { email, password, name, phone, turnstileToken } = credentials
        try {
          const res = await httpServerClient.post(
            ApiEndpoints.auth.register(),
            {
              email,
              password,
              name,
              phone,
              // Arrives as a string, and Boolean('false') is true.
              marketingOptIn: credentials.marketingOptIn === 'true',
              attribution: parseAttribution(credentials.attribution),
              // Without this the API would record this server's address and
              // user agent instead of the visitor's.
              client: clientContextFromHeaders(req?.headers),
              turnstileToken,
            }
          )

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
          }
        } catch {
          return null
        }
      },
    }),
    CredentialsProvider({
      id: 'google-id-token-login',
      name: 'google-id-token-login',
      credentials: {
        idToken: { label: 'idToken', type: 'text' },
        attribution: { label: 'Attribution', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials) return null
        const { idToken } = credentials
        try {
          const res = await httpServerClient.post(
            ApiEndpoints.auth.signInWithGoogle(),
            {
              idToken,
              attribution: parseAttribution(credentials.attribution),
              client: clientContextFromHeaders(req?.headers),
            }
          )

          const user = res.data.data.user
          const accessToken = res.data.data.accessToken

          return {
            ...user,
            accessToken,
            isNewUser: res.data.data.isNewUser === true,
          }
        } catch (e) {
          const response = (e as any)?.response
          const message = response?.data?.error
          if (response?.status === 409 && typeof message === 'string') {
            // next-auth hands a thrown message to the client as result.error.
            throw new Error(message)
          }
          return null
        }
      },
    }),
  ],
  pages: {
    signIn: Routes.login,
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (trigger === 'update') {
        if (session.name !== token.name) {
          token.name = session.name
        }
        if (session.phone !== token.phone) {
          token.phone = session.phone
        }
        return token
      }

      if (user) {
        token.id = user._id
        token.role = user.role
        token.accessToken = user.accessToken
        token.avatar = user.avatar
        token.phone = user.phone
        token.isNewUser = user.isNewUser
      }
      return token
    },
    async session({ session, token }): Promise<any> {
      session.user.id = token.id
      session.user.role = token.role
      session.user.accessToken = token.accessToken
      session.user.avatar = token.avatar
      session.user.phone = token.phone
      session.user.isNewUser = token.isNewUser
      return session
    },
  },
}
