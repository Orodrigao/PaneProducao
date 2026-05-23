'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getCurrentUser, canAccess, logout } from '@/lib/auth'

const ALL_LINKS = [
  { href: '/',                  label: 'Produção',  icon: '🍞' },
  { href: '/forno',             label: 'Forno',     icon: '🔥' },
  { href: '/sobras',            label: 'Sobras',    icon: '♻️' },
  { href: '/romaneio',          label: 'Romaneio',  icon: '🚚' },
  { href: '/estoque-congelado', label: 'Congelado', icon: '🧊' },
  { href: '/estoque-paes',      label: 'Saldo Pães',icon: '📊' },
  { href: '/compras',           label: 'Compras',   icon: '🛒' },
  { href: '/estoque',           label: 'Estoque',   icon: '📊' },
  { href: '/produtos',          label: 'Produtos',  icon: '📦' },
  { href: '/clientes',          label: 'Clientes',  icon: '👥' },
  { href: '/tabelas-preco',     label: 'Tabelas',   icon: '📋' },
  { href: '/relatorios',        label: 'Relatórios',icon: '📈' },
  { href: '/admin/usuarios',    label: 'Admin',     icon: '⚙️', adminOnly: true },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const user = getCurrentUser()

  // Na tela de login não mostra a Nav
  if (pathname === '/login' || !user) return null

  const links = ALL_LINKS.filter(l => {
    if ((l as any).adminOnly && user.role !== 'admin') return false
    return canAccess(user, l.href)
  })

  function handleLogout() {
    logout()
    router.replace('/login')
  }

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'white', borderTop: '1px solid var(--border)',
      display: 'flex', zIndex: 100, boxShadow: '0 -2px 8px rgba(0,0,0,0.08)'
    }}>
      {links.map(l => {
        const active = l.href === '/'
          ? pathname === '/'
          : pathname === l.href || pathname.startsWith(l.href + '/')
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

      {/* Botão de sair */}
      <button
        onClick={handleLogout}
        title={`Sair (${user.displayName})`}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '8px 2px 6px', border: 'none', background: 'none', cursor: 'pointer',
          color: 'var(--muted)', borderTop: '2px solid transparent',
          fontSize: '0.62rem', fontWeight: 400, gap: '2px'
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>🚪</span>
        Sair
      </button>
    </nav>
  )
}
