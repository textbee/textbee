const { execSync } = require('node:child_process')
const { PHASE_PRODUCTION_BUILD } = require('next/constants')

// The id of this build, which open dashboard tabs compare with /version.
// Vercel's deployment id, else the commit plus the build time (a rebuild of
// the same commit is a new build). Empty when neither exists, and then the
// app never checks.
function readBuildId() {
  if (process.env.VERCEL_DEPLOYMENT_ID) return process.env.VERCEL_DEPLOYMENT_ID
  let commit = process.env.VERCEL_GIT_COMMIT_SHA
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
    } catch {
      commit = ''
    }
  }
  return commit ? `${commit.slice(0, 12)}.${Date.now().toString(36)}` : ''
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // The phone sign-in page shows a code: no referrer leaves it, and no other
  // site may show it inside a frame.
  async headers() {
    return [
      {
        source: '/link-device',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },

  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/android',
        destination: 'https://textbee.dev/download',
        permanent: false,
      },
      // The invite itself lives behind textbee.dev/discord, so it can rotate
      // in one place.
      {
        source: '/discord',
        destination: 'https://textbee.dev/discord',
        permanent: false,
      },
    ]
  },
}

module.exports = (phase) => {
  // Only a production build gets an id, so `next dev` never checks. Kept in
  // process.env so every build worker that loads this file bakes the same id.
  if (phase !== PHASE_PRODUCTION_BUILD) return nextConfig
  process.env.NEXT_PUBLIC_BUILD_ID ??= readBuildId()
  return {
    ...nextConfig,
    env: { NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID },
  }
}
