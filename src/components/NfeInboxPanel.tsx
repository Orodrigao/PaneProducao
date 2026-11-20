'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBRL } from '@/lib/payables'
import {
  inboxBatchSummary, loadNfeInbox, nfeInboxResultLabel, nfeInboxStatusLabel, receiveNfeInboxXml,
  sendInboxFiles, type InboxProgress, type NfeInboxFileResult, type NfeInboxRow,
} from '@/lib/nfeInbox'

interface Props {
  refreshKey: unknown
  onReview: (row: NfeInboxRow) => Promise<void>
  onSendingChange: (sending: boolean) => void
  busyId: string | null
  sendingElsewhere: boolean
}

export default function NfeInboxPanel({ refreshKey, onReview, onSendingChange, busyId, sendingElsewhere }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const sending = useRef(false)
  const request = useRef(0)
  const [rows, setRows] = useState<NfeInboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<InboxProgress | null>(null)
  const [results, setResults] = useState<NfeInboxFileResult[]>([])
  const isSending = sendingElsewhere || progress !== null
  const reload = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await loadNfeInbox()
      if (current === request.current) setRows(next)
    } catch {
      if (current === request.current) setError('Não foi possível carregar a caixa de notas.')
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
    return () => { request.current += 1 }
  }, [reload, refreshKey])

  async function upload(files: File[]) {
    if (sending.current || isSending || busyId !== null || files.length === 0) return
    sending.current = true
    onSendingChange(true)
    try {
      const next = await sendInboxFiles(files, receiveNfeInboxXml, setProgress)
      setResults(previous => [...previous, ...next])
      await reload()
    } finally {
      sending.current = false
      onSendingChange(false)
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  function note(row: NfeInboxRow) {
    const reviewable = row.has_xml && (row.status === 'esperando_conferencia' || row.status === 'conferencia_comecada')
    return <article key={row.id} data-testid="nfe-inbox-row" className="ps-card" style={{ marginTop: 8 }}>
      <b>{row.emitter_name ?? 'Emitente ainda não identificado'}</b>
      <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>Nota {row.number} · Série {row.series} · {row.recipient_label}</p>
      <small>{row.issued_at ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(row.issued_at)) : 'Emissão não disponível'} · {row.total_value !== null ? formatBRL(Number(row.total_value)) : 'Valor não disponível'}</small>
      <p style={{ margin: '6px 0' }}>{nfeInboxStatusLabel(row.status)}</p>
      {reviewable && <button className="ps-btn ghost sm" disabled={busyId !== null || isSending} onClick={() => void onReview(row)}>Conferir</button>}
      {reviewable && busyId !== null && <small style={{ display: 'block' }}>{busyId === row.id ? 'Abrindo o XML da nota…' : 'Aguarde a abertura da outra nota.'}</small>}
      {reviewable && isSending && <small style={{ display: 'block' }}>Aguarde terminar o envio dos arquivos.</small>}
      {row.status === 'aguardando_xml' && <small>O XML completo ainda não chegou. Envie o arquivo desta nota para poder conferir.</small>}
      {row.status === 'ilegivel' && <small>Não foi possível ler o documento recebido. Envie um XML completo desta nota.</small>}
    </article>
  }
  const isCompleted = (row: NfeInboxRow) => ['lancada', 'ja_no_erp', 'conta_cancelada'].includes(row.status)
  const completed = rows.filter(isCompleted)
  const pending = rows.filter(row => !isCompleted(row))
  return <section className="ps-card" aria-label="Notas recebidas" style={{ marginTop: 14 }}>
    <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Notas recebidas</h2>
    <p>Suba os XML das notas de compra. Cada nota entra uma vez só; depois é só tocar em Conferir.</p>
    <input ref={input} hidden type="file" multiple accept=".xml,text/xml,application/xml" aria-label="Escolher XML das notas recebidas" disabled={isSending || busyId !== null} onChange={event => void upload(Array.from(event.target.files ?? []))} />
    <button className="ps-btn primary" disabled={isSending || busyId !== null} onClick={() => input.current?.click()}>Enviar XML das notas</button>
    {busyId !== null && <p role="status">Aguarde terminar a operação em andamento antes de enviar os XML.</p>}
    {sendingElsewhere && !progress && <p role="status">Aguarde terminar o envio dos arquivos antes de enviar outro lote.</p>}
    {progress && <p role="status">Enviando {progress.current} de {progress.total}. Aguarde terminar para enviar outro lote.</p>}
    {results.length > 0 && <div role="status" className="ps-banner" style={{ marginTop: 10 }}>
      <b>{inboxBatchSummary(results)}</b>
      <ul style={{ paddingLeft: 20 }}>
        {results.map((result, index) => <li key={index} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
          <b>{result.fileName}: {nfeInboxResultLabel(result)}</b><br />{result.mensagem}
        </li>)}
      </ul>
      <button className="ps-btn ghost sm" onClick={() => setResults([])}>Fechar resumo</button>
    </div>}
    {loading && (rows.length === 0 ? <p role="status">Carregando a caixa de notas…</p>
      : <small role="status" style={{ display: 'block', marginTop: 8 }}>Atualizando…</small>)}
    {error && <div role="alert">
      <p>{error}</p><button className="ps-btn ghost sm" onClick={() => void reload()}>Tentar novamente</button>
    </div>}
    {!loading && !error && rows.length === 0 && <p>Nenhuma nota na caixa ainda.</p>}
    {rows.length > 0 && <>
      {rows.length === 1000 && <p>Mostrando as 1.000 notas mais recentes; as pendentes vêm primeiro.</p>}
      {pending.map(note)}
      {completed.length > 0 && <details style={{ marginTop: 12 }}><summary>Concluídas ({completed.length})</summary>{completed.map(note)}</details>}
    </>}
  </section>
}
