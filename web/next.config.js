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



module.exports = nextConfig;
