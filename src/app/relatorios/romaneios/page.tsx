'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, CircleDollarSign, PackageCheck, Printer, RotateCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { canPerformRomaneioAction, loadCurrentRomaneioPermissions } from '@/lib/romaneioPermissions'
import { isBuckPriceTierName, type RomaneioBillingRow } from '@/lib/romaneioBilling'
import {
  billingRowPeriodLabel,
  isMissingBuckBillingFunction,
  type RomaneioExBillingResult,
  type RomaneioExBillingRow,
} from '@/lib/romaneioExBilling'
import {
  fechamentoExFromPayload,
  formatBRL,
  formatQuantity,
  outsideNotice,
  type FechamentoEx,
} from '@/lib/romaneioExFechamento'
import PeriodFilter from '@/components/reports/PeriodFilter'
import KPICard from '@/components/reports/KPICard'
import FechamentoExCobrancas from '@/components/romaneio/FechamentoExCobrancas'
import FechamentoExPrint, { rowNameWithPeriod } from '@/components/romaneio/FechamentoExPrint'

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
  product_name: string
  unit_price: number | string | null
  pricing_unit: string | null
  active: boolean
}

interface CorrectionOption {
  productId: string
  productSource: 'bread' | 'product'
  productName: string
  unitPrice: number
  pricingUnit: 'un' | 'kg'
}

const EMPTY_BILLING: RomaneioExBillingResult = { rows: [], total: 0, tripCount: 0, itemCount: 0, hasBlockingIssues: false }

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function periodKey(range: { from: Date; to: Date }) {
  return `${toISODate(range.from)}|${toISODate(range.to)}`
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value) return value
  }
  return 'Não foi possível carregar o relatório agora.'
}

function issueLabel(row: RomaneioBillingRow) {
  if (row.issues.includes('suspicious_quantity')) {
    return 'Quantidade suspeita: mais de 10 kg num único romaneio. Confira se não foi digitado em gramas.'
  }
  if (row.issues.includes('unit_mismatch')) {
    return `Unidade incompatível: este item deve ser cobrado por ${row.billingUnit}.`
  }
  return 'Sem preço ativo na Tabela Buck para este produto.'
}

function rowSubtitle(row: RomaneioExBillingRow) {
  const period = row.priceChanged ? billingRowPeriodLabel(row) : null
  return period ? `${row.tripCount} viagem(ns) · preço ${period}` : `${row.tripCount} viagem(ns)`
}

function correctionOptionKey(option: Pick<CorrectionOption, 'productSource' | 'productId'>) {
  return `${option.productSource}:${option.productId}`
}

function correctionOptionsForRow(row: RomaneioBillingRow, prices: PriceTierItem[]): CorrectionOption[] {
  const options = new Map<string, CorrectionOption>()
  prices.forEach(price => {
    if (price.product_source !== 'bread' && price.product_source !== 'product') return
    if (price.pricing_unit !== row.billingUnit) return
    const unitPrice = Number(price.unit_price)
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return
    const option: CorrectionOption = {
      productId: price.product_id,
      productSource: price.product_source,
      productName: price.product_name,
      unitPrice,
      pricingUnit: row.billingUnit,
    }
    options.set(correctionOptionKey(option), option)
  })
  return Array.from(options.values()).sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR'))
}

