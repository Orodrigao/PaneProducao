'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { AppUser, getCurrentUser, canAccess } from '@/lib/auth'

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
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 700 }}>📈 Relatórios</h1>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
          Informação pra tomar decisão.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {ALL_REPORTS.map(r => {
          const isReady = r.status === 'ready'
          const accessible = isReady && canAccess(user, r.href)

          const Card = (
            <div style={{
              background: 'white', borderRadius: '12px', padding: '16px',
              border: '1px solid var(--border)',
              opacity: isReady ? 1 : 0.55,
              cursor: accessible ? 'pointer' : 'default',
              height: '100%',
            }}>
              <div style={{ fontSize: '1.4rem', marginBottom: '8px' }}>{r.icon}</div>
              <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 700 }}>{r.title}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.82rem', lineHeight: 1.4 }}>{r.description}</p>
              {!isReady && (
                <div style={{ marginTop: '10px' }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 8px', borderRadius: '4px',
                    background: '#fef3c7', color: '#92400e',
                    fontSize: '0.7rem', fontWeight: 600,
                  }}>Em breve</span>
                  {r.blocker && (
                    <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>{r.blocker}</p>
                  )}
                </div>
              )}
              {isReady && !accessible && (
                <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>
                  (sem permissão — peça acesso ao admin)
                </p>
              )}
            </div>
          )

          return accessible
            ? <Link key={r.href} href={r.href} style={{ textDecoration: 'none', color: 'inherit' }}>{Card}</Link>
            : <div key={r.href}>{Card}</div>
        })}
      </div>
    </div>
  )
}
