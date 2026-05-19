import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: 'Pane & Salute — ERP',
  description: 'Sistema de gestão Pane & Salute',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ background: 'var(--bg)', paddingBottom: '70px', minHeight: '100vh' }}>
        {children}
        <Nav />
      </body>
    </html>
  )
}
