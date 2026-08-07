'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Download, Printer, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  formatBRL,
  formatDate,
  installmentLabel,
  loadPayablePurchases,
  type PayablePurchaseRow,
} from '@/lib/payables'
import { buildPayablesReport, buildPayablesReportExportRows, type PayablesReportMode } from '@/lib/payablesReport'

function monthStart(today = new Date()): string {
  return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
}

function todayString(today = new Date()): string {
  return today.toISOString().slice(0, 10)
}

function supplierName(purchase: PayablePurchaseRow): string {
  const related = purchase.suppliers
  return (Array.isArray(related) ? related[0]?.name : related?.name) ?? 'Fornecedor não identificado'
}

function documentLabel(purchase: PayablePurchaseRow): string {
  if (purchase.origin === 'xml') return `NF-e ${purchase.nfe_number ?? 'sem número'}`
  return purchase.document_type === 'sem_nota' ? 'Sem nota' : 'Recibo'
}

function paidDate(value: string | null | undefined): string {
  return value ? formatDate(value.slice(0, 10)) : '-'
}

function brNumber(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function reportModeLabel(mode: PayablesReportMode): string {
  return mode === 'compras' ? 'Compras realizadas pela data da compra' : 'Movimento financeiro por vencimentos e baixas'
}

export default function ContasPagarRelatorioPage() {
  const router = useRouter()
  const [purchases, setPurchases] = useState<PayablePurchaseRow[]>([])
  const [mode, setMode] = useState<PayablesReportMode>('compras')
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(todayString)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPurchases(await loadPayablePurchases())
    } catch (loadError) {
      console.error(loadError)
      setError('Não foi possível carregar os dados do relatório. Confira sua permissão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const report = useMemo(() => buildPayablesReport(purchases, { mode, from, to }), [purchases, mode, from, to])

  async function handleExport() {
    if (report.rows.length === 0) return
    const { utils, write } = await import('xlsx')
    const rows = buildPayablesReportExportRows(report).map(row => ({
      Fornecedor: row.fornecedor,
      Documento: row.documento,
      'Data da compra': row.data_compra ? formatDate(row.data_compra) : '',
      Parcela: row.parcela,
      Vencimento: row.vencimento ? formatDate(row.vencimento) : '',
      Baixa: row.baixa ? formatDate(row.baixa) : '',
      Situação: row.situacao,
      'Valor (R$)': brNumber(row.valor),
      Critério: row.criterio,
    }))
    const summaryRows = [
      ['Contas a pagar', reportModeLabel(mode)],
      ['Período', `${from ? formatDate(from) : '-'} a ${to ? formatDate(to) : '-'}`],
      [],
      ['Indicador', 'Valor'],
      [mode === 'compras' ? 'Total comprado' : 'Vencimentos no período', brNumber(mode === 'compras' ? report.summary.purchaseTotal : report.summary.scheduledTotal)],
      ['Baixado', brNumber(report.summary.paidTotal)],
      ['Em aberto', brNumber(report.summary.openTotal)],
      ['Vencido', brNumber(report.summary.overdueTotal)],
      [],
      ['Contas', report.purchases.length],
      ['Parcelas', report.rows.length],
    ]
    const detailRows = [
      ['Fornecedor', 'Documento', 'Data da compra', 'Parcela', 'Vencimento', 'Baixa', 'Situação', 'Valor (R$)', 'Critério'],
      ...rows.map(row => Object.values(row)),
    ]
    const workbook = utils.book_new()
    const summarySheet = utils.aoa_to_sheet(summaryRows)
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 30 }]
    summarySheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    const detailSheet = utils.aoa_to_sheet(detailRows)
    detailSheet['!cols'] = [
      { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 16 },
      { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 24 },
    ]
    detailSheet['!autofilter'] = { ref: `A1:I${detailRows.length}` }
    utils.book_append_sheet(workbook, summarySheet, 'Resumo')
    utils.book_append_sheet(workbook, detailSheet, 'Parcelas')
    const file = write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `contas-a-pagar-${mode}-${from}-a-${to}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function handlePrint() {
    if (report.rows.length > 0) window.print()
  }

  return (
    <>
    <div className="ps-canvas payables-report-screen">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/contas-pagar')} aria-label="Voltar para contas a pagar"><ArrowLeft size={18} /></button>
            <div className="ps-mark"><BarChart3 size={18} /></div>
            <div className="ps-brand"><b>Relatório financeiro</b><span>Contas a pagar da JC</span></div>
          </div>
          <button className="ps-iconbtn" onClick={() => void load()} aria-label="Atualizar relatório" title="Atualizar"><RefreshCw size={17} /></button>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <b>Relatório por período</b>
            <small>Escolha se quer analisar as compras realizadas ou o movimento das parcelas.</small>
          </div>

          <div className="ps-card" style={{ marginTop: 14, padding: 10 }}>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="report-mode">Modo do relatório</label>
              <select id="report-mode" className="ps-select" value={mode} onChange={event => setMode(event.target.value as PayablesReportMode)}>
                <option value="compras">Compras realizadas — pela data da NF/compra</option>
                <option value="financeiro">Movimento financeiro — vencimentos e baixas</option>
              </select>
            </div>
            <div className="ps-fieldrow" style={{ marginTop: 8 }}>
              <div className="ps-fieldgroup">
                <label className="ps-fieldlabel" htmlFor="report-from">De</label>
                <input id="report-from" className="ps-input" type="date" value={from} onChange={event => setFrom(event.target.value)} />
              </div>
              <div className="ps-fieldgroup">
                <label className="ps-fieldlabel" htmlFor="report-to">Até</label>
                <input id="report-to" className="ps-input" type="date" value={to} onChange={event => setTo(event.target.value)} />
              </div>
            </div>
          </div>

          <div className="ps-report-actions no-print" style={{ marginTop: 10 }}>
            <button className="ps-btn ghost" onClick={handleExport} disabled={report.rows.length === 0}>
              <Download size={16} /> Exportar Excel
            </button>
            <button className="ps-btn ghost" onClick={handlePrint} disabled={report.rows.length === 0}>
              <Printer size={16} /> Imprimir
            </button>
          </div>

          {error && <div className="ps-card" style={{ marginTop: 12, borderColor: 'var(--berry)' }}><b>Não carregou</b><p style={{ margin: '6px 0 10px' }}>{error}</p><button className="ps-btn ghost sm" onClick={() => void load()}>Tentar novamente</button></div>}

          {loading ? <div className="ps-empty">Carregando relatório...</div> : (
            <>
              <div className="ps-label">Resumo do período</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 10 }}>
                <div className="ps-card" style={{ padding: 12 }}><small>{mode === 'compras' ? 'Total comprado' : 'Vencimentos no período'}</small><strong style={{ display: 'block', fontSize: 19, marginTop: 4 }}>{formatBRL(mode === 'compras' ? report.summary.purchaseTotal : report.summary.scheduledTotal)}</strong></div>
                <div className="ps-card" style={{ padding: 12 }}><small>Baixado</small><strong style={{ display: 'block', fontSize: 19, marginTop: 4 }}>{formatBRL(report.summary.paidTotal)}</strong></div>
                <div className="ps-card" style={{ padding: 12 }}><small>Em aberto</small><strong style={{ display: 'block', fontSize: 19, marginTop: 4 }}>{formatBRL(report.summary.openTotal)}</strong></div>
                <div className="ps-card" style={{ padding: 12, borderColor: report.summary.overdueTotal > 0 ? 'var(--berry)' : undefined }}><small>Vencido</small><strong style={{ display: 'block', fontSize: 19, marginTop: 4 }}>{formatBRL(report.summary.overdueTotal)}</strong></div>
              </div>

              <div className="ps-label">{report.purchases.length} conta(s) · {report.rows.length} parcela(s)</div>
              {report.rows.length === 0 ? <div className="ps-empty">Nenhum lançamento encontrado nesse período.</div> : mode === 'compras' ? (
                <div style={{ marginTop: 10 }}>
                  {report.purchases.map(purchase => (
                    <div className="ps-card" key={purchase.id} style={{ marginBottom: 8, padding: 12 }}>
                      <div className="ps-card-head">
                        <div><b>{supplierName(purchase)}</b><small>{documentLabel(purchase)} · {formatDate(purchase.purchase_date)}</small></div>
                        <strong>{formatBRL(purchase.total_value)}</strong>
                      </div>
                      {report.rows.filter(row => row.purchase.id === purchase.id).map(row => (
                        <div className="ps-list-row" key={row.installment.id} style={{ gap: 8 }}>
                          <span style={{ flex: 1 }}>Parcela {row.installment.installment_number} · vence {formatDate(row.installment.due_date)}<small style={{ display: 'block' }}>{installmentLabel(row.installment.status)}</small></span>
                          <b>{formatBRL(row.installment.amount)}</b>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  {report.rows.map(row => (
                    <div className="ps-card" key={row.installment.id} style={{ marginBottom: 8, padding: 12 }}>
                      <div className="ps-card-head">
                        <div><b>{supplierName(row.purchase)}</b><small>{documentLabel(row.purchase)} · parcela {row.installment.installment_number}</small></div>
                        <strong>{formatBRL(row.installment.amount)}</strong>
                      </div>
                      <small style={{ display: 'block', marginTop: 6 }}>Vencimento: {formatDate(row.installment.due_date)} · Baixa: {paidDate(row.installment.paid_at)} · {installmentLabel(row.installment.status)}</small>
                      <small style={{ display: 'block', color: 'var(--ink-faint)', marginTop: 3 }}>{row.basis === 'baixa' ? 'Entrou pela data da baixa.' : row.basis === 'vencimento_e_baixa' ? 'Entrou pelo vencimento e pela baixa.' : 'Entrou pela data do vencimento.'}</small>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="ps-card no-print" style={{ marginTop: 14, background: 'var(--cream-raise)' }}>
            <small>O arquivo .xlsx abre no Excel com abas de resumo e parcelas.</small>
          </div>
        </div>
      </div>
    </div>
      <section id="payables-report-print" aria-label="Relatório impresso de contas a pagar">
        <header className="payables-print-header">
          <div>
            <h1>Contas a pagar</h1>
            <p>{reportModeLabel(mode)}</p>
          </div>
          <div className="payables-print-period">
            <span>Período</span>
            <b>{from ? formatDate(from) : '-'} a {to ? formatDate(to) : '-'}</b>
          </div>
        </header>
        <div className="payables-print-summary">
          <div><span>{mode === 'compras' ? 'Total comprado' : 'Vencimentos no período'}</span><b>{formatBRL(mode === 'compras' ? report.summary.purchaseTotal : report.summary.scheduledTotal)}</b></div>
          <div><span>Baixado</span><b>{formatBRL(report.summary.paidTotal)}</b></div>
          <div><span>Em aberto</span><b>{formatBRL(report.summary.openTotal)}</b></div>
          <div><span>Vencido</span><b>{formatBRL(report.summary.overdueTotal)}</b></div>
        </div>
        <table className="payables-print-table">
          <thead>
            <tr><th>Fornecedor</th><th>Documento</th><th>Compra</th><th>Parcela</th><th>Vencimento</th><th>Baixa</th><th>Situação</th><th className="right">Valor</th></tr>
          </thead>
          <tbody>
            {buildPayablesReportExportRows(report).map(row => (
              <tr key={`${row.documento}-${row.parcela}-${row.vencimento}`}>
                <td>{row.fornecedor}</td><td>{row.documento}</td><td>{row.data_compra ? formatDate(row.data_compra) : '-'}</td><td>{row.parcela}</td><td>{row.vencimento ? formatDate(row.vencimento) : '-'}</td><td>{row.baixa ? formatDate(row.baixa) : '-'}</td><td>{row.situacao}</td><td className="right">{formatBRL(row.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={7}>Total das parcelas exibidas</td><td className="right">{formatBRL(report.rows.reduce((total, row) => total + Number(row.installment.amount), 0))}</td></tr></tfoot>
        </table>
        <p className="payables-print-footnote">{report.purchases.length} conta(s) · {report.rows.length} parcela(s) · Emitido pelo PaneERP</p>
      </section>
    </>
  )
}
