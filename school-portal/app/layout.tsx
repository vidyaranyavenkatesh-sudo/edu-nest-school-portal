import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui'
import { ACCENT, ACCENT_SOFT, APP_NAME } from '@/lib/config'

export const metadata: Metadata = { title: APP_NAME, description: 'School attendance, notes, report cards and messages', robots: { index: false, follow: false } }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: ACCENT }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ ['--accent' as any]: ACCENT, ['--accent-soft' as any]: ACCENT_SOFT }}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
