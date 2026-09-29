// Email template renderer and helpers.
//
// THE CROSS-REPO CONTRACT. This file (textbee api, textbee-admin api) and email_render.py
// (textbee-plus) must produce identical output. render-conformance.json holds the cases; every
// repo runs it against its own copy. Change a behavior in email_render.py, regenerate the
// fixture, port the change here in the same pass, and copy all three files to every repo.
// See email_render.py for the template body format.
import { createHmac, timingSafeEqual } from 'crypto'

const OPEN = '\u0001'
const CLOSE = '\u0002'

const STYLE_P = 'margin:0 0 16px 0;'
const STYLE_H1 =
  'margin:0 0 16px 0;font-size:21px;line-height:1.3;font-weight:bold;color:#111827;'
const STYLE_LIST = 'margin:0 0 16px 0;padding-left:22px;'
const STYLE_LI = 'margin:0 0 6px 0;'
const STYLE_PRE =
  'margin:0 0 16px 0;padding:12px 14px;background:#f3f4f6;border-radius:6px;' +
  'font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre;overflow-x:auto;'
const STYLE_A = 'color:#1d4ed8;text-decoration:underline;'
const STYLE_BTN =
  'display:inline-block;background:#EA580C;color:#ffffff;text-decoration:none;' +
  'font-weight:bold;padding:12px 20px;border-radius:6px;'
const STYLE_USAGE_LABEL = 'font-size:13px;color:#6b7280;'
const STYLE_USAGE_NUM = 'font-weight:bold;margin:2px 0 6px 0;'

export type TemplateVars = Record<string, string | number | boolean | null | undefined>

export interface RenderableTemplate {
  subject: string
  preheader?: string
  body: string
  shell?: boolean
}

export interface RenderedEmail {
  subject: string
  preheader: string
  bodyHtml: string
  footerHtml: string
  text: string
}

export class MissingVariableError extends Error {
  readonly variable: string
  constructor(variable: string) {
    super(`Missing template variable: ${variable}`)
    this.variable = variable
    this.name = 'MissingVariableError'
  }
}

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

const applySections = (text: string, vars: TemplateVars): string =>
  text.replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_m, key: string, inner: string) => {
    const v = toStr(vars[key])
    return v !== null && v !== '' && v !== '0' && v !== 'false' ? inner : ''
  })

const seal = (text: string, vars: TemplateVars, store: string[]): string =>
  text.replace(/{{(\w+)}}/g, (m, key: string) => {
    if (key === 'usageBar') return m
    const v = toStr(vars[key])
    if (v === null) throw new MissingVariableError(key)
    store.push(v)
    return `${OPEN}${store.length - 1}${CLOSE}`
  })

const unseal = (s: string, store: string[], html: boolean): string =>
  s.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, i: string) =>
    html ? escapeHtml(store[Number(i)]) : store[Number(i)],
  )

const plain = (s: string, vars: TemplateVars): string => {
  const store: string[] = []
  const out = seal(applySections(s, vars), vars, store)
  return unseal(out, store, false).split(/\s+/).filter(Boolean).join(' ')
}

type Block =
  | { kind: 'p'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }

