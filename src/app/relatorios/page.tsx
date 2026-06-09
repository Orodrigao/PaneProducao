'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { AppUser, getCurrentUser, canAccess, roleColor, roleLabel } from '@/lib/auth'

interface ReportCard {
  href: string
  title: string
  description: string
  icon: string
  status: 'ready' | 'soon'
  blocker?: string
}

const ALL_REPORTS: ReportCard[] = [
  {
    href: '/relatorios/sobras-descartes',
    title: 'Sobras & Descartes',
    description: 'Histórico unificado de sobras e descartes. Filtros por período, responsável e modo. Exporta CSV.',
    icon: '♻️',
    status: 'ready',
  },
  {
    href: '/relatorios/pj',
    title: 'Vendas PJ',
    description: 'Vendas para clientes PJ por período: total, ticket médio, ranking de clientes e top produtos. Exporta CSV.',
    icon: '🤝',
    status: 'ready',
  },
  {
    href: '/relatorios/prateleira',
    title: 'Prateleira',
    description: 'Histórico de contagens de prateleira por período, loja e produto. Exporta CSV.',
    icon: '🗂️',
    status: 'ready',
  },
  {
    href: '/relatorios/romaneios',
    title: 'Romaneios',
    description: 'Entregas por período, status (separado/enviado/conferido), divergências e fechamentos.',
    icon: '🚚',
    status: 'soon',
  },
  {
    href: '/relatorios/producao',
    title: 'Produção — pedido × realizado',
    description: 'Comparativo entre o que foi pedido na produção e o que foi efetivamente assado.',
    icon: '🍞',
    status: 'soon',
    blocker: 'Bloqueado até o módulo de confirmação do forno (Sander) existir.',
  },
  {
    href: '/relatorios/congelados',
    title: 'Congelados',
    description: 'Snapshot do estoque atual + análise de giro (alerta de overproduction).',
    icon: '🧊',
    status: 'soon',
  },
  {
    href: '/relatorios/financeiro',
    title: 'Financeiro',
    description: 'CMV, margem por canal, lucratividade real.',
    icon: '💰',
    status: 'soon',
    blocker: 'Bloqueado até a Fase 2 do PLAN (leitura de NF com IA).',
  },
]

export default function RelatoriosIndex() {
  const [user, setUser] = useState<AppUser | null>(null)

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  if (!user) return null

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Relatórios</b>
              <span>Informação pra decidir</span>
            </div>
          </div>
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
            <b>{user.displayName}</b>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          <h1 className="ps-page-title">📈 Relatórios</h1>
          <p className="ps-page-lead">{roleLabel(user.role)} · {ALL_REPORTS.filter(r => r.status === 'ready' && canAccess(user, r.href)).length} disponíveis</p>

          <div className="ps-report-grid">
            {ALL_REPORTS.map(r => {
              const isReady = r.status === 'ready'
              const accessible = isReady && canAccess(user, r.href)
              const disabledCls = accessible ? '' : 'disabled'

              const body = (
                <>
                  <div className="icon">{r.icon}</div>
                  <h3>{r.title}</h3>
                  <p>{r.description}</p>
                  {!isReady && <span className="soon">Em breve</span>}
                  {!isReady && r.blocker && <p className="blocker">{r.blocker}</p>}
                  {isReady && !accessible && (
                    <p className="denied">(sem permissão — peça acesso ao admin)</p>
                  )}
                </>
              )

              return accessible
                ? <Link key={r.href} href={r.href} className="ps-report-card">{body}</Link>
                : <div key={r.href} className={`ps-report-card ${disabledCls}`}>{body}</div>
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
