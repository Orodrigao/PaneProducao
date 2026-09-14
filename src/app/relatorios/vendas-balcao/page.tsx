'use client'

import { useCallback, useEffect, useState } from 'react'
import { canAccessSalesImport, canImportSales, getCurrentUserAsync, type AppUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { confirmSalesImport, sha256Hex, type SalesImportOutcome } from '@/lib/salesImport/client'
import type { NormalizedSalesReport } from '@/lib/salesImport/types'
import { SalesProductMappingPanel } from '@/components/salesImport/SalesProductMappingPanel'
import { SalesAbcPanel } from '@/components/salesImport/SalesAbcPanel'

interface PreparedFile {
  file: File
  report?: NormalizedSalesReport
  error?: string
  state: 'ready' | 'sending' | 'done' | 'error'
  fileHash?: string
  existing?: ImportRow
  replacementReason: string
  outcome?: SalesImportOutcome
}

interface ImportRow {
  id: string
  sale_date: string
  source_system: string
  file_name: string
  status: 'confirmed' | 'replaced'
  row_count: number
  total_quantity: number
  total_net: number
  confirmed_at: string
  replacement_reason: string | null
  file_hash: string
}

interface DayStatusRow {
  id: string
  sale_date: string
  status: 'closed' | 'zero_sales'
  reason: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })

