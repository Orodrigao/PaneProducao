'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getCurrentUser, getCurrentUserAsync, canAccess, logout, roleColor, type AppUser } from '@/lib/auth'
import { COMPRAS_COTACOES_PAUSADAS, isComprasCotacoesPath } from '@/lib/features'
import {
  ClipboardList, Flame, Truck, BarChart3, LayoutGrid,
  Recycle, Snowflake, Scale, Boxes, ShoppingCart, Croissant,
  Users, Building2, Cake, Table2, SlidersHorizontal, LogOut,
  Factory, FileText, DollarSign, ShieldCheck, PanelLeft,
  type LucideIcon,
} from 'lucide-react'

interface NavLink { href: string; label: string; Icon: LucideIcon }

const PRIMARY: NavLink[] = [
  { href: '/',          label: 'Produção',   Icon: ClipboardList },
  { href: '/forno',     label: 'Forno',      Icon: Flame },
  { href: '/romaneio',  label: 'Romaneio',   Icon: Truck },
  { href: '/relatorios',label: 'Relatórios', Icon: BarChart3 },
]

const MORE_GROUPS: { group: string; items: NavLink[] }[] = [
  { group: 'Operação', items: [
    { href: '/sobras',            label: 'Sobras',    Icon: Recycle },
    { href: '/fechamento-caixa',  label: 'Caixa',     Icon: DollarSign },
    { href: '/estoque-congelado', label: 'Congelado', Icon: Snowflake },
    { href: '/estoque-paes',      label: 'Saldo Pães',Icon: Scale },
    { href: '/estoque',           label: 'Estoque',   Icon: Boxes },
  ]},
  { group: 'Comercial', items: [
    { href: '/compras',      label: 'Compras',      Icon: ShoppingCart },
    { href: '/cotacoes',     label: 'Cotações',     Icon: FileText },
    { href: '/fornecedores', label: 'Fornecedores', Icon: Factory },
    { href: '/produtos',     label: 'Produtos',     Icon: Croissant },
    { href: '/clientes',     label: 'Clientes',     Icon: Users },
    { href: '/pedidos-pj',   label: 'Pedidos PJ',   Icon: Building2 },
    { href: '/encomendas',   label: 'Encomendas',   Icon: Cake },
  ]},
  { group: 'Gestão', items: [
    { href: '/tabelas-preco',      label: 'Tabelas',   Icon: Table2 },
    { href: '/simulador-desconto', label: 'Simulador', Icon: SlidersHorizontal },
  ]},
  { group: 'Administração', items: [
    { href: '/admin/usuarios', label: 'Usuários', Icon: ShieldCheck },
  ]},
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(() => getCurrentUser())
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setUser(getCurrentUser())
    getCurrentUserAsync().then(current => {
      if (alive) setUser(current)
    })
    return () => { alive = false }
  }, [pathname])

  // Na tela de login não mostra a Nav
  if (pathname === '/login' || !user) return null

  const allowed = (l: NavLink) => {
    if (COMPRAS_COTACOES_PAUSADAS && isComprasCotacoesPath(l.href)) {
      return false
    }
    return canAccess(user, l.href)
  }
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const primary = PRIMARY.filter(allowed)
  const moreGroups = MORE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(allowed) }))
    .filter(g => g.items.length > 0)
  const moreActive = moreGroups.some(g => g.items.some(i => isActive(i.href)))

  function handleLogout() {
    setSheetOpen(false)
    logout()
    router.replace('/login')
  }

  const navLink = (l: NavLink, variant: 'primary' | 'sidebar') => (
    <Link
      key={`${variant}-${l.href}`}
      href={l.href}
      className={variant === 'primary'
        ? 'ps-navitem' + (isActive(l.href) ? ' active' : '')
        : 'ps-sidebar-item' + (isActive(l.href) ? ' active' : '')}
      aria-current={isActive(l.href) ? 'page' : undefined}
      title={l.label}
    >
      <span className={variant === 'primary' ? 'nic' : 'ps-sidebar-icon'}>
        <l.Icon size={variant === 'primary' ? 22 : 20} strokeWidth={1.85} />
      </span>
      <span>{l.label}</span>
    </Link>
  )

  return (
    <>
      <aside className="ps-sidebar" aria-label="Navegação principal">
        <Link className="ps-sidebar-brand" href="/" aria-label="Pane & Salute — início">
          <span className="ps-sidebar-mark">P</span>
          <span className="ps-sidebar-brand-text">
            <b>Pane &amp; Salute</b>
            <small>ERP</small>
          </span>
        </Link>

        <div className="ps-sidebar-scroll">
          <div className="ps-sidebar-group">
            <div className="ps-sidebar-label">Principal</div>
            {primary.map(l => navLink(l, 'sidebar'))}
          </div>

          <button
            className={'ps-sidebar-item ps-sidebar-more' + (moreActive ? ' active' : '')}
            onClick={() => setSheetOpen(true)}
            aria-label="Abrir todas as seções"
            title="Mais seções"
          >
            <span className="ps-sidebar-icon"><PanelLeft size={20} strokeWidth={1.85} /></span>
            <span>Mais seções</span>
          </button>

          <div className="ps-sidebar-groups-full">
            {moreGroups.map(g => (
              <div className="ps-sidebar-group" key={g.group}>
                <div className="ps-sidebar-label">{g.group}</div>
                {g.items.map(l => navLink(l, 'sidebar'))}
              </div>
            ))}
          </div>
        </div>

        <div className="ps-sidebar-account">
          <div className="ps-sidebar-user" title={user.displayName}>
            <span className="ps-avatar" style={{background: roleColor(user.role)}}>
              {user.displayName.charAt(0).toUpperCase()}
            </span>
            <span>
              <b>{user.displayName}</b>
              <small>{user.role}</small>
            </span>
          </div>
          <button className="ps-sidebar-logout" onClick={handleLogout} aria-label="Sair" title="Sair">
            <LogOut size={19} strokeWidth={1.85} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <nav className="ps-nav">
        {primary.map(l => navLink(l, 'primary'))}
        <button className={'ps-navitem' + (moreActive ? ' active' : '')} onClick={() => setSheetOpen(true)} aria-label="Mais seções">
          <span className="nic"><LayoutGrid size={22} strokeWidth={1.85} /></span>
          <span>Mais</span>
        </button>
      </nav>

      {sheetOpen && (
        <div className="ps-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="ps-sheet" onClick={e => e.stopPropagation()}>
            <div className="ps-sheet-grab" />
            <h3>Todas as seções</h3>
            {moreGroups.map(g => (
              <div key={g.group}>
                <div className="ps-sheet-sep">{g.group}</div>
                <div className="ps-sheet-grid">
                  {g.items.map(it => (
                    <Link key={it.href} href={it.href} onClick={() => setSheetOpen(false)}
                      className={'ps-sheet-item' + (isActive(it.href) ? ' active' : '')}>
                      <span className="si"><it.Icon size={22} strokeWidth={1.85} /></span>
                      <span>{it.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="ps-sheet-sep">Conta</div>
            <div className="ps-sheet-grid">
              <button className="ps-sheet-item" onClick={handleLogout}>
                <span className="si" style={{ color: 'var(--berry)' }}><LogOut size={22} strokeWidth={1.85} /></span>
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
