// Build the curated, web-optimized asset set committed to the README from the
// raw 2x/3x captures. Downscales for sane repo weight while staying retina-crisp.
//   SRC_SHOTS=.. SRC_FRAMES=.. SRC_MOTION=.. DEST=.. node scripts/optimize-assets.cjs
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const SRC_SHOTS = process.env.SRC_SHOTS
const SRC_FRAMES = process.env.SRC_FRAMES
const SRC_MOTION = process.env.SRC_MOTION
const DEST = process.env.DEST
if (!SRC_SHOTS || !SRC_FRAMES || !SRC_MOTION || !DEST) {
  console.error('set SRC_SHOTS, SRC_FRAMES, SRC_MOTION, DEST')
  process.exit(1)
}

// committed screenshot set: raw file -> published name
const SHOTS = {
  'dashboard-overview.png': 'dashboard-overview.png',
  'send-sms.png': 'send-sms.png',
  'message-history.png': 'message-history.png',
  'webhooks.png': 'webhooks.png',
  'bulk-send.png': 'bulk-send.png',
  'billing-pro.png': 'billing.png',
  'api-guide.png': 'api-guide.png',
}
const FRAMES = {
  'app-dashboard.png': 'app-dashboard.png',
  'app-settings.png': 'app-settings.png',
}

async function pngResize(src, dest, width) {
  await sharp(src)
    .resize({ width, withoutEnlargement: true })
    .png({ palette: true, quality: 88, effort: 9, compressionLevel: 9 })
    .toFile(dest)
  const kb = Math.round(fs.statSync(dest).size / 1024)
  console.log(`  ${path.basename(dest)}  ${kb}KB`)
}

;(async () => {
  const outShots = path.join(DEST, 'screenshots')
  const outApp = path.join(DEST, 'app')
  const outGif = path.join(DEST, 'gifs')
  for (const d of [outShots, outApp, outGif]) fs.mkdirSync(d, { recursive: true })

  console.log('screenshots (width 1600):')
  for (const [from, to] of Object.entries(SHOTS)) {
    await pngResize(path.join(SRC_SHOTS, from), path.join(outShots, to), 1600)
  }
  console.log('app frames (width 760, transparent):')
  for (const [from, to] of Object.entries(FRAMES)) {
    await pngResize(path.join(SRC_FRAMES, from), path.join(outApp, to), 760)
  }
  console.log('gif:')
  fs.copyFileSync(
    path.join(SRC_MOTION, 'send-sms.gif'),
    path.join(outGif, 'send-sms.gif')
  )
  console.log(`  send-sms.gif copied`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
