export type Crumb = { href: string; label: string }

// Labels match the section headings and route tabs.
const LABELS: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/messaging': 'Messaging',
  '/dashboard/messaging/bulk': 'Bulk Send',
  '/dashboard/messaging/history': 'History',
  '/dashboard/messaging/api-guide': 'API',
  '/dashboard/webhooks': 'Webhooks',
  '/dashboard/webhooks/deliveries': 'Deliveries',
  '/dashboard/community': 'Community',
  '/dashboard/account': 'Account',
  '/dashboard/account/billing': 'Billing & plan',
  '/dashboard/account/profile': 'Profile',
  '/dashboard/account/security': 'Security',
  '/dashboard/account/support': 'Support',
}

// Section roots that only redirect link to the tab they land on.
const LINK_TARGETS: Record<string, string> = {
  '/dashboard/account': '/dashboard/account/billing',
}

// A section root that is itself a tab gets that tab as its last crumb.
const INDEX_TABS: Record<string, string> = {
  '/dashboard/messaging': 'Send',
}

const titleCase = (segment: string) =>
  decodeURIComponent(segment)
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')

export function buildBreadcrumbs(pathname: string): Crumb[] {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path !== '/dashboard' && !path.startsWith('/dashboard/')) return []

  const segments = path.split('/').filter(Boolean)
  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`
    return {
      href: LINK_TARGETS[href] ?? href,
      label: LABELS[href] ?? titleCase(segment),
    }
  })

  if (INDEX_TABS[path]) {
    crumbs.push({ href: path, label: INDEX_TABS[path] })
  }
  return crumbs
}
