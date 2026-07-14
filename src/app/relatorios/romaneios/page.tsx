'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, CircleDollarSign, PackageCheck, Printer, RotateCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { formatDateBR } from '@/lib/utils'
import {
  calculateRomaneioBilling,
  isBuckPriceTierName,
  type RomaneioBillingItem,
  type RomaneioBillingPrice,
  type RomaneioBillingRow,
} from '@/lib/romaneioBilling'
import PeriodFilter from '@/components/reports/PeriodFilter'
import KPICard from '@/components/reports/KPICard'

interface Destination {
  id: string
  name: string
  code: string
}

interface PriceTier {
  id: string
  name: string
}

interface PriceTierItem {
  product_id: string
  product_source: string
  unit_price: number | string | null
  pricing_unit: string | null
  active: boolean
}

interface Romaneio {
  id: string
  record_date: string
  trip_number: number
  status: string
}

interface RomaneioItem {
  id: string
  romaneio_id: string
  product_id: string
  product_source: string
  product_name: string
  qty_sent: number | string | null
  qty_accepted: number | string | null
}

const PANE_SENDER = {
  store: 'Pane Júlio',
  company: 'RGF PANE PIZZA LTDA',
  cnpj: '55.800.425/0001-77',
}

const BUCK_RECIPIENT = {
  store: 'EX — Exposição',
  company: 'Buck Comércio de Alimentos LTDA - ME',
  cnpj: '28.994.014/0001-97',
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatQuantity(value: number, unit: 'un' | 'kg') {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value) return value
  }
  return 'Não foi possível carregar o relatório agora.'
}

function issueLabel(row: RomaneioBillingRow) {
  if (row.issues.includes('unit_mismatch')) {
    return `Unidade incompatível: este item deve ser cobrado por ${row.billingUnit}.`
  }
  return 'Sem preço ativo na Tabela Buck para este produto.'
}

