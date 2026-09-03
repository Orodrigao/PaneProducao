'use client'

import { useMemo, useState } from 'react'
import { PencilLine } from 'lucide-react'
import {
  corrigirQuantidadeEnviadaPj,
  getReceivableErrorMessage,
  type PjDispatchFixLine,
} from '@/lib/receivables'
import { pjLineValue, pjLineVerdict, summarizePjOrderValue } from '@/lib/pjOrderValue'
import { showToast } from '@/lib/utils'

export interface PjDispatchFixRow {
  id: string
  product_name: string
  quantity: number
  unit_price: number | null
  pricing_unit: string | null
  dispatched_quantity: number | null
  dispatched_quantity_reason: string | null
  dispatched_at: string | null
  dispatched_quantity_at: string | null
}

interface PjDispatchQuantityFixProps {
  orderGroupId: string
  rows: PjDispatchFixRow[]
  onCorrected: () => Promise<void> | void
}

function parseQuantidade(valor: string, pricingUnit: string | null): number | null {
  const normalizado = valor.trim().replace(',', '.')
  if (!normalizado) return null
  const numero = Number(normalizado)
  if (!Number.isFinite(numero) || numero < 0) return null
  // Não existe 1,5 pão: item por unidade só aceita inteiro, a mesma regra da
  // conferência da Expedição.
  if ((pricingUnit || 'un') === 'un' && !Number.isInteger(numero)) return null
  return numero
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Corrigir a quantidade enviada depois do envio, para o financeiro.
 *
 * Mora em Pedidos PJ, e não em Contas a receber, por decisão do Rodrigo em
 * 2026-09-02: é a rota que o administrador alcança (medido em produção: o
 * login dele não tem permissão de Contas a receber) e é onde o número vive.
 */
export function PjDispatchQuantityFix({ orderGroupId, rows, onCorrected }: PjDispatchQuantityFixProps) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  // Um identificador por FORMULÁRIO, e não por clique. Se a resposta se perder
  // no caminho, a segunda tentativa é reconhecida como repetição em vez de
  // cancelar a cobrança que acabou de nascer.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [digitado, setDigitado] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map(row => [
      row.id,
      row.dispatched_quantity === null || row.dispatched_quantity === undefined
        ? ''
        : String(row.dispatched_quantity).replace('.', ','),
    ])),
  )

  const linhasComoEstao = useMemo(() => rows.map(row => ({
    quantity: row.quantity,
    dispatchedQuantity: row.dispatched_quantity,
    unitPrice: row.unit_price,
    dispatchedAt: row.dispatched_at,
    pricingUnit: row.pricing_unit,
  })), [rows])

  const linhasComoFicam = useMemo(() => rows.map(row => ({
    quantity: row.quantity,
    dispatchedQuantity: parseQuantidade(digitado[row.id] ?? '', row.pricing_unit),
    unitPrice: row.unit_price,
    dispatchedAt: row.dispatched_at,
    pricingUnit: row.pricing_unit,
  })), [rows, digitado])

  // O carimbo mais recente da conferência: é a versão que esta tela está vendo.
  const versaoLida = useMemo(() => {
    const carimbos = rows.map(row => row.dispatched_quantity_at).filter((valor): valor is string => Boolean(valor))
    return carimbos.length > 0 ? carimbos.slice().sort()[carimbos.length - 1] : null
  }, [rows])

  const antes = useMemo(() => summarizePjOrderValue(linhasComoEstao), [linhasComoEstao])
  const depois = useMemo(() => summarizePjOrderValue(linhasComoFicam), [linhasComoFicam])

  const invalidas = rows.filter(row => parseQuantidade(digitado[row.id] ?? '', row.pricing_unit) === null)
  const semMotivo = motivo.trim().length < 3
  const mudou = rows.some(row => {
    const novo = parseQuantidade(digitado[row.id] ?? '', row.pricing_unit)
    return novo !== null && novo !== (row.dispatched_quantity ?? null)
  })

  // Controle desabilitado sem motivo visível é lido como defeito
  // (lição botao-desabilitado-sem-motivo-na-tela). Aqui o porquê fica escrito
  // ao lado do botão, nunca em tooltip: no celular tooltip não existe.
  const impedimento = invalidas.length > 0
    ? `Confira a quantidade de ${invalidas.length} item(ns): número igual ou maior que zero, e sem fração no que é vendido por unidade.`
    : !mudou
      ? 'Mude ao menos uma quantidade para corrigir.'
      : semMotivo
        ? 'Escreva o motivo da correção, com pelo menos 3 letras.'
        : ''

  async function corrigir() {
    const linhas: PjDispatchFixLine[] = []
    for (const row of rows) {
      const novo = parseQuantidade(digitado[row.id] ?? '', row.pricing_unit)
      if (novo === null) return
      // O motivo da correção acompanha toda linha que mudou: guardar o texto
      // antigo faria o histórico de uma cobrança contestada explicar a
      // conferência anterior, e não a correção.
      const mudou = novo !== (row.dispatched_quantity ?? null)
      linhas.push({
        orderId: row.id,
        dispatchedQuantity: novo,
        reason: mudou || novo === 0 ? motivo : row.dispatched_quantity_reason,
      })
    }

    setSalvando(true)
    try {
      const resultado = await corrigirQuantidadeEnviadaPj(orderGroupId, linhas, motivo, requestId, versaoLida)
      showToast(
        resultado.cobranca_nova
          ? 'Quantidade corrigida e cobrança refeita.'
          : 'Quantidade corrigida. A cobrança não foi refeita: confira o motivo em Contas a receber.',
      )
      setAberto(false)
      setMotivo('')
      setRequestId(crypto.randomUUID())
      await onCorrected()
    } catch (fixError) {
      console.error(fixError)
      showToast(getReceivableErrorMessage(fixError, 'Não foi possível corrigir a quantidade.'))
    } finally {
      setSalvando(false)
    }
  }

  if (!aberto) {
    return (
      <button className="ps-btn ghost block" onClick={() => setAberto(true)} style={{ marginBottom: 12 }}>
        <PencilLine size={14} /> Corrigir quantidade enviada
      </button>
    )
  }

  return (
    <section className="ps-card" style={{ marginBottom: 12, borderColor: 'var(--honey-deep)' }}>
      <div className="ps-card-head">
        <b>Corrigir quantidade enviada</b>
      </div>

      <div className="ps-alert error" role="alert" style={{ marginTop: 8 }}>
        Se a nota fiscal deste pedido já foi emitida, ela também precisa ser corrigida no sistema
        de emissão. Aqui só muda o registro da padaria.
      </div>

      <div className="ps-list" style={{ marginTop: 10 }}>
        {rows.map(row => {
          const novo = parseQuantidade(digitado[row.id] ?? '', row.pricing_unit)
          const veredito = pjLineVerdict({
            quantity: row.quantity,
            dispatchedQuantity: novo,
            unitPrice: row.unit_price,
            dispatchedAt: row.dispatched_at,
            pricingUnit: row.pricing_unit,
          })
          const valorNovo = pjLineValue({
            quantity: row.quantity,
            dispatchedQuantity: novo,
            unitPrice: row.unit_price,
            dispatchedAt: row.dispatched_at,
            pricingUnit: row.pricing_unit,
          })
          return (
            <div key={row.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line, #E8E4DC)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b>{row.product_name}</b>
                <small style={{ color: 'var(--ink-faint)' }}>
                  pedido {row.quantity} {row.pricing_unit || 'un'}
                </small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <input
                  className="ps-input"
                  inputMode="decimal"
                  value={digitado[row.id] ?? ''}
                  onChange={event => setDigitado(atual => ({ ...atual, [row.id]: event.target.value }))}
                  style={{ width: 120 }}
                  aria-label={`Quantidade enviada de ${row.product_name}`}
                />
                <small style={{ color: 'var(--ink-faint)' }}>{row.pricing_unit || 'un'}</small>
                {valorNovo !== null && (
                  <small style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(valorNovo)}
                  </small>
                )}
              </div>
              {veredito !== 'ok' && (
                <small style={{ display: 'block', color: 'var(--tomato, #A93A2E)', marginTop: 4 }}>
                  {veredito === 'acima_do_teto'
                    ? 'Esse número passa do teto por item. A cobrança não vai ser gerada até alguém conferir.'
                    : 'Esse número está muito longe do pedido. A cobrança não vai ser gerada até alguém conferir.'}
                </small>
              )}
            </div>
          )
        })}
      </div>

      <div className="ps-banner honey" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <span>
          <b>Antes</b>
          <small style={{ display: 'block' }}>{formatMoney(antes.valor ?? antes.valorEstimado)}</small>
        </span>
        <span style={{ textAlign: 'right' }}>
          <b>Depois</b>
          <small style={{ display: 'block' }}>{formatMoney(depois.valor ?? depois.valorEstimado)}</small>
        </span>
      </div>

      <label className="ps-field" style={{ marginTop: 10 }}>
        <span>Motivo da correção</span>
        <input
          className="ps-input"
          value={motivo}
          onChange={event => setMotivo(event.target.value)}
          placeholder="Ex.: a balança estava com a bandeja"
        />
      </label>

      {impedimento && (
        <small style={{ display: 'block', color: 'var(--tomato, #A93A2E)', marginTop: 6 }}>
          {impedimento}
        </small>
      )}

      <div className="ps-fieldrow" style={{ marginTop: 10 }}>
        <button
          className="ps-btn primary block"
          onClick={() => void corrigir()}
          disabled={salvando || impedimento !== ''}
        >
          {salvando ? 'Corrigindo...' : 'Corrigir e refazer a cobrança'}
        </button>
        <button className="ps-btn ghost block" onClick={() => setAberto(false)} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </section>
  )
}

export default PjDispatchQuantityFix
