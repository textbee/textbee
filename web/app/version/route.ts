import { runningBuildId } from '@/lib/new-version'

// Answered fresh on every request: a cached answer would hide a deploy.
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store, max-age=0' }

/** The id of the build this server runs, for open tabs to compare with. */
export function GET() {
  const id = runningBuildId()
  if (!id) return new Response(null, { status: 404, headers })
  return Response.json({ id }, { headers })
}