const parseBlocks = (md: string): Block[] => {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  const para: string[] = []
  const flush = () => {
    if (para.length) {
      blocks.push({ kind: 'p', value: para.join('\n') })
      para.length = 0
    }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push({ kind: 'code', value: code.join('\n') })
      continue
    }
    const ul = /^- (.*)$/.test(line)
    const ol = /^\d+\. (.*)$/.test(line)
    if (ul || ol) {
      flush()
      const pat = ol ? /^\d+\. (.*)$/ : /^- (.*)$/
      const items: string[] = []
      while (i < lines.length) {
        const mm = lines[i].match(pat)
        if (!mm) break
        items.push(mm[1])
        i++
      }
      blocks.push(ol ? { kind: 'ol', items } : { kind: 'ul', items })
      continue
    }
    if (line.trim() === '') {
      flush()
      i++
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return blocks
}

const BUTTON = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*$/
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const BOLD = /\*\*([^*]+)\*\*/g

const inlineHtml = (s: string, store: string[]): string => {
  let out = escapeHtml(s)
  // out is already escaped here, so only placeholder values still need escaping.
  out = out.replace(
    LINK,
    (_m, text: string, url: string) =>
      `<a href="${unseal(url, store, true)}" style="${STYLE_A}">${text}</a>`,
  )
  out = out.replace(BOLD, '<strong>$1</strong>')
  return out.replace(/ {2}\n/g, '<br>').replace(/\n/g, ' ')
}

const linkText = (text: string, url: string): string => {
  const bare = url.replace(/^https?:\/\//, '')
  if (text === url || text === bare || bare.startsWith(text)) return url
  return `${text} (${url})`
}

const inlineText = (s: string, store: string[]): string => {
  let out = s.replace(LINK, (_m, text: string, url: string) =>
    linkText(text, unseal(url, store, false)),
  )
  out = out.replace(BOLD, '$1')
  return out.replace(/ {2}\n/g, '\u0003').replace(/\n/g, ' ').replace(/\u0003/g, '\n')
}

const usageBlock = (vars: TemplateVars): [string, string] => {
  for (const k of ['usageLabel', 'used', 'limit']) {
    if (toStr(vars[k]) === null) throw new MissingVariableError(k)
  }
  const label = String(vars.usageLabel)
  const used = String(vars.used)
  const limit = String(vars.limit)
  const u = Number(used.replace(/,/g, ''))
  const l = Number(limit.replace(/,/g, ''))
  let pct = 0
  if (!Number.isNaN(u) && !Number.isNaN(l)) {
    pct = l <= 0 ? 100 : Math.max(0, Math.min(100, Math.floor((u / l) * 100 + 0.5)))
  }
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">` +
    `<tr><td style="${STYLE_USAGE_LABEL}">${escapeHtml(label)}</td></tr>` +
    `<tr><td style="${STYLE_USAGE_NUM}">${escapeHtml(used)} of ${escapeHtml(limit)}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;border-radius:4px;">` +
    `<tr><td width="${pct}%" style="background:#EA580C;height:8px;border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>`
  return [html, `${label}: ${used} of ${limit}`]
}

/** Returns [html, text] for one body or footer. */
export const renderMarkdown = (
  md: string,
  vars: TemplateVars,
  shell: boolean,
): [string, string] => {
  const store: string[] = []
  const sealed = seal(applySections(md, vars), vars, store)
  const html: string[] = []
  const text: string[] = []
  for (const block of parseBlocks(sealed)) {
    if (block.kind === 'code') {
      html.push(`<pre style="${STYLE_PRE}">${unseal(escapeHtml(block.value), store, true)}</pre>`)
      text.push(unseal(block.value, store, false))
      continue
    }
    if (block.kind === 'ul' || block.kind === 'ol') {
      const items = block.items
        .map((x) => `<li style="${STYLE_LI}">${unseal(inlineHtml(x, store), store, true)}</li>`)
        .join('')
      html.push(`<${block.kind} style="${STYLE_LIST}">${items}</${block.kind}>`)
      text.push(
        block.items
          .map(
            (x, n) =>
              (block.kind === 'ol' ? `${n + 1}. ` : '- ') +
              unseal(inlineText(x, store), store, false),
          )
          .join('\n'),
      )
      continue
    }
    const p = (block as { kind: 'p'; value: string }).value
    if (p.trim() === '{{usageBar}}') {
      const [h, t] = usageBlock(vars)
      html.push(h)
      text.push(t)
      continue
    }
    const m = p.match(BUTTON)
    if (m) {
      const url = unseal(m[2], store, false)
      const labelHtml = unseal(escapeHtml(m[1]), store, true)
      const labelText = unseal(m[1], store, false)
      html.push(
        shell
          ? `<p style="${STYLE_P}"><a href="${escapeHtml(url)}" style="${STYLE_BTN}">${labelHtml}</a></p>`
          : `<p style="${STYLE_P}"><strong><a href="${escapeHtml(url)}" style="${STYLE_A}">${labelHtml}</a></strong></p>`,
      )
      text.push(`${labelText}: ${url}`)
      continue
    }
    if (p.startsWith('# ')) {
      html.push(`<h1 style="${STYLE_H1}">${unseal(inlineHtml(p.slice(2), store), store, true)}</h1>`)
      text.push(unseal(inlineText(p.slice(2), store), store, false))
      continue
    }
    html.push(`<p style="${STYLE_P}">${unseal(inlineHtml(p, store), store, true)}</p>`)
    text.push(unseal(inlineText(p, store), store, false))
  }
  return [html.join(''), text.join('\n\n')]
}

/** Throws MissingVariableError on a placeholder with no value. */
export const renderEmail = (
  template: RenderableTemplate,
  footerBody: string,
  vars: TemplateVars,
): RenderedEmail => {
  const shell = Boolean(template.shell)
  const [bodyHtml, bodyText] = renderMarkdown(template.body, vars, shell)
  const [footerHtml, footerText] = renderMarkdown(footerBody, vars, shell)
  return {
    subject: plain(template.subject, vars),
    preheader: plain(template.preheader ?? '', vars),
    bodyHtml,
    footerHtml,
    text: `${bodyText}\n\n${footerText}\n`,
  }
}

/** Every variable a template uses, sections included, sorted and unique. */
export const placeholders = (text: string): string[] => {
  const names = new Set<string>()
  for (const m of text.matchAll(/{{[#/]?(\w+)}}/g)) names.add(m[1])
  if (names.has('usageBar')) {
    names.delete('usageBar')
    for (const k of ['usageLabel', 'used', 'limit']) names.add(k)
  }
  return [...names].sort()
}

// ---------------- helpers

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam', 'mx'])
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase()
const isLower = (s: string) => s === s.toLowerCase() && s !== s.toUpperCase()
const stripChars = (s: string, chars: string) => {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

export const safeFirstName = (name: unknown): string => {
  if (typeof name !== 'string') return 'there'
  const cleaned = Array.from(name)
    .filter((ch) => /\p{L}/u.test(ch) || " -'.".includes(ch) || /\s/u.test(ch))
    .join('')
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t !== '' && stripChars(t, ".-'") !== '')
    .map((t) => stripChars(t, '.'))
  while (tokens.length && TITLES.has(stripChars(tokens[0].toLowerCase(), '.'))) tokens.shift()
  if (!tokens.length) return 'there'
  const trimmed = name.trim()
  const rawFirst = trimmed ? trimmed.split(/\s+/)[0] : ''
  if (name.includes('@') || /\p{Nd}|https?:|www\./iu.test(name) || rawFirst.includes('://')) {
    return 'there'
  }
  let first = stripChars(tokens[0], ".-'")
  const len = Array.from(first).length
  if (len < 2 || len > 20) return 'there'
  const whole = tokens.join('')
  if (isUpper(whole) || isLower(whole)) {
    first = first.slice(0, 1).toUpperCase() + first.slice(1).toLowerCase()
  }
  return first
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u

export const sanitizeUserText = (s: unknown, maxLen = 40): string => {
  if (typeof s !== 'string') return ''
  const printable = Array.from(s)
    .map((ch) => (NON_PRINTABLE.test(ch) ? ' ' : ch))
    .join('')
  const collapsed = printable.split(/\s+/).filter(Boolean).join(' ')
  const chars = Array.from(collapsed)
  return chars.length <= maxLen ? collapsed : chars.slice(0, maxLen - 1).join('').trimEnd() + '…'
}

export const formatCount = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return 'unlimited'
  const v = Math.trunc(Number(n))
  if (v < 0) return 'unlimited'
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export const pluralize = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]

export const formatDate = (d: Date, now: Date): string => {
  const days = Math.floor((d.getTime() - now.getTime()) / 86400000)
  let s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  if (d.getUTCFullYear() !== now.getUTCFullYear() || Math.abs(days) > 183) {
    s += ` ${d.getUTCFullYear()}`
  }
  return s
}

export const formatDateTime = (d: Date, now: Date): string =>
  `${formatDate(d, now)} at ${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')} UTC`

// ---------------- signed links

const ID = /^[A-Za-z0-9_-]{1,128}$/
const PURPOSE = /^[a-z][a-z0-9-]{0,31}$/
const b64 = (b: Buffer): string => b.toString('base64url')

export const signLink = (
  secret: string,
  purpose: string,
  id: string,
  expiresAt: number,
): string => {
  if (!PURPOSE.test(purpose) || !ID.test(id) || !Number.isInteger(expiresAt) || expiresAt < 0) {
    throw new Error('invalid link parameters')
  }
  const payload = b64(Buffer.from(`{"p":"${purpose}","i":"${id}","e":${expiresAt}}`))
  const sig = b64(createHmac('sha256', secret).update(payload).digest()).slice(0, 32)
  return `${payload}.${sig}`
}

/** Returns the id when the token is valid for this purpose and not expired, else null. */
export const verifyLink = (
  secret: string,
  token: unknown,
  purpose: string,
  nowS: number,
): string | null => {
  if (typeof token !== 'string' || token.split('.').length !== 2) return null
  const [payload, sig] = token.split('.')
  const expected = b64(createHmac('sha256', secret).update(payload).digest()).slice(0, 32)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let raw: string
  try {
    raw = Buffer.from(payload, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const m = raw.match(/^\{"p":"([a-z][a-z0-9-]{0,31})","i":"([A-Za-z0-9_-]{1,128})","e":(\d{1,12})\}$/)
  if (!m || m[1] !== purpose) return null
  const exp = Number(m[3])
  if (exp !== 0 && exp <= nowS) return null
  return m[2]
}

// ---------------- outer documents

export const LOGO_URL = 'https://textbee.dev/images/logo.png'

/** Branded notice: logo row, body, footer. Used by shell templates. */
export const wrapShell = (
  subject: string,
  preheader: string,
  bodyHtml: string,
  footerHtml: string,
): string =>
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>${escapeHtml(subject)}</title></head>` +
  '<body style="margin:0;padding:0;background:#f3f4f6;">' +
  `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">' +
  '<tr><td align="center" style="padding:24px 12px;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;">' +
  '<tr><td style="padding:24px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111827;">' +
  `<img src="${LOGO_URL}" alt="textbee" width="28" height="28" style="vertical-align:middle;border:0;margin-right:8px;">textbee.dev</td></tr>` +
  '<tr><td style="padding:20px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">' +
  `${bodyHtml}</td></tr>` +
  '<tr><td style="padding:12px 28px 24px 28px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;">' +
  `${footerHtml}</td></tr>` +
  '</table></td></tr></table></body></html>'

/** Personal note: no images, no preheader, no colors beyond text and links. */
export const wrapPlain = (subject: string, bodyHtml: string, footerHtml: string): string =>
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>${escapeHtml(subject)}</title></head>` +
  '<body style="margin:0;padding:0;background:#ffffff;">' +
  '<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">' +
  `${bodyHtml}` +
  `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:12px;font-size:12px;line-height:1.5;color:#6b7280;">${footerHtml}</div>` +
  '</div></body></html>'

export interface RenderedDocument {
  subject: string
  preheader: string
  html: string
  text: string
}

/** Full email: subject, preheader, html document and text part. */
export const renderDocument = (
  template: RenderableTemplate,
  footerBody: string,
  vars: TemplateVars,
): RenderedDocument => {
  const r = renderEmail(template, footerBody, vars)
  const html = template.shell
    ? wrapShell(r.subject, r.preheader, r.bodyHtml, r.footerHtml)
    : wrapPlain(r.subject, r.bodyHtml, r.footerHtml)
  return { subject: r.subject, preheader: r.preheader, html, text: r.text }
}
