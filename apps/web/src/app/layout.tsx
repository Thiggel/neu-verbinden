import type { Metadata, Viewport } from 'next';
import './globals.css';

// The name is the app's, not one city's: the same editor now opens Hamburg or
// Berlin, and a title that names only one of them is wrong half the time.
export const metadata: Metadata = {
  title: 'Verkehrsnetz-Designer',
  description:
    'Zeichne das Nahverkehrsnetz, das du dir wünschst, für Hamburg oder Berlin, und erfahre, was es vermutlich kosten und wie lange es dauern würde.',
  applicationName: 'Verkehrsnetz-Designer',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e12' },
  ],
};

import { SiteFooter } from '@/components/SiteFooter';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint so the map never flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('hh-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="flex h-full flex-col">
        <div className="min-h-0 flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
