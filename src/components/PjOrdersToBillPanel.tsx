'use client'

import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import {
  createReceivableFromPjOrder,
  formatReceivableMoney,
  getReceivableErrorMessage,
  pjOrderBillingBlock,
  pjOrderCanBeBilled,
  summarizePjOrdersToBill,
  PJ_ORDER_BILLING_BLOCK_MESSAGES,
  type PjOrderBillingBlock,
  type PjOrderToBillRow,
} from '@/lib/receivables'
import { showToast } from '@/lib/utils'

interface PjOrdersToBillPanelProps {
  orders: PjOrderToBillRow[]
  onBilled: () => Promise<void> | void
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}

/** Rótulo curto ao lado do pedido; a frase inteira fica no aviso do topo. */
const MOTIVO_CURTO: Record<PjOrderBillingBlock, string> = {
  'aguardando-conferencia': 'aguardando conferência',
  'sem-prazo': 'sem prazo cadastrado',
  'nada-enviado': 'nada saiu',
  'fora-da-trava': 'quantidade fora do esperado',
  'sem-conferencia-depois-do-envio': 'saiu sem conferência',
}

export default function PjOrdersToBillPanel({ orders, onBilled }: PjOrdersToBillPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const cobraveis = useMemo(() => orders.filter(pjOrderCanBeBilled), [orders])
  const resumo = useMemo(() => summarizePjOrdersToBill(orders), [orders])

  if (orders.length === 0) return null

  function toggle(orderGroupId: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(orderGroupId)) next.delete(orderGroupId)
      else next.add(orderGroupId)
      return next
    })
  }

  async function billSelected() {
    const alvos = cobraveis.filter(order => selected.has(order.order_group_id))
    if (alvos.length === 0) return
    setSaving(true)
    let geradas = 0
    const falhas: string[] = []
    for (const order of alvos) {
      try {
        // Um identificador por pedido: se a conexão cair no meio do lote, o
        // que já foi gerado não vira cobrança duplicada na segunda tentativa.
        await createReceivableFromPjOrder(order.order_group_id, crypto.randomUUID())
        geradas += 1
      } catch (billError) {
        console.error(billError)
        falhas.push(`${order.customer_name}: ${getReceivableErrorMessage(billError, 'erro ao gerar')}`)
      }
    }
    setSaving(false)
    setSelected(new Set())
    showToast(
      falhas.length === 0
        ? `${geradas} cobrança(s) gerada(s).`
        : `${geradas} gerada(s), ${falhas.length} com problema. ${falhas[0]}`,
    )
    await onBilled()
  }

  return (
    <section className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey-deep)' }}>
      <div className="ps-card-head">
        <div>
          <b>Entregues e ainda não cobrados</b>
          <small>{orders.length} pedido(s) · {formatReceivableMoney(resumo.total)}</small>
        </div>
        <Truck size={18} />
      </div>

      {/* Um aviso por motivo: juntar todos numa frase só devolveria a
          mensagem genérica que já custou tempo da Marselle no Romaneio.
          Os motivos vêm do banco, então a tela nunca inventa um recado que a
          cobrança não vai cumprir. */}
      {(Object.keys(resumo.porMotivo) as PjOrderBillingBlock[]).map(motivo => {
        const contagem = resumo.porMotivo[motivo]
        if (contagem.pedidos === 0) return null
        return (
          <div key={motivo} className="ps-alert error" role="alert" style={{ marginTop: 10 }}>
            {contagem.pedidos} pedido(s), somando {formatReceivableMoney(contagem.valor)},{' '}
            {PJ_ORDER_BILLING_BLOCK_MESSAGES[motivo]}
          </div>
        )
      })}

      <div className="ps-list" style={{ marginTop: 10 }}>
        {orders.map(order => {
          const motivo = pjOrderBillingBlock(order)
          const podeCobrar = motivo === null
          return (
            <label
              key={order.order_group_id}
              className="ps-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                opacity: podeCobrar ? 1 : 0.6,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(order.order_group_id)}
                disabled={!podeCobrar || saving}
                onChange={() => toggle(order.order_group_id)}
              />
              <span style={{ flex: 1 }}>
                <b>{order.customer_name}</b>
                <small style={{ display: 'block' }}>
                  Entrega {formatDate(order.delivery_date)} · {order.items} item(ns)
                  {order.dispatched_at ? ' · envio confirmado' : ' · sem confirmação de envio'}
                  {motivo ? ` · ${MOTIVO_CURTO[motivo]}` : ''}
                </small>
                {/* A diferença aparece só quando existe: no dia a dia o que
                    saiu bate com o pedido, e repetir dois números iguais em
                    toda linha faria a lista parecer cheia de exceção. */}
                {order.amount !== order.amount_estimado && (
                  <small style={{ display: 'block', color: 'var(--honey-deep)' }}>
                    Pedido {formatReceivableMoney(order.amount_estimado)} · saiu{' '}
                    {formatReceivableMoney(order.amount)}
                  </small>
                )}
              </span>
              <b>{formatReceivableMoney(order.amount)}</b>
            </label>
          )
        })}
      </div>

      <div className="ps-fieldrow" style={{ marginTop: 12 }}>
        <button
          className="ps-btn primary block"
          onClick={() => void billSelected()}
          disabled={saving || selected.size === 0}
        >
          {saving ? 'Gerando...' : `Gerar ${selected.size} cobrança(s)`}
        </button>
        <button
          className="ps-btn ghost block"
          onClick={() => setSelected(new Set(cobraveis.map(order => order.order_group_id)))}
          disabled={saving || cobraveis.length === 0}
        >
          Marcar todos
        </button>
      </div>
    </section>
  )
}
