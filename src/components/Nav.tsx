'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/',                  label: 'Produção',  icon: '🍞' },
  { href: '/sobras',            label: 'Sobras',    icon: '♻️' },
  { href: '/romaneio',          label: 'Romaneio',  icon: '🚚' },
  { href: '/estoque-congelado', label: 'Congelado', icon: '🧊' },
  { href: '/compras',           label: 'Compras',   icon: '🛒' },
  { href: '/estoque',           label: 'Estoque',   icon: '📊' },
  { href: '/produtos',          label: 'Produtos',  icon: '📦' },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'white', borderTop: '1px solid var(--border)',
      display: 'flex', zIndex: 100, boxShadow: '0 -2px 8px rgba(0,0,0,0.08)'
    }}>
      {links.map(l => {
        const active = pathname === l.href
        return (
          <Link key={l.href} href={l.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '8px 2px 6px', textDecoration: 'none',
            color: active ? 'var(--primary)' : 'var(--muted)',
            borderTop: active ? '2px solid var(--primary)' : '2px solid transparent',
            fontSize: '0.62rem', fontWeight: active ? 700 : 400, gap: '2px'
          }}>
            <span style={{ fontSize: '1.2rem' }}>{l.icon}</span>
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
