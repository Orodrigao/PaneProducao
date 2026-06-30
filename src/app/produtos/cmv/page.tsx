'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ClipboardList, RotateCw, Search, Tags, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import {
  buildProductCmvAudits,
  type AuditCatalogItem,
  type AuditComponent,
  type AuditPriceLine,
  type AuditPriceTier,
  type AuditProduct,
  type AuditYield,
  type CmvAuditStatus,
  type ProductCmvAudit,
} from '@/lib/cmvAudit'

type FilterKey = 'todos' | 'atencao' | 'sem_ficha' | 'sem_rendimento' | 'sem_preco' | 'margem_ruim' | 'boa'

const STATUS_STYLE: Record<CmvAuditStatus, { background: string; color: string; border: string }> = {
  boa: { background: '#dcfce7', color: '#166534', border: '#bbf7d0' },
  media: { background: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  ruim: { background: '#ffedd5', color: '#9a3412', border: '#fed7aa' },
  prejuizo: { background: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  sem_ficha: { background: 'var(--berry-tint)', color: 'var(--berry)', border: 'var(--berry-tint)' },
  sem_custo: { background: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  sem_rendimento: { background: 'var(--honey-tint)', color: 'var(--honey-deep)', border: 'var(--honey)' },
  sem_preco: { background: 'var(--line-soft)', color: 'var(--ink-soft)', border: 'var(--ps-line)' },
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function formatBRL(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function isAttention(audit: ProductCmvAudit): boolean {
  return audit.status !== 'boa'
}

function matchesFilter(audit: ProductCmvAudit, filter: FilterKey): boolean {
  if (filter === 'todos') return true
  if (filter === 'atencao') return isAttention(audit)
  if (filter === 'margem_ruim') return audit.status === 'prejuizo' || audit.status === 'ruim'
  if (filter === 'boa') return audit.status === 'boa'
  return audit.status === filter
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'alert' | 'ok' }) {
  const color = tone === 'alert' ? 'var(--berry)' : tone === 'ok' ? 'var(--sage)' : 'var(--ps-ink)'
  return (
    <div className="ps-card" style={{ padding: 12 }}>
      <div className="ps-flabel" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function StatusChip({ status, label }: { status: CmvAuditStatus; label: string }) {
  const style = STATUS_STYLE[status]
  return (
    <span className="ps-store-chip" style={{ background: style.background, color: style.color, border: `1px solid ${style.border}` }}>
      {label}
    </span>
  )
}

export default function ProdutosCmvPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [audits, setAudits] = useState<ProductCmvAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('atencao')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [productsRes, componentsRes, breadsRes, yieldsRes, tiersRes, linesRes] = await Promise.all([
        supabase
          .from('products')
          .select('id,name,category,unit,cost_price,active,kind,is_revenda,is_fabricacao_propria,legacy_bread_id')
          .order('name'),
        supabase
          .from('product_components')
          .select('parent_product_id,component_source,component_id,quantity'),
        supabase
          .from('breads')
          .select('id,name,unit,cost_price'),
        supabase
          .from('product_recipe_yields')
          .select('product_id,basis,dough_weight_kg,finished_weight_kg,yield_units,average_unit_weight_kg'),
        supabase
          .from('price_tiers')
          .select('id,name,active'),
        supabase
          .from('price_tier_items')
          .select('tier_id,product_source,product_id,product_name,unit_price,pricing_unit,active,sale_option_id'),
      ])
      const firstError = [productsRes, componentsRes, breadsRes, yieldsRes, tiersRes, linesRes].find(result => result.error)?.error
      if (firstError) throw firstError

      const products = (productsRes.data || []) as AuditProduct[]
      setAudits(buildProductCmvAudits({
        products,
        productCatalog: products as AuditCatalogItem[],
        breadCatalog: (breadsRes.data || []) as AuditCatalogItem[],
        components: (componentsRes.data || []) as AuditComponent[],
        yields: (yieldsRes.data || []) as AuditYield[],
        priceTiers: (tiersRes.data || []) as AuditPriceTier[],
        priceLines: (linesRes.data || []) as AuditPriceLine[],
      }))
    } catch (error: unknown) {
      setLoadError(errorMessage(error, 'Falha ao carregar auditoria de CMV.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setUser(getCurrentUser())
    load()
  }, [load])

  const filteredAudits = useMemo(() => {
    const q = normalizeText(search.trim())
    return audits.filter(audit => {
      const text = normalizeText(`${audit.product.name} ${audit.product.category || ''}`)
      return (!q || text.includes(q)) && matchesFilter(audit, filter)
    })
  }, [audits, filter, search])

  const counts = useMemo(() => ({
    total: audits.length,
    attention: audits.filter(isAttention).length,
    noRecipe: audits.filter(audit => audit.status === 'sem_ficha').length,
    badMargin: audits.filter(audit => audit.status === 'prejuizo' || audit.status === 'ruim').length,
  }), [audits])

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'atencao', label: 'Atenção', count: counts.attention },
    { key: 'todos', label: 'Todos', count: counts.total },
    { key: 'sem_ficha', label: 'Sem ficha', count: counts.noRecipe },
    { key: 'sem_rendimento', label: 'Sem rendimento', count: audits.filter(audit => audit.status === 'sem_rendimento').length },
    { key: 'sem_preco', label: 'Sem preço', count: audits.filter(audit => audit.status === 'sem_preco').length },
    { key: 'margem_ruim', label: 'Margem ruim', count: counts.badMargin },
    { key: 'boa', label: 'Boa margem', count: audits.filter(audit => audit.status === 'boa').length },
  ]

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <Link href="/produtos" className="ps-iconbtn" style={{ marginRight: 8 }}>
              <ArrowLeft size={16} />
            </Link>
            <div className="ps-brand">
              <b>Auditoria CMV</b>
              <span>Produtos &amp; margens</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{ background: roleColor(user.role) }}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))', gap: 8, marginTop: 14, marginBottom: 12 }}>
            <StatCard label="Produtos" value={counts.total} />
            <StatCard label="Atenção" value={counts.attention} tone="alert" />
            <StatCard label="Sem ficha" value={counts.noRecipe} tone="alert" />
            <StatCard label="Margem ruim" value={counts.badMargin} tone={counts.badMargin > 0 ? 'alert' : 'ok'} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar produto..."
                className="ps-input"
                style={{ width: '100%', paddingLeft: 30 }}
              />
            </div>
            <button onClick={() => load()} className="ps-iconbtn" style={{ width: 42, height: 42 }} title="Recarregar">
              <RotateCw size={16} />
            </button>
          </div>

          <div className="ps-presets" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {filters.map(item => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`ps-preset ${filter === item.key ? 'active' : ''}`}
              >
                {item.label} ({item.count})
              </button>
            ))}
          </div>

          {loading ? (
            <div className="ps-empty">Carregando auditoria...</div>
          ) : loadError ? (
            <div className="ps-empty">
              <AlertTriangle size={36} style={{ display: 'block', margin: '0 auto 8px', color: 'var(--berry)', opacity: .6 }} />
              <div style={{ color: 'var(--berry)', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Não foi possível carregar os dados.</div>
              <div style={{ color: 'var(--ink-faint)', fontSize: 12, marginBottom: 14 }}>{loadError}</div>
              <button onClick={() => load()} className="ps-btn primary">
                <RotateCw size={14} /> Tentar de novo
              </button>
            </div>
          ) : filteredAudits.length === 0 ? (
            <div className="ps-empty">Nenhum produto encontrado nesse filtro.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, paddingBottom: 16 }}>
              {filteredAudits.map(audit => (
                <div key={audit.product.id} className="ps-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ps-ink)' }}>{audit.product.name}</div>
                        <StatusChip status={audit.status} label={audit.statusLabel} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                        {audit.product.category || 'sem categoria'}
                      </div>
                    </div>
                    <Link href={`/produtos/composicao?id=${audit.product.id}`} className="ps-btn sm ghost" style={{ flexShrink: 0 }}>
                      <ClipboardList size={13} />
                      Ficha
                    </Link>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
                    <div>
                      <div className="ps-flabel" style={{ marginBottom: 2 }}>CMV/un</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ps-ink)' }}>{formatBRL(audit.cmvUnit)}</div>
                    </div>
                    <div>
                      <div className="ps-flabel" style={{ marginBottom: 2 }}>CMV/kg</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ps-ink)' }}>{formatBRL(audit.cmvKgBaked)}</div>
                    </div>
                    <div>
                      <div className="ps-flabel" style={{ marginBottom: 2 }}>Cadastro</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ps-ink)' }}>{formatBRL(audit.savedCost)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                    <span className="ps-store-chip">
                      <TrendingUp size={11} />
                      {audit.componentCount} comp.
                    </span>
                    {audit.missingCostCount > 0 && (
                      <span className="ps-store-chip" style={{ background: '#fee2e2', color: '#991b1b' }}>
                        {audit.missingCostCount} sem custo
                      </span>
                    )}
                    <span className="ps-store-chip">
                      rende {formatNumber(audit.yieldUnits, 2)} un
                    </span>
                    {audit.averageUnitWeightKg !== null && (
                      <span className="ps-store-chip">
                        {formatNumber(audit.averageUnitWeightKg, 3)} kg/un
                      </span>
                    )}
                    <span className="ps-store-chip">
                      <Tags size={11} />
                      {audit.priceCount} preço(s)
                    </span>
                  </div>

                  {audit.worstPrice && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 2 }}>Pior margem encontrada</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ps-ink)' }}>
                          {audit.worstPrice.tierName} · {formatBRL(audit.worstPrice.unitPrice)}/{audit.worstPrice.pricingUnit}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: audit.worstPrice.marginStatus === 'boa' ? 'var(--sage)' : 'var(--berry)' }}>
                          {audit.worstPrice.marginLabel}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                          {formatPct(audit.worstPrice.marginPct)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
