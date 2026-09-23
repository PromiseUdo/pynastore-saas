/*
 * The merchant's own measurement tags.
 *
 * Loaded ONLY when they have pasted an id in from their own account. A shop
 * that hasn't asked for tracking gets no third-party script at all — not a
 * disabled one, not a stub. That is both the honest default and the faster
 * one.
 *
 * The ids are validated on the way in (features/settings/storefront.ts) and
 * are the only thing interpolated here, so nothing a merchant types can
 * become script of its own.
 */
import Script from 'next/script';

export function StorefrontAnalytics({
  gaId,
  metaPixelId,
}: {
  gaId: string | null;
  metaPixelId: string | null;
}) {
  if (!gaId && !metaPixelId) return null;

  return (
    <>
      {gaId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
          <Script id="ga-setup" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
          </Script>
        </>
      )}

      {metaPixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}
