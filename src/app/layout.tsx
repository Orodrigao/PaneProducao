import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import AuthGuard from '@/components/AuthGuard'

export const metadata: Metadata = {
  title: 'Pane & Salute – ERP',
  description: 'Sistema de gestão Pane & Salute',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="app-body">
        <AuthGuard>
          <div className="app-viewport">{children}</div>
          <Nav />
        </AuthGuard>
      </body>
    </html>
  )
}
