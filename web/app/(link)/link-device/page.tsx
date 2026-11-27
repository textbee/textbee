import { getServerSession, Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Routes } from '@/config/routes'
import LinkDevicePanel from './link-device-panel'
import SignedOutPanel from './signed-out-panel'

type SearchParams = Record<string, string | string[] | undefined>

// This page's own path and query, for the way back after login
function returnPath(params: SearchParams): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.append(key, value)
    else value?.forEach((entry) => query.append(key, entry))
  }
  const search = query.toString()
  return search ? `${Routes.linkDevice}?${search}` : Routes.linkDevice
}

export default async function LinkDevicePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session: Session | null = await getServerSession(authOptions as any)
  const params = await searchParams
  const back = returnPath(params)

  if (!session?.user) return <SignedOutPanel returnTo={back} />

  const code = params.code
  return (
    <LinkDevicePanel
      addressCode={Array.isArray(code) ? code[0] : code}
      sessionEmail={session.user.email ?? ''}
      sessionName={session.user.name ?? ''}
    />
  )
}