function BillingPrint({
  rows,
  total,
  period,
  tripCount,
}: {
  rows: RomaneioBillingRow[]
  total: number
  period: { from: Date; to: Date }
  tripCount: number
}) {
  return (
    <section id="romaneios-ex-print" aria-hidden="true">
      <header className="rom-ex-print-header">
        <div>
          <h1>Fechamento de Romaneios — EX</h1>
          <p>Base para cobrança dos pães enviados à Exposição.</p>
        </div>
        <div className="rom-ex-print-meta">
          <span>Período</span>
          <b>{formatDateBR(toISODate(period.from))} a {formatDateBR(toISODate(period.to))}</b>
          <span>Viagens incluídas</span>
          <b>{tripCount}</b>
        </div>
      </header>

      <div className="rom-ex-print-parties">
        <section>
          <h2>Remetente</h2>
          <b>{PANE_SENDER.store}</b>
          <p>{PANE_SENDER.company}</p>
          <p>CNPJ: {PANE_SENDER.cnpj}</p>
        </section>
        <section>
          <h2>Destinatário / cobrança</h2>
          <b>{BUCK_RECIPIENT.store}</b>
          <p>{BUCK_RECIPIENT.company}</p>
          <p>CNPJ: {BUCK_RECIPIENT.cnpj}</p>
        </section>
      </div>

      <p className="rom-ex-print-note">Preços da Tabela BUCK. Quantidade cobrada: aceita na conferência ou, sem conferência, enviada.</p>

      <table className="rom-ex-print-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Enviado</th>
            <th>Cobrado</th>
            <th>Preço</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td>{row.productName}</td>
              <td>{formatQuantity(row.sentQuantity, row.billingUnit)}</td>
              <td>{formatQuantity(row.billedQuantity, row.billingUnit)}</td>
              <td>{row.unitPrice === null ? '—' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</td>
              <td>{row.total === null ? '—' : formatBRL(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>TOTAL PARA COBRANÇA</td>
            <td>{formatBRL(total)}</td>
          </tr>
        </tfoot>
      </table>

      <footer className="rom-ex-print-signatures">
        <div>Conferido pela Pane</div>
        <div>Conferido pela EX</div>
      </footer>
    </section>
  )
}

export default function RelatorioRomaneiosEX() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [buckTier, setBuckTier] = useState<PriceTier | null>(null)
  const [items, setItems] = useState<RomaneioItem[]>([])
  const [prices, setPrices] = useState<PriceTierItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  const loadReport = useCallback(async () => {
    if (!range) return
    setLoading(true)
    setLoadError(null)
    try {
      const [destinationRes, tiersRes] = await Promise.all([
        supabase.from('destinations').select('id,name,code').eq('code', 'EX').eq('active', true).maybeSingle(),
        supabase.from('price_tiers').select('id,name').eq('active', true).order('name'),
      ])
      if (destinationRes.error) throw destinationRes.error
      if (tiersRes.error) throw tiersRes.error

      const exDestination = destinationRes.data as Destination | null
      const tier = ((tiersRes.data || []) as PriceTier[]).find(item => isBuckPriceTierName(item.name)) || null
      setDestination(exDestination)
      setBuckTier(tier)

      if (!exDestination) {
        setItems([])
        setPrices([])
        return
      }

      const from = toISODate(range.from)
      const to = toISODate(range.to)
      const [romaneiosRes, pricesRes] = await Promise.all([
        supabase
          .from('romaneios')
          .select('id,record_date,trip_number,status')
          .eq('destination_id', exDestination.id)
          .gte('record_date', from)
          .lte('record_date', to)
          .neq('status', 'separado')
          .order('record_date', { ascending: true })
          .order('trip_number', { ascending: true }),
        tier
          ? supabase
            .from('price_tier_items')
            .select('product_id,product_source,unit_price,pricing_unit,active')
            .eq('tier_id', tier.id)
            .eq('active', true)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (romaneiosRes.error) throw romaneiosRes.error
      if (pricesRes.error) throw pricesRes.error

      const romaneioRows = (romaneiosRes.data || []) as Romaneio[]
      setPrices((pricesRes.data || []) as PriceTierItem[])

      if (romaneioRows.length === 0) {
        setItems([])
        return
      }

      const itemsRes = await supabase
        .from('romaneio_items')
        .select('id,romaneio_id,product_id,product_source,product_name,qty_sent,qty_accepted')
        .in('romaneio_id', romaneioRows.map(row => row.id))
        .order('product_name')
      if (itemsRes.error) throw itemsRes.error
      setItems((itemsRes.data || []) as RomaneioItem[])
    } catch (error) {
      setLoadError(errorMessage(error))
      setItems([])
      setPrices([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    loadReport()
  }, [loadReport, reloadKey])

  const billing = useMemo(() => calculateRomaneioBilling(
    items.map(item => ({
      id: item.id,
      romaneioId: item.romaneio_id,
      productId: item.product_id,
      productSource: item.product_source,
      productName: item.product_name,
      qtySent: item.qty_sent,
      qtyAccepted: item.qty_accepted,
    } satisfies RomaneioBillingItem)),
    prices.map(price => ({
      productId: price.product_id,
      productSource: price.product_source,
      unitPrice: price.unit_price,
      pricingUnit: price.pricing_unit,
      active: price.active,
    } satisfies RomaneioBillingPrice)),
  ), [items, prices])

  const missingPriceRows = billing.rows.filter(row => row.issues.includes('missing_price'))
  const incompatibleUnitRows = billing.rows.filter(row => row.issues.includes('unit_mismatch'))
  const canPrint = !!range && billing.rows.length > 0 && !billing.hasBlockingIssues

  return (
    <>
      {range && (
        <BillingPrint
          rows={billing.rows}
          total={billing.total}
          period={range}
          tripCount={billing.tripCount}
        />
      )}

      <div className="ps-canvas">
        <div className="ps-shell">
          <header className="ps-header">
            <div className="ps-wordmark">
              <button className="ps-iconbtn" onClick={() => router.push('/relatorios')} aria-label="Voltar">
                <ChevronLeft size={20}/>
              </button>
              <div className="ps-mark">P</div>
              <div className="ps-brand">
                <b>Romaneios EX</b>
                <span>Fechamento e cobrança</span>
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
            <h1 className="ps-page-title">🚚 Fechamento EX</h1>
            <p className="ps-page-lead">Cobrança dos pães enviados à EX pela Tabela BUCK.</p>

            <div className="ps-filters" style={{ alignItems: 'center' }}>
              <PeriodFilter defaultPreset="30d" onChange={setRange} />
              <button className="ps-btn ghost sm" onClick={() => setReloadKey(value => value + 1)} disabled={loading}>
                <RotateCw size={14}/> Atualizar
              </button>
              <button className="ps-btn ghost sm" onClick={() => router.push('/tabelas-preco')}>
                <CircleDollarSign size={14}/> Tabela Buck
              </button>
              <button className="ps-btn primary sm" onClick={() => window.print()} disabled={!canPrint}>
                <Printer size={14}/> Imprimir cobrança
              </button>
            </div>

            {loadError && (
              <div className="ps-warning danger" role="alert">{loadError}</div>
            )}
            {!loadError && destination === null && range && !loading && (
              <div className="ps-warning danger" role="alert">O destino EX não está ativo no cadastro de destinos.</div>
            )}
            {!loadError && destination && !buckTier && !loading && (
              <div className="ps-warning danger" role="alert">A tabela de preço ativa “BUCK” não foi encontrada.</div>
            )}
            {!loadError && buckTier && prices.length === 0 && !loading && (
              <div className="ps-warning" role="alert">
                A Tabela Buck ainda não possui preços ativos. A Elis pode preenchê-la em “Tabela Buck”; o relatório atualizará os valores ao recarregar.
              </div>
            )}
            {missingPriceRows.length > 0 && (
              <div className="ps-warning" role="alert">
                <AlertTriangle size={16}/>
                {missingPriceRows.length} produto(s) sem preço na Tabela Buck. Eles não entram no total nem podem ser impressos para cobrança.
              </div>
            )}
            {incompatibleUnitRows.length > 0 && (
              <div className="ps-warning danger" role="alert">
                <AlertTriangle size={16}/>
                {incompatibleUnitRows.length} produto(s) têm unidade incompatível. Ciabatta e mini croissant devem estar em kg; os demais, em unidade.
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' }}>
              <KPICard label="Viagens" value={billing.tripCount} accent="sage" />
              <KPICard label="Produtos" value={billing.rows.length} />
              <KPICard label="Itens lançados" value={billing.itemCount} />
              <KPICard label="Total para cobrança" value={billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)} accent={billing.hasBlockingIssues ? 'berry' : 'sage'} />
            </div>

            <div className="ps-section-row">
              <h2>Itens para fechamento</h2>
              {loading && <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Carregando…</span>}
            </div>

            <div className="ps-table-wrap has-mobile-cards">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="right">Enviado</th>
                    <th className="right">Cobrado</th>
                    <th className="right">Preço Buck</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && billing.rows.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>Nenhum romaneio enviado para a EX no período.</td></tr>
                  )}
                  {billing.rows.map(row => (
                    <tr key={row.key}>
                      <td>
                        <b>{row.productName}</b>
                        <div style={{ color: row.issues.length ? 'var(--berry)' : 'var(--ink-soft)', fontSize: 11, marginTop: 3 }}>
                          {row.issues.length ? issueLabel(row) : `${row.tripCount} viagem(ns)`}
                        </div>
                      </td>
                      <td className="right">{formatQuantity(row.sentQuantity, row.billingUnit)}</td>
                      <td className="right">{formatQuantity(row.billedQuantity, row.billingUnit)}</td>
                      <td className="right">{row.unitPrice === null ? '—' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</td>
                      <td className="right"><b>{row.total === null ? '—' : formatBRL(row.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
                {billing.rows.length > 0 && (
                  <tfoot>
                    <tr className="total">
                      <td colSpan={4}>TOTAL PARA COBRANÇA</td>
                      <td className="right">{billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="ps-report-card-list">
              {!loading && billing.rows.length === 0 && (
                <div className="ps-empty">Nenhum romaneio enviado para a EX no período.</div>
              )}
              {billing.rows.map(row => (
                <div key={row.key} className="ps-report-row-card">
                  <div className="ps-report-row-head">
                    <div className="ps-report-row-title">{row.productName}</div>
                    <span className={row.issues.length ? 'ps-status com_divergencia' : 'ps-status conferido'}>{row.billingUnit}</span>
                  </div>
                  <div className="ps-report-row-grid">
                    <div className="ps-report-row-metric"><span>Enviado</span><b>{formatQuantity(row.sentQuantity, row.billingUnit)}</b></div>
                    <div className="ps-report-row-metric"><span>Cobrado</span><b>{formatQuantity(row.billedQuantity, row.billingUnit)}</b></div>
                    <div className="ps-report-row-metric"><span>Preço Buck</span><b>{row.unitPrice === null ? 'Pendente' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</b></div>
                    <div className="ps-report-row-metric"><span>Total</span><b>{row.total === null ? '—' : formatBRL(row.total)}</b></div>
                  </div>
                  {row.issues.length > 0 && <div className="ps-report-row-note">{issueLabel(row)}</div>}
                </div>
              ))}
            </div>

            {billing.rows.length > 0 && (
              <div className="ps-totalbar" style={{ marginTop: 16 }}>
                <div className="ps-total-num">
                  <b>{billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)}</b>
                  <span>{billing.hasBlockingIssues ? 'complete os preços para imprimir' : 'total da cobrança EX'}</span>
                </div>
                <button className="ps-save" onClick={() => window.print()} disabled={!canPrint}>
                  <PackageCheck size={16}/> Imprimir cobrança
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
