'use client'
import { useSession } from 'next-auth/react'
import React, { useEffect } from 'react'

// Mobile reaches the chat from the account menu, so the floating launcher
// stays off small screens where it covered row menus and the tab bar.
const HIDE_MOBILE_LAUNCHER_CSS =
  '@media (max-width: 767.98px) { .shq-bubble { display: none; } }'

export const isSupportChatEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID)

export function openSupportChat() {
  // @ts-ignore
  const widget = window.SupportHQWidget
  if (widget) widget.open()
  else window.location.href = 'mailto:support@textbee.dev'
}

export default function SupportHQWidget() {
  const { data: session } = useSession()
  // Unset project id means no widget and no request to the widget CDN.
  const projectId = process.env.NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID

  // Depended on as individual strings rather than as `session`: SessionProvider
  // hands back a new object on every refetch, and comparing that by reference
  // tore the widget down and re-injected its script even when nothing about the
  // user had changed, closing any open chat.
  const hasUser = Boolean(session?.user)
  const userId = session?.user?.id ?? ''
  const name = session?.user?.name ?? ''
  const email = session?.user?.email ?? ''
  const phone = session?.user?.phone ?? ''

  useEffect(() => {
    if (!projectId) return

    let cancelled = false

    const script = document.createElement('script')
    script.src = 'https://cdn.supporthq.app/widget/latest/supporthq-widget.js'
    script.async = true
    script.onload = () => {
      // The script can finish loading after this effect was cleaned up (the
      // src is cached, so a re-run resolves immediately), and initialising
      // then would leave a widget behind that nothing destroys.
      if (cancelled) return
      // @ts-ignore
      window.SupportHQWidget?.init({
        projectId,
        themeColor: process.env.NEXT_PUBLIC_SUPPORT_HQ_THEME_COLOR ?? '#2563eb',
        ...(hasUser && {
          metadata: { userId, name, email, phone },
        }),
      })
      const shadow = document.getElementById('supporthq-widget-host')?.shadowRoot
      // Signed-out pages have no account menu, so they keep the launcher.
      if (shadow && hasUser) {
        const style = document.createElement('style')
        style.textContent = HIDE_MOBILE_LAUNCHER_CSS
        shadow.appendChild(style)
      }
    }
    document.body.appendChild(script)

    return () => {
      cancelled = true
      // @ts-ignore
      window.SupportHQWidget?.destroy()
      // destroy() tears down the widget but leaves this tag behind, so each
      // re-run used to add another one for the life of the page.
      script.remove()
    }
  }, [projectId, hasUser, userId, name, email, phone])

  return <></>
}