export default function RelatorioRomaneiosEX() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [buckTier, setBuckTier] = useState<PriceTier | null>(null)
  // Preços de hoje: só para as opções de vínculo do avulso.
  const [prices, setPrices] = useState<PriceTierItem[]>([])
  // O fechamento do banco (semanas cobradas e o que falta cobrar), com o
  // período a que ele pertence: a tela nunca mostra nem imprime números de um
  // período com as datas de outro.
  const [loaded, setLoaded] = useState<{ key: string; fechamento: FechamentoEx } | null>(null)
  // Janela do deploy: o site novo chegou antes da função nova no banco. Sem
  // número na tela até o banco atualizar.
  const [updating, setUpdating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [canCorrectExtra, setCanCorrectExtra] = useState(false)
  const [linkingRowKey, setLinkingRowKey] = useState<string | null>(null)
  const [linkTargetKey, setLinkTargetKey] = useState('')
  const [savingLink, setSavingLink] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Só vale a resposta da última leitura pedida: trocar o período depressa
  // não deixa a resposta de um período antigo por cima da nova.
  const latestLoad = useRef(0)

  useEffect(() => {
    setUser(getCurrentUser())
    loadCurrentRomaneioPermissions()
      .then(permissions => setCanCorrectExtra(canPerformRomaneioAction(permissions, 'manage', 'ex')))
      .catch(() => setCanCorrectExtra(false))
  }, [])

  const loadReport = useCallback(async () => {
    if (!range) return
    const load = latestLoad.current + 1
    latestLoad.current = load
    const isCurrent = () => latestLoad.current === load
    const key = periodKey(range)
    setLoading(true)
    setLoadError(null)
    setUpdating(false)
    try {
      const [destinationRes, tiersRes] = await Promise.all([
        // Sem depender da caixa: producao grava 'EX' e o Banco Preview grava 'ex'.
        supabase.from('destinations').select('id,name,code').ilike('code', 'EX').eq('active', true).maybeSingle(),
        supabase.from('price_tiers').select('id,name').eq('active', true).order('name'),
      ])
      if (!isCurrent()) return
      if (destinationRes.error) throw destinationRes.error
      if (tiersRes.error) throw tiersRes.error

      const exDestination = destinationRes.data as Destination | null
      const tier = ((tiersRes.data || []) as PriceTier[]).find(item => isBuckPriceTierName(item.name)) || null
      setDestination(exDestination)
      setBuckTier(tier)

      if (!exDestination) {
        setPrices([])
        setLoaded(null)
        return
      }

      const [fechamentoRes, tierPricesRes] = await Promise.all([
        supabase.rpc('list_romaneio_ex_fechamento', { p_de: toISODate(range.from), p_ate: toISODate(range.to) }),
        tier
          ? supabase
            .from('price_tier_items')
            .select('product_id,product_source,product_name,unit_price,pricing_unit,active')
            .eq('tier_id', tier.id)
            .eq('active', true)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!isCurrent()) return
      if (tierPricesRes.error) throw tierPricesRes.error
      setPrices((tierPricesRes.data || []) as PriceTierItem[])
      if (fechamentoRes.error) {
        if (!isMissingBuckBillingFunction(fechamentoRes.error)) throw fechamentoRes.error
        setLoaded(null)
        setUpdating(true)
        return
      }
      setLoaded({ key, fechamento: fechamentoExFromPayload(fechamentoRes.data) })
    } catch (error) {
      if (!isCurrent()) return
      setLoadError(errorMessage(error))
      setPrices([])
      setLoaded(null)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    loadReport()
  }, [loadReport, reloadKey])

  // Enquanto carrega, ou se a resposta é de outro período, não há número.
  const fechamento = !loading && range && loaded?.key === periodKey(range) ? loaded.fechamento : null
  const billing = fechamento?.toBill ?? EMPTY_BILLING
  const billed = fechamento?.billed ?? []
  const showsBilled = fechamento?.showsBilled ?? false
  const rangeFrom = range ? toISODate(range.from) : ''
  const rangeTo = range ? toISODate(range.to) : ''
  const outside = fechamento && range ? outsideNotice(fechamento.outside, rangeFrom, rangeTo) : null
  const missingPriceRows = billing.rows.filter(row => row.issues.includes('missing_price'))
  const incompatibleUnitRows = billing.rows.filter(row => row.issues.includes('unit_mismatch'))
  const suspiciousRows = billing.rows.filter(row => row.issues.includes('suspicious_quantity'))
  const hasSomethingToPrint = billing.rows.length > 0 || billed.length > 0
  const canPrint = !!range && !!fechamento && hasSomethingToPrint && !billing.hasBlockingIssues
  const tableTitle = showsBilled ? 'A cobrar' : 'Itens para fechamento'
  const emptyText = showsBilled
    ? 'Nada a cobrar no período fora das semanas já cobradas.'
    : 'Nenhum romaneio enviado para a EX no período.'

  const startLinking = (row: RomaneioBillingRow) => {
    const options = correctionOptionsForRow(row, prices)
    setLinkingRowKey(row.key)
    setLinkTargetKey(options[0] ? correctionOptionKey(options[0]) : '')
    setActionMessage(null)
  }

  const cancelLinking = () => {
    if (savingLink) return
    setLinkingRowKey(null)
    setLinkTargetKey('')
  }

  const saveLink = async (row: RomaneioBillingRow) => {
    const options = correctionOptionsForRow(row, prices)
    const target = options.find(option => correctionOptionKey(option) === linkTargetKey)
    if (!target) {
      setActionMessage('Escolha um produto cadastrado com preço Buck ativo.')
      return
    }
    if (row.itemIds.length !== 1) {
      setActionMessage('Este nome reúne mais de um lançamento. Corrija cada lançamento separadamente.')
      return
    }
    if (!confirm(`Vincular este lançamento a “${target.productName}”? Preço de hoje na Tabela Buck: ${formatBRL(target.unitPrice)}/${target.pricingUnit}. A cobrança usa o preço do dia do romaneio.`)) return

    setSavingLink(true)
    setActionMessage(null)
    try {
      const { error } = await supabase.rpc('correct_romaneio_extra_item', {
        p_item_id: row.itemIds[0],
        p_product_source: target.productSource,
        p_product_id: target.productId,
      })
      if (error) throw error
      setLinkingRowKey(null)
      setLinkTargetKey('')
      setActionMessage(`Lançamento vinculado a “${target.productName}”. Recalculando a cobrança...`)
      setReloadKey(value => value + 1)
    } catch (error) {
      setActionMessage(errorMessage(error))
    } finally {
      setSavingLink(false)
    }
  }

  const renderExtraCorrection = (row: RomaneioBillingRow) => {
    if (!canCorrectExtra || row.productSource !== 'extra' || !row.issues.includes('missing_price')) return null
    const options = correctionOptionsForRow(row, prices)
    const isOpen = linkingRowKey === row.key
    return (
      <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(178, 103, 40, 0.09)' }}>
        {options.length === 0 ? (
          <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>Nenhum produto com preço Buck ativo nesta unidade.</span>
        ) : isOpen ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <select
              className="ps-input"
              style={{ flex: '1 1 220px', minWidth: 0, padding: '6px 8px', fontSize: 12 }}
              value={linkTargetKey}
              onChange={event => setLinkTargetKey(event.target.value)}
              disabled={savingLink}
              aria-label={`Produto cadastrado para ${row.productName}`}
            >
              {options.map(option => (
                <option key={correctionOptionKey(option)} value={correctionOptionKey(option)}>
                  {option.productName} — {formatBRL(option.unitPrice)}/{option.pricingUnit}
                </option>
              ))}
            </select>
            <button className="ps-btn sm" onClick={() => saveLink(row)} disabled={savingLink}>
              {savingLink ? 'Salvando...' : 'Confirmar vínculo'}
            </button>
            <button className="ps-btn ghost sm" onClick={cancelLinking} disabled={savingLink}>Cancelar</button>
          </div>
        ) : (
          <button className="ps-btn ghost sm" onClick={() => startLinking(row)}>
            Vincular ao produto cadastrado
          </button>
        )}
      </div>
    )
  }

  const printBlockedReason = !range || !fechamento
    ? null
    : !hasSomethingToPrint
      ? 'nada a imprimir no período'
      : billing.hasBlockingIssues
        ? 'complete os preços para imprimir'
        : null

  return (
    <>
      {range && fechamento && (
        <FechamentoExPrint
          rows={billing.rows}
          total={billing.total}
          period={{ from: rangeFrom, to: rangeTo }}
          tripCount={billing.tripCount}
          showsBilled={showsBilled}
          billed={billed}
          billedTotal={fechamento.billedTotal}
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
            <p className="ps-page-lead">Cobrança dos pães enviados à EX pela Tabela BUCK, com o preço do dia de cada romaneio.</p>
            <p className="ps-hint" style={{ marginTop: -6 }}>
              {showsBilled
                ? 'Semana já cobrada aparece com o que foi cobrado, inteira no período que contém o domingo dela; o resto sai pelo preço do dia.'
                : 'Semana já cobrada: o valor cobrado fica no Contas a receber e pode diferir desta conta.'}
            </p>

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
            {updating && !loadError && (
              <div className="ps-warning danger" role="alert">
                <AlertTriangle size={16}/>
                O sistema está sendo atualizado: o Fechamento EX volta em alguns minutos. Toque em Atualizar.
              </div>
            )}
            {actionMessage && (
              <div className="ps-warning" role="status">{actionMessage}</div>
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
                {incompatibleUnitRows.length} produto(s) têm unidade incompatível. Ciabatta, mini croissant e Pizza Romana devem estar em kg; os demais, em unidade.
              </div>
            )}
            {suspiciousRows.length > 0 && (
              <div className="ps-warning danger" role="alert">
                <AlertTriangle size={16}/>
                {suspiciousRows.length} produto(s) com quantidade suspeita: mais de 10 kg num único romaneio — pode ter sido digitado em gramas. A cobrança fica bloqueada até o lançamento ser conferido.
              </div>
            )}

            {!fechamento && loading && (
              <p role="status" style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '14px 0' }}>Carregando o fechamento…</p>
            )}

            {fechamento && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' }}>
                  <KPICard label={showsBilled ? 'Viagens a cobrar' : 'Viagens'} value={billing.tripCount} accent="sage" />
                  <KPICard label={showsBilled ? 'Produtos a cobrar' : 'Produtos'} value={billing.rows.length} />
                  {showsBilled
                    ? <KPICard label="Já cobrado no período" value={formatBRL(fechamento.billedTotal)} />
                    : <KPICard label="Itens lançados" value={billing.itemCount} />}
                  <KPICard label={showsBilled ? 'A cobrar' : 'Total para cobrança'} value={billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)} accent={billing.hasBlockingIssues ? 'berry' : 'sage'} />
                </div>

                {showsBilled && <FechamentoExCobrancas cobrancas={billed} rangeFrom={rangeFrom}/>}

                <div className="ps-section-row">
                  <h2>{tableTitle}</h2>
                </div>
                {outside && <p className="ps-help" style={{ marginTop: 0 }}>{outside}</p>}

                <div className="ps-table-wrap has-mobile-cards">
                  <table className="ps-table" aria-label={tableTitle}>
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
                      {billing.rows.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>{emptyText}</td></tr>
                      )}
                      {billing.rows.map(row => (
                        <tr key={row.key}>
                          <td>
                            <b>{row.productName}</b>
                            <div style={{ color: row.issues.length ? 'var(--berry)' : 'var(--ink-soft)', fontSize: 11, marginTop: 3 }}>
                              {row.issues.length ? issueLabel(row) : rowSubtitle(row)}
                            </div>
                            {renderExtraCorrection(row)}
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
                          <td colSpan={4}>{showsBilled ? 'TOTAL A COBRAR' : 'TOTAL PARA COBRANÇA'}</td>
                          <td className="right">{billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div className="ps-report-card-list">
                  {billing.rows.length === 0 && (
                    <div className="ps-empty">{emptyText}</div>
                  )}
                  {billing.rows.map(row => (
                    <div key={row.key} className="ps-report-row-card">
                      <div className="ps-report-row-head">
                        <div className="ps-report-row-title">{rowNameWithPeriod(row)}</div>
                        <span className={row.issues.length ? 'ps-status com_divergencia' : 'ps-status conferido'}>{row.billingUnit}</span>
                      </div>
                      <div className="ps-report-row-grid">
                        <div className="ps-report-row-metric"><span>Enviado</span><b>{formatQuantity(row.sentQuantity, row.billingUnit)}</b></div>
                        <div className="ps-report-row-metric"><span>Cobrado</span><b>{formatQuantity(row.billedQuantity, row.billingUnit)}</b></div>
                        <div className="ps-report-row-metric"><span>Preço Buck</span><b>{row.unitPrice === null ? 'Pendente' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</b></div>
                        <div className="ps-report-row-metric"><span>Total</span><b>{row.total === null ? '—' : formatBRL(row.total)}</b></div>
                      </div>
                      {row.issues.length > 0 && <div className="ps-report-row-note">{issueLabel(row)}</div>}
                      {renderExtraCorrection(row)}
                    </div>
                  ))}
                </div>

                {hasSomethingToPrint && (
                  <div className="ps-totalbar" style={{ marginTop: 16 }}>
                    <div className="ps-total-num">
                      <b>{billing.hasBlockingIssues ? 'Pendente' : formatBRL(billing.total)}</b>
                      <span>{printBlockedReason ?? (showsBilled ? 'a cobrar da EX no período' : 'total da cobrança EX')}</span>
                    </div>
                    <button className="ps-save" onClick={() => window.print()} disabled={!canPrint}>
                      <PackageCheck size={16}/> Imprimir cobrança
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
