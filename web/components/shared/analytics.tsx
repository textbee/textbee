'use client'

import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { isEnabled, providerId } from '@/lib/analytics/config'
import { isLinkDeviceAddress } from '@/lib/device-link'

// Every block is gated, so a self-hosted instance that configures no providers
// loads no third-party script and reports to nobody. The Clarity session is
// labelled separately by <AnalyticsIdentify />, which sits inside the session
// provider; this component is mounted at the root and has no session.
// Pages whose address can hold a phone sign-in code load none of it.
const Analytics = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (isLinkDeviceAddress(pathname, searchParams?.toString())) return null

  const gaId = isEnabled('ga') ? providerId('ga') : undefined
  const clarityId = isEnabled('clarity') ? providerId('clarity') : undefined
  const metaPixelId = isEnabled('meta') ? providerId('meta') : undefined

  return (
    <>
      {gaId && (
        <>
          <Script
            id='gtag1'
            strategy='afterInteractive'
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          />
          <Script
            id='gtag2'
            strategy='afterInteractive'
            dangerouslySetInnerHTML={{
              __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', ${JSON.stringify(gaId)}, {
                page_path: window.location.pathname,
            });
     `,
            }}
          />
        </>
      )}

      {clarityId && (
        <Script
          id='ms-clarity1'
          strategy='afterInteractive'
          dangerouslySetInnerHTML={{
            __html: `
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", ${JSON.stringify(clarityId)});
     `,
          }}
        />
      )}

      {metaPixelId && (
        <Script
          id='meta-pixel'
          strategy='afterInteractive'
          dangerouslySetInnerHTML={{
            __html: `
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', ${JSON.stringify(metaPixelId)});
          fbq('track', 'PageView');
     `,
          }}
        />
      )}
    </>
  )
}

export default Analytics
