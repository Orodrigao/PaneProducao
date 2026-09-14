'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadSalesCatalog,
  loadSalesProductMappingQueue,
  saveSalesProductMapping,
} from '@/lib/salesImport/analyticsClient'
import type {
  SalesCatalogProduct,
  SalesMappingStatus,
  SalesProductMappingRow,
} from '@/lib/salesImport/analytics'

interface MappingDraft {
  productId: string
  saleUnit: 'un' | 'kg'
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })

const STATUS_LABEL: Record<SalesMappingStatus, string> = {
  pending: 'Pendente', mapped: 'Vinculado', ignored: 'Não mapear',
}

function dateLabel(value: string): string {
  return value.split('-').reverse().join('/')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function SalesProductMappingPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<SalesProductMappingRow[]>([])
  const [products, setProducts] = useState<SalesCatalogProduct[]>([])
  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>({})
  const [filter, setFilter] = useState<SalesMappingStatus | 'all'>('pending')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextRows, nextProducts] = await Promise.all([
        loadSalesProductMappingQueue(), loadSalesCatalog(),
      ])
      setRows(nextRows)
      setProducts(nextProducts)
      setDrafts(current => {
        const next = { ...current }
        nextRows.forEach(row => {
          if (next[row.external_product_key]) return
          const product = nextProducts.find(item => item.id === row.product_id) ?? nextProducts[0]
          if (!product) return
          next[row.external_product_key] = {
            productId: product.id,
            saleUnit: row.sale_unit ?? product.saleUnits[0] ?? 'un',
          }
        })
        return next
      })
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visibleRows = useMemo(() => rows.filter(row => {
    if (filter !== 'all' && row.mapping_status !== filter) return false
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return !term || `${row.raw_product_name} ${row.raw_category} ${row.product_name ?? ''}`
      .toLocaleLowerCase('pt-BR').includes(term)
  }), [filter, rows, search])

  const counts = useMemo(() => rows.reduce((result, row) => {
    result[row.mapping_status] += 1
    return result
  }, { pending: 0, mapped: 0, ignored: 0 }), [rows])

  function updateProduct(key: string, productId: string) {
    const product = products.find(item => item.id === productId)
    if (!product) return
    setDrafts(current => ({
      ...current,
      [key]: { productId, saleUnit: product.saleUnits[0] ?? 'un' },
    }))
  }

  function correctionReason(row: SalesProductMappingRow, nextStatus: SalesMappingStatus): string | null | undefined {
    if (row.mapping_status === 'pending') return undefined
    if (row.mapping_status === nextStatus && nextStatus !== 'mapped') return undefined
    const reason = window.prompt('Por que este vínculo precisa ser corrigido?')
    if (reason === null) return null
    return reason.trim()
  }

  async function save(row: SalesProductMappingRow, decision: SalesMappingStatus) {
    const draft = drafts[row.external_product_key]
    if (decision === 'mapped' && (!draft?.productId || !draft.saleUnit)) {
      setError('Escolha o produto e a forma de venda antes de vincular.')
      return
    }
    const isSameMapping = decision === 'mapped' && row.mapping_status === 'mapped'
      && row.product_id === draft.productId && row.sale_unit === draft.saleUnit
    if (isSameMapping) {
      setMessage('Este vínculo já estava salvo.')
      return
    }
    const reason = correctionReason(row, decision)
    if (reason === null) return
    setSavingKey(row.external_product_key)
    setError('')
    setMessage('')
    try {
      await saveSalesProductMapping({
        externalProductKey: row.external_product_key,
        decision,
        productId: decision === 'mapped' ? draft.productId : null,
        saleUnit: decision === 'mapped' ? draft.saleUnit : null,
        reason,
      })
      setMessage(decision === 'mapped' ? 'Produto vinculado. A análise histórica foi reorganizada.'
        : decision === 'ignored' ? 'Item marcado para permanecer pelo nome do PDV.'
          : 'Vínculo devolvido para conferência.')
      await load()
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <section className="ps-card" style={{ marginBottom: 16 }}><h2>Produtos vendidos</h2><p>Carregando vínculos…</p></section>

  return <section className="ps-card" style={{ marginBottom: 16 }}>
    <h2>3. Produtos vendidos</h2>
    <p>Ligue cada nome do PDV ao catálogo sem criar produto automaticamente. Corrigir um vínculo reorganiza a análise, mas nunca altera a venda original.</p>
    {error && <p role="alert" style={{ color: 'var(--berry)' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="ps-tabs" role="tablist" style={{ marginBottom: 12 }}>
      {([
        ['pending', `Pendentes (${counts.pending})`],
        ['mapped', `Vinculados (${counts.mapped})`],
        ['ignored', `Não mapear (${counts.ignored})`],
        ['all', `Todos (${rows.length})`],
      ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value}
        className="ps-tab" onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    <input className="ps-input" value={search} onChange={event => setSearch(event.target.value)}
      placeholder="Buscar nome do PDV ou produto vinculado" style={{ marginBottom: 12 }} />

    {rows.length === 0 ? <p>Nenhum produto vendido foi importado neste ambiente.</p>
      : visibleRows.length === 0 ? <p>Nenhum produto corresponde ao filtro.</p>
        : <div style={{ display: 'grid', gap: 12 }}>
          {visibleRows.map(row => {
            const draft = drafts[row.external_product_key]
            const selectedProduct = products.find(product => product.id === draft?.productId)
            const busy = savingKey === row.external_product_key
            return <article key={row.external_product_key} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <b>{row.raw_product_name}</b> <span className="ps-badge">{STATUS_LABEL[row.mapping_status]}</span>
                  <p style={{ margin: '4px 0' }}>{row.raw_category} · {quantity.format(Number(row.total_quantity))} na quantidade do PDV · {money.format(Number(row.total_net))}</p>
                  <small>Vendido em {row.sale_days} dia(s), de {dateLabel(row.first_sale_date)} a {dateLabel(row.last_sale_date)}{row.raw_name_count > 1 ? ` · ${row.raw_name_count} nomes observados` : ''}</small>
                  {row.product_name && <p><b>Ligado a:</b> {row.product_name} · por {row.sale_unit === 'kg' ? 'quilo' : 'unidade'}</p>}
                </div>
              </div>
              {canManage && <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(220px,2fr) minmax(120px,1fr)', marginTop: 10 }}>
                <select className="ps-input" aria-label={`Produto para ${row.raw_product_name}`} value={draft?.productId ?? ''}
                  onChange={event => updateProduct(row.external_product_key, event.target.value)} disabled={busy}>
                  {products.map(product => <option key={product.id} value={product.id}>{product.name}{product.is_revenda ? ' · revenda' : product.is_fabricacao_propria ? ' · fabricação' : ''}</option>)}
                </select>
                <select className="ps-input" aria-label={`Forma de venda para ${row.raw_product_name}`} value={draft?.saleUnit ?? 'un'}
                  onChange={event => setDrafts(current => ({ ...current, [row.external_product_key]: { ...draft, saleUnit: event.target.value as 'un' | 'kg' } }))}
                  disabled={busy}>
                  {(selectedProduct?.saleUnits ?? ['un']).map(unit => <option key={unit} value={unit}>{unit === 'kg' ? 'Quilo' : 'Unidade'}</option>)}
                </select>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, gridColumn: '1 / -1' }}>
                  <button type="button" className="ps-btn primary" disabled={busy || !draft} onClick={() => void save(row, 'mapped')}>Vincular</button>
                  <button type="button" className="ps-btn ghost" disabled={busy || row.mapping_status === 'ignored'} onClick={() => void save(row, 'ignored')}>Não mapear nesta fase</button>
                  {row.mapping_status !== 'pending' && <button type="button" className="ps-btn ghost" disabled={busy} onClick={() => void save(row, 'pending')}>Voltar a pendente</button>}
                  {busy && <span>Salvando…</span>}
                </div>
              </div>}
              {!canManage && row.mapping_status === 'pending' && <p className="ps-hint">Somente quem importa vendas pode decidir este vínculo.</p>}
            </article>
          })}
        </div>}
  </section>
}
