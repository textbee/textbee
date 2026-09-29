/**
 * Renders every mail template to HTML you can open in a browser.
 *
 * Mirrors what MailerModule actually does at send time, including the
 * inline-css pass, so what you see here is what lands in the inbox. Without
 * this the only way to review an email was to send one.
 *
 *   pnpm preview:emails
 */
import * as fs from 'fs'
import * as path from 'path'
import inlineCss = require('inline-css')
import { renderTemplate, TEMPLATE_DIR } from '../src/mail/render-template'

const OUT_DIR = path.join(__dirname, '..', 'tmp', 'email-preview')

const YEAR = new Date().getFullYear()

/** Realistic context per template, so the preview shows real-shaped content. */
const SAMPLES: Record<string, Record<string, any>> = {
  'customer-support-confirmation': {
    name: 'Alex',
    email: 'alex@example.com',
    phone: '+1 555 0147',
    category: 'Technical',
    message:
      'My gateway phone stopped sending after I restarted it. Messages sit in the dashboard but never leave the device.',
  },
  'account-deletion-request': {
    name: 'Alex',
    email: 'alex@example.com',
    message: 'Moving to a different provider.',
  },
  'webhook-subscription-disabled': {
    name: 'Alex',
    title: 'A webhook was turned off',
    subscriptionName: 'Order updates',
    deliveryUrl: 'https://example.com/hooks/textbee',
    failureCount: 42,
    ctaLabel: 'Review webhooks',
    ctaUrl: 'https://app.textbee.dev/dashboard/webhooks',
  },
  'webhook-auto-disable-admin-summary': {
    title: 'Webhooks auto-disabled',
    runAt: '2026-08-22 04:00 UTC',
    count: 2,
    rows: [
      {
        id: '66f1a2b3c4d5e6f708192a3b',
        deliveryUrl: 'https://example.com/hooks/one',
        failed: 120,
        success: 3,
        total: 123,
        failureRate: '97.6',
      },
      {
        id: '66f1a2b3c4d5e6f708192a3c',
        deliveryUrl: 'https://example.org/webhook',
        failed: 88,
        success: 0,
        total: 88,
        failureRate: '100.0',
      },
    ],
  },
}

/**
 * Cheap structural checks on the rendered output. These are the failures that
 * are invisible when reading the template source: a stray tag that puts the
 * whole document outside <html>, or a quoted font name that terminates its own
 * style attribute once inline-css re-emits it with double quotes.
 */
function validate(name: string, html: string): string[] {
  const problems: string[] = []
  const count = (re: RegExp) => (html.match(re) ?? []).length

  if (count(/<html[\s>]/gi) !== 1) {
    problems.push(`${name}: expected exactly one <html> tag`)
  }
  if (count(/<head[\s>]/gi) !== 1) {
    problems.push(`${name}: expected exactly one <head> tag`)
  }
  if (count(/<body[\s>]/gi) !== 1) {
    problems.push(`${name}: expected exactly one <body> tag`)
  }
  if (/<html>\s*<\/html>/i.test(html)) {
    problems.push(`${name}: empty <html></html> before the real document`)
  }
  const htmlAt = html.search(/<html[\s>]/i)
  const headAt = html.search(/<head[\s>]/i)
  if (htmlAt > -1 && headAt > -1 && headAt < htmlAt) {
    problems.push(`${name}: <head> appears before <html>`)
  }
  // A style attribute that closed early leaves a bare token before the next
  // attribute or the tag end, e.g. style="font:14px " Courier New", ...
  for (const match of html.matchAll(/style="[^"]*"\s*[A-Za-z ]+"/g)) {
    problems.push(
      `${name}: style attribute terminated early near ${JSON.stringify(
        match[0].slice(0, 60),
      )}`,
    )
  }
  if (!/display:\s*none/i.test(html)) {
    problems.push(`${name}: no hidden preheader block`)
  }
  return problems
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const names = fs
    .readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith('.hbs'))
    .map((f) => path.basename(f, '.hbs'))
    .sort()

  const rendered: string[] = []
  const problems: string[] = []

  for (const name of names) {
    const context = { currentYear: YEAR, ...(SAMPLES[name] ?? {}) }
    const html = renderTemplate(name, context)
    // The adapter inlines CSS before sending, so the preview must too.
    const inlined = await inlineCss(html, { url: ' ' })
    fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), inlined)
    rendered.push(name)
    if (!SAMPLES[name]) console.warn(`  no sample context for ${name}`)
    problems.push(...validate(name, inlined))
  }

  if (problems.length) {
    console.error('\nStructural problems found:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }

  const index = `<!doctype html><meta charset="utf-8"><title>textbee email previews</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.25rem}li{margin:.35rem 0}a{color:#EA580C}</style>
<h1>textbee email previews</h1>
<p>Rendered ${rendered.length} templates at ${new Date().toISOString()}.</p>
<ul>${rendered.map((n) => `<li><a href="./${n}.html">${n}</a></li>`).join('')}</ul>`
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), index)

  console.log(`Rendered ${rendered.length} templates`)
  console.log(`Open ${path.join(OUT_DIR, 'index.html')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
