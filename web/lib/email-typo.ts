// Suggests a corrected address for a likely domain typo, or null.

const TARGETS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'googlemail.com',
]

const SAFE_DOMAINS = new Set([
  ...TARGETS,
  'aol.com',
  'live.com',
  'msn.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'ymail.com',
  'mail.com',
  'email.com',
  'fastmail.com',
  'foxmail.com',
  'myyahoo.com',
  'onmail.com',
  'hey.com',
  'pm.me',
  'me.com',
  'mac.com',
  'qq.com',
  '163.com',
  '126.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'zoho.com',
  'duck.com',
  'aim.com',
  'protonmail.ch',
  'yahoo.fr',
  'yahoo.co.uk',
  'yahoo.co.jp',
  'yahoo.co.in',
  'yahoo.de',
  'yahoo.it',
  'yahoo.es',
  'yahoo.ca',
  'yahoo.com.br',
  'yahoo.com.au',
  'yahoo.dk',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'outlook.fr',
  'outlook.de',
  'outlook.es',
  'outlook.it',
  'outlook.com.br',
  'live.co.uk',
  'live.fr',
  'live.nl',
  'live.com.au',
  'icloud.com.cn',
])

const BAD_ENDINGS = new Set([
  'con',
  'cmo',
  'ocm',
  'vom',
  'xom',
  'cim',
  'cpm',
  'clm',
  'col',
  'comm',
  'coom',
  'comj',
  'come',
  'c0m',
])

// True when b is one insert, delete, replace or neighbour swap away from a.
function isOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false

  if (a.length === b.length) {
    const diffs: number[] = []
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs.push(i)
      if (diffs.length > 2) return false
    }
    if (diffs.length === 1) return true
    const [i, j] = diffs
    return j === i + 1 && a[i] === b[j] && a[j] === b[i]
  }

  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && long[i] === short[i]) i++
  return long.slice(i + 1) === short.slice(i)
}

function fixDomain(domain: string): string | null {
  const firstLabel = domain.split('.')[0]
  if (firstLabel === 'gmail' || firstLabel === 'googlemail') {
    return `${firstLabel}.com`
  }
  return TARGETS.find((target) => isOneEdit(domain, target)) ?? null
}

export function suggestEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  const parts = email.split('@')
  if (parts.length !== 2) return null
  const [local, domain] = parts
  if (!local || !domain) return null

  if (SAFE_DOMAINS.has(domain)) return null

  const labels = domain.split('.')
  const last = labels[labels.length - 1]
  let candidate = domain
  if (labels.length > 1 && BAD_ENDINGS.has(last)) {
    candidate = [...labels.slice(0, -1), 'com'].join('.')
    if (SAFE_DOMAINS.has(candidate)) return `${local}@${candidate}`
  }

  const fixed = fixDomain(candidate) ?? (candidate !== domain ? candidate : null)
  return fixed ? `${local}@${fixed}` : null
}