function recentDayKeys(count: number): string[] {
  const today = new Date()
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - offset)
    return dayKey.format(date)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export default function VendasBalcaoPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [files, setFiles] = useState<PreparedFile[]>([])
  const [imports, setImports] = useState<ImportRow[]>([])
  const [dayStatuses, setDayStatuses] = useState<DayStatusRow[]>([])
  const [message, setMessage] = useState('')
  const [dayDate, setDayDate] = useState('')
  const [dayStatus, setDayStatus] = useState<'closed' | 'zero_sales'>('closed')
  const [dayReason, setDayReason] = useState('')

  const loadHistory = useCallback(async () => {
    const [importsResult, statusResult] = await Promise.all([
      supabase.from('sales_imports')
        .select('id,sale_date,source_system,file_name,file_hash,status,row_count,total_quantity,total_net,confirmed_at,replacement_reason')
        .order('sale_date', { ascending: false }).order('confirmed_at', { ascending: false }).limit(120),
      supabase.from('sales_day_statuses').select('id,sale_date,status,reason')
        .order('sale_date', { ascending: false }).limit(60),
    ])
    const historyError = importsResult.error ?? statusResult.error
    if (historyError) setMessage(`Não foi possível carregar o histórico: ${historyError.message}`)
    else {
      setImports((importsResult.data ?? []) as ImportRow[])
      setDayStatuses((statusResult.data ?? []) as DayStatusRow[])
    }
  }, [])

  useEffect(() => {
    getCurrentUserAsync().then(current => {
      setUser(current)
      setLoadingUser(false)
      if (current && canAccessSalesImport(current)) void loadHistory()
    })
  }, [loadHistory])

  async function prepareSelected(selected: FileList | null) {
    if (!selected) return
    setMessage('')
    const prepared: PreparedFile[] = []
    const selectedDates = new Set<string>()
    const { adapterForSalesFile } = await import('@/lib/salesImport/registry')
    for (const file of Array.from(selected)) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo ultrapassa o limite seguro de 10 MB.')
        const adapter = adapterForSalesFile(file.name)
        if (!adapter) throw new Error('Formato não reconhecido. Use o XLS original da JC.')
        const fileData = await file.arrayBuffer()
        const report = adapter.parse(file.name, fileData)
        if (report.reportedTotal === null) throw new Error('O arquivo não traz o total de fechamento necessário para conferir a soma.')
        if (selectedDates.has(report.saleDate)) throw new Error('Há dois arquivos da mesma data nesta seleção. Confira um por vez.')
        selectedDates.add(report.saleDate)
        const fileHash = await sha256Hex(fileData)
        prepared.push({
          file, report, fileHash, state: 'ready', replacementReason: '',
          existing: imports.find(item => item.sale_date === report.saleDate && item.status === 'confirmed'),
        })
      } catch (error) {
        prepared.push({ file, error: errorMessage(error), state: 'error', replacementReason: '' })
      }
    }
    setFiles(prepared)
  }

  async function importAll() {
    setMessage('')
    let completed = 0
    for (let index = 0; index < files.length; index += 1) {
      const prepared = files[index]
      if (!prepared.report || prepared.state === 'done') continue
      setFiles(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, state: 'sending', error: undefined } : item))
      try {
        const result = await confirmSalesImport(prepared.report, await prepared.file.arrayBuffer(), prepared.replacementReason)
        completed += 1
        setFiles(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, state: 'done', outcome: result.outcome } : item))
      } catch (error) {
        setFiles(current => current.map((item, itemIndex) => itemIndex === index
          ? { ...item, state: 'error', error: errorMessage(error) }
          : item))
      }
    }
    if (completed > 0) {
      setMessage(`${completed} arquivo(s) confirmado(s). O original e os itens ficaram guardados.`)
      await loadHistory()
    }
  }

  async function recordDayStatus() {
    setMessage('')
    const { error } = await supabase.rpc('record_sales_day_status', {
      p_source_system: 'cnm', p_store: 'jc', p_sale_date: dayDate,
      p_status: dayStatus, p_reason: dayReason.trim(),
    })
    if (error) setMessage(error.message)
    else {
      setMessage('Situação do dia registrada. Ela não será confundida com arquivo faltante.')
      setDayDate('')
      setDayReason('')
      await loadHistory()
    }
  }

  async function restoreImport(item: ImportRow) {
    const reason = window.prompt(`Por que restaurar ${item.file_name}?`)
    if (!reason || reason.trim().length < 3) return
    if (!window.confirm('A versão atualmente ativa deste dia será substituída. Continuar?')) return
    const { error } = await supabase.rpc('restore_sales_import', { p_import_id: item.id, p_reason: reason.trim() })
    setMessage(error ? error.message : 'Versão anterior restaurada com registro de quem fez e do motivo.')
    if (!error) await loadHistory()
  }

  if (loadingUser) return <div className="ps-canvas"><div className="ps-shell"><div className="ps-pad">Carregando acesso…</div></div></div>
  if (!user || !canAccessSalesImport(user)) return (
    <div className="ps-canvas"><div className="ps-shell"><div className="ps-pad">
      <h1 className="ps-page-title">Vendas do balcão</h1>
      <p>Esta informação financeira está liberada somente para Rodrigo e Elis.</p>
    </div></div></div>
  )

  const readyCount = files.filter(item => item.report && item.state !== 'done').length
  const hasUnexplainedReplacement = files.some(item => item.report && item.existing
    && item.existing.file_hash !== item.fileHash && item.replacementReason.trim().length < 3)
  const activeDates = new Set(imports.filter(item => item.status === 'confirmed').map(item => item.sale_date))
  const statusByDate = new Map(dayStatuses.map(item => [item.sale_date, item]))
  return (
    <div className="ps-canvas"><div className="ps-shell">
      <header className="ps-header"><div className="ps-wordmark"><div className="ps-mark">P</div><div className="ps-brand"><b>Vendas do balcão</b><span>Importação diária · JC</span></div></div></header>
      <main className="ps-scroll ps-pad">
        <h1 className="ps-page-title">Arquivos de venda</h1>
        <p className="ps-page-lead">O ERP confere cada XLS antes de guardar. Nada aqui altera estoque, custo ou preço.</p>
        {message && <div className="ps-card" role="status"><p>{message}</p></div>}

        {canImportSales(user) && <section className="ps-card" style={{ marginBottom: 16 }}>
          <h2>1. Conferir arquivos</h2>
          <p>Selecione um ou vários XLS originais da JC (a automação usa <b>CNM_JC_AAAA-MM-DD.xls</b> e o coletor antigo usa <b>CNM_AAAA-MM-DD_JC.xls</b>). A data e a loja vêm do nome, sem digitação.</p>
          <input type="file" accept=".xls" multiple onChange={event => void prepareSelected(event.target.files)} />
          {files.map((prepared, index) => (
            <article key={`${prepared.file.name}-${index}`} style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
              <b>{prepared.file.name}</b>
              {prepared.error && <p style={{ color: 'var(--berry)' }}>{prepared.error}</p>}
              {prepared.report && <>
                <p>{prepared.report.saleDate.split('-').reverse().join('/')} · {prepared.report.items.length} produtos · {quantity.format(prepared.report.totalQuantity)} em quantidade bruta · <b>{money.format(prepared.report.totalNet)}</b></p>
                <small>Prévia: {prepared.report.items.slice(0, 5).map(item => item.rawProductName).join(' · ')}{prepared.report.items.length > 5 ? '…' : ''}</small>
                {prepared.existing && prepared.existing.file_hash !== prepared.fileHash && prepared.state !== 'done' && <label style={{ display: 'block', marginTop: 10 }}>
                  Já existe {money.format(Number(prepared.existing.total_net))} ativo neste dia. Motivo para trocar por {money.format(prepared.report.totalNet)}:
                  <input className="ps-input" value={prepared.replacementReason} onChange={event => setFiles(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, replacementReason: event.target.value } : item))} />
                </label>}
                {prepared.state === 'done' && <p>✓ {prepared.outcome === 'unchanged' ? 'Já estava confirmado' : prepared.outcome === 'replaced' ? 'Versão substituída' : 'Confirmado'}</p>}
              </>}
            </article>
          ))}
          {readyCount > 0 && <button className="ps-btn primary" onClick={() => void importAll()} disabled={files.some(item => item.state === 'sending') || hasUnexplainedReplacement}>Confirmar {readyCount} arquivo(s)</button>}
        </section>}

        {canImportSales(user) && <section className="ps-card" style={{ marginBottom: 16 }}>
          <h2>2. Dia sem arquivo</h2>
          <p>Use somente quando a loja estava fechada ou realmente não houve venda.</p>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <input className="ps-input" type="date" value={dayDate} onChange={event => setDayDate(event.target.value)} />
            <select className="ps-input" value={dayStatus} onChange={event => setDayStatus(event.target.value as 'closed' | 'zero_sales')}>
              <option value="closed">Loja fechada</option><option value="zero_sales">Aberta, sem vendas</option>
            </select>
            <input className="ps-input" value={dayReason} onChange={event => setDayReason(event.target.value)} placeholder="Motivo obrigatório" />
          </div>
          <button className="ps-btn ghost" onClick={() => void recordDayStatus()} disabled={!dayDate || dayReason.trim().length < 3}>Registrar situação</button>
        </section>}

        <SalesProductMappingPanel canManage={canImportSales(user)} />
        <SalesAbcPanel />

        <section className="ps-card">
          <h2>Histórico importado</h2>
          <h3>Últimos 14 dias</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {recentDayKeys(14).map(date => {
              const recorded = statusByDate.get(date)
              const label = activeDates.has(date) ? 'Importado' : recorded?.status === 'closed'
                ? 'Fechada' : recorded?.status === 'zero_sales' ? 'Zero venda' : 'Sem arquivo'
              return <span key={date} className="ps-badge" title={recorded?.reason}>{date.slice(5).split('-').reverse().join('/')} · {label}</span>
            })}
          </div>
          {imports.length === 0 ? <p>Nenhum arquivo confirmado neste ambiente.</p> : (
            <div style={{ overflowX: 'auto' }}><table className="ps-table"><thead><tr><th>Data</th><th>Origem</th><th>Arquivo</th><th>Produtos</th><th>Quantidade</th><th>Valor líquido</th><th>Situação</th></tr></thead><tbody>
              {imports.map(item => <tr key={item.id}><td>{item.sale_date.split('-').reverse().join('/')}</td><td>{item.source_system.toUpperCase()}</td><td>{item.file_name}</td><td>{item.row_count}</td><td>{quantity.format(Number(item.total_quantity))}</td><td>{money.format(Number(item.total_net))}</td><td>{item.status === 'confirmed' ? `Ativo${item.replacement_reason ? ` · substituiu a anterior: ${item.replacement_reason}` : ''}` : <>{'Substituído'}{canImportSales(user) && <button className="ps-btn ghost" onClick={() => void restoreImport(item)}>Restaurar</button>}</>}</td></tr>)}
            </tbody></table></div>
          )}
          {dayStatuses.length > 0 && <>
            <h3 style={{ marginTop: 18 }}>Dias sem arquivo, explicados</h3>
            <ul>{dayStatuses.map(day => <li key={day.id}>{day.sale_date.split('-').reverse().join('/')} · {day.status === 'closed' ? 'Loja fechada' : 'Aberta, sem vendas'} · {day.reason}</li>)}</ul>
          </>}
        </section>
      </main>
    </div></div>
  )
}
