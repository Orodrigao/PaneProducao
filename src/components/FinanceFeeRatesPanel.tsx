'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCompetenceMonth, formatFinanceMoney } from '@/lib/finance'
import { formatDateBR, todayKey } from '@/lib/utils'
import {
  buildFeeRateRequest,
  feeMethodLabel,
  feeRateErrorMessage,
  feeRateImpact,
  formatFeeRate,
  loadFinanceFeeRates,
  saveFinanceFeeRate,
  type FeeMethod,
  type FinanceFeeRates,
} from '@/lib/financeFeeRates'

export default function FinanceFeeRatesPanel({ onSaved }: { onSaved: () => Promise<void> }) {
  const [data, setData] = useState<FinanceFeeRates | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [method, setMethod] = useState<FeeMethod>('stone')
  const [rate, setRate] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<{ content: string; id: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await loadFinanceFeeRates())
    } catch (loadError) {
      setError(feeRateErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  const latestId = data?.methods.find(row => row.method === method)?.latest?.id
  const startDate = data?.bridge.start_date
  useEffect(() => {
    if (startDate) setValidFrom(latestId ? todayKey() : startDate)
  }, [method, latestId, startDate])

  async function save() {
    if (!data || busy) return
    const draft = { method, rate, validFrom, expectedLatestId: latestId ?? null }
    try {
      const payload = buildFeeRateRequest(draft, 'validation', data.bridge.start_date)
      const impact = feeRateImpact(data, method, validFrom)
      // Mostra os meses porque a gravação pode lançar taxas fora do mês aberto.
      const effect = payload.p_rate === null
        ? 'Taxa não informada: as vendas continuam pendentes.'
        : payload.p_rate === 0
          ? 'Taxa zero: não gera despesa para as vendas cobertas.'
          : impact.amount > 0
          ? 'A taxa vai ser lançada sobre ' + formatFinanceMoney(impact.amount)
            + ' de vendas sem taxa (' + impact.stores + ', ' + impact.months
            + '), no mês de cada venda.'
          : 'A taxa vale para as próximas vendas.'
      const confirmation = 'Gravar ' + feeMethodLabel(method) + ' '
        + formatFeeRate(payload.p_rate).toLocaleLowerCase('pt-BR') + ' a partir de '
        + formatDateBR(validFrom) + '? ' + effect + ' Taxas já lançadas não mudam.'
      if (!window.confirm(confirmation)) return
      setBusy(true)
      setError('')
      setMessage('')
      const content = JSON.stringify(draft)
      if (request.current?.content !== content) request.current = { content, id: crypto.randomUUID() }
      const result = await saveFinanceFeeRate(draft, request.current.id, data.bridge.start_date)
      request.current = null
      setMessage('Taxa gravada. ' + result.fees_created + ' taxa(s) criada(s). '
        + (result.fees_created > 0 && impact.months
          ? 'Lançamentos nos meses das vendas: ' + impact.months + ' (' + impact.stores + ').'
          : 'Nenhuma taxa anterior foi alterada.'))
      await load()
      await onSaved()
    } catch (saveError) {
      setError(feeRateErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ps-card" aria-label="Taxas dos meios de pagamento" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Taxas dos meios de pagamento</b>
          <small>Grave primeiro o período mais recente. Taxas já lançadas não mudam.</small>
        </div>
      </div>
      {loading && <p role="status">Carregando taxas...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="ps-btn ghost" disabled={busy} onClick={() => void load()}>Recarregar taxas</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <>
          <p>{data.bridge.enabled
            ? 'A venda do fechamento de caixa entra no livro desde ' + formatDateBR(data.bridge.start_date) + '.'
            : 'Entrada automática do fechamento pausada.'}</p>
          {data.methods.map(row => (
            <div className="ps-card" key={row.method} style={{ marginTop: 8 }}>
              <b>{feeMethodLabel(row.method)}: {formatFeeRate(row.current?.rate ?? null)}</b>
              {row.current && (
                <small style={{ display: 'block' }}>Desde {formatDateBR(row.current.valid_from)} · {row.current.author_name}</small>
              )}
              {row.latest && row.latest.valid_from > todayKey() && (
                <small style={{ display: 'block' }}>Próxima: {formatFeeRate(row.latest.rate)} a partir de {formatDateBR(row.latest.valid_from)}</small>
              )}
            </div>
          ))}
          <h3>Venda ainda sem taxa</h3>
          {data.pending.length === 0 ? <p>Nenhuma venda com taxa desconhecida.</p> : data.pending.map(row => (
            <p key={row.method + row.store + row.competence_month}>
              {feeMethodLabel(row.method)} · {row.store.toUpperCase()} · {formatCompetenceMonth(row.competence_month.slice(0, 7))}: {formatFinanceMoney(row.amount)} ({row.quantity} venda(s))
            </p>
          ))}
          <p>Taxa não informada é pendência. Taxa zero e valores menores que um centavo não geram despesa.</p>
          {data.can_edit ? (
            <fieldset disabled={busy || loading} style={{ border: 0, padding: 0 }}>
              <legend>Gravar taxa</legend>
              <div className="ps-fieldgroup">
                <label className="ps-fieldlabel" htmlFor="fee-method">Meio de pagamento</label>
                <select id="fee-method" className="ps-select" value={method} onChange={event => setMethod(event.target.value as FeeMethod)}>
                  {data.methods.map(row => (
                    <option key={row.method} value={row.method}>{feeMethodLabel(row.method)}</option>
                  ))}
                </select>
              </div>
              <div className="ps-fieldgroup">
                <label className="ps-fieldlabel" htmlFor="fee-rate">Taxa (%)</label>
                <input id="fee-rate" className="ps-input" inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} />
                <small>Até quatro casas decimais. Vazio significa não informada; zero significa sem taxa.</small>
              </div>
              <div className="ps-fieldgroup">
                <label className="ps-fieldlabel" htmlFor="fee-valid-from">Vale a partir de</label>
                <input id="fee-valid-from" className="ps-input" type="date" min={data.bridge.start_date} value={validFrom} onChange={event => setValidFrom(event.target.value)} />
              </div>
              <button className="ps-btn primary block" onClick={() => void save()}>{busy ? 'Gravando taxa...' : 'Gravar taxa'}</button>
            </fieldset>
          ) : <p>Você pode consultar. Para gravar, precisa da permissão Taxas dos meios de pagamento.</p>}
          <details style={{ marginTop: 12 }}>
            <summary>Histórico de taxas</summary>
            {data.history.length === 0 ? <p>Nenhuma taxa gravada.</p> : data.history.map(row => (
              <p key={row.id}>
                {feeMethodLabel(row.method)}: {formatFeeRate(row.rate)} · vale desde {formatDateBR(row.valid_from)} · {row.author_name} · {new Date(row.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  )
}
