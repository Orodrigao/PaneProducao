'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getCurrentUser, getCurrentUserAsync, canAccess, logout, type AppUser } from '@/lib/auth'
import {
  ClipboardList, Flame, Truck, BarChart3, LayoutGrid,
  Recycle, Snowflake, Scale, Boxes, ShoppingCart, Croissant,
  Users, Building2, Cake, Table2, SlidersHorizontal, LogOut,
  Factory, FileText, DollarSign,
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

  return (
    <>
      <nav className="ps-nav">
        {primary.map(l => (
          <Link key={l.href} href={l.href} className={'ps-navitem' + (isActive(l.href) ? ' active' : '')}>
            <span className="nic"><l.Icon size={22} strokeWidth={1.85} /></span>
            <span>{l.label}</span>
          </Link>
        ))}
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
