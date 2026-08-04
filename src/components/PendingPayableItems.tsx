'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  type NfeConversionBasis,
} from '@/lib/nfeXml'
import {
  classifyPayableItem,
  type PayableProduct,
  type PendingPayableItemRow,
} from '@/lib/payables'
import { showToast } from '@/lib/utils'

interface PendingPayableItemsProps {
  items: PendingPayableItemRow[]
  products: PayableProduct[]
  onChanged: () => Promise<void> | void
  onClose: () => void
}

export default function PendingPayableItems({ items, products, onChanged, onClose }: PendingPayableItemsProps) {
  const [values, setValues] = useState<Record<string, { productId: string; basis: NfeConversionBasis; factor: string; usable: string; remember: boolean }>>(() => Object.fromEntries(items.map(item => [item.id, {
    productId: '', basis: item.conversion_basis ?? 'simple', factor: '1', usable: String(Number(item.source_quantity ?? item.quantity) || 1), remember: true,
  }])))
  const [busy, setBusy] = useState<string | null>(null)

  function update(itemId: string, patch: Partial<(typeof values)[string]>) {
    setValues(previous => ({ ...previous, [itemId]: { ...previous[itemId], ...patch } }))
  }

  async function save(item: PendingPayableItemRow) {
    const value = values[item.id]
    const product = products.find(candidate => candidate.id === value.productId)
    const factor = Number(value.factor)
    const usable = Number(value.usable)
    if (!product || factor <= 0 || usable <= 0) { showToast('Escolha o item-base e confirme a conversão.'); return }
    setBusy(item.id)
    try {
      await classifyPayableItem(item.id, product.id, value.basis, factor, usable, value.remember)
      showToast('Item classificado e custo atualizado.')
      await onChanged()
    } catch (error) { showToast(error instanceof Error ? error.message : 'Não foi possível classificar o item.') }
    finally { setBusy(null) }
  }

  return (
    <div className="ps-banner honey" style={{ marginTop: 10 }}>
      <div className="ps-card-head"><b>Itens aguardando classificação</b><button className="ps-iconbtn" onClick={onClose} aria-label="Fechar classificação"><X size={15} /></button></div>
      {items.map(item => {
        const value = values[item.id]
        const quantity = Number(item.source_quantity ?? item.quantity)
        const factor = Number(value.factor) || 0
        const usable = Number(value.usable) || 0
        const calculated = value.basis === 'usable' ? conversionFactorFromUsableQuantity(quantity, usable) : calculateUsableQuantity(quantity, factor)
        return (
          <div key={item.id} className="ps-card" style={{ padding: 10, marginTop: 8, background: 'var(--cream-raise)' }}>
            <b>{item.source_description ?? item.item_name}</b>
            <small style={{ display: 'block', marginTop: 3 }}>{quantity} {item.source_unit ?? item.unit} · {item.source_product_code ?? 'sem código'} · {String(item.line_total)}</small>
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}>
              <div className="ps-fieldlabel">Item-base</div>
              <select className="ps-select" value={value.productId} onChange={event => update(item.id, { productId: event.target.value })}>
                <option value="">Selecione</option>
                {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit ?? 'un'}</option>)}
              </select>
            </div>
            <div className="ps-fieldrow" style={{ marginTop: 8 }}>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">Base do cálculo</div><select className="ps-select" value={value.basis} onChange={event => update(item.id, { basis: event.target.value as NfeConversionBasis })}><option value="simple">Quantidade da NF</option><option value="package">Conteúdo por unidade</option><option value="usable">Total aproveitável</option></select></div>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">{value.basis === 'usable' ? 'Total útil' : 'Fator'}</div><input className="ps-input" type="number" min="0" step="0.001" value={value.basis === 'usable' ? value.usable : value.factor} onChange={event => value.basis === 'usable' ? update(item.id, { usable: event.target.value, factor: String(conversionFactorFromUsableQuantity(quantity, Number(event.target.value))) }) : update(item.id, { factor: event.target.value, usable: String(calculateUsableQuantity(quantity, Number(event.target.value))) })} /></div>
            </div>
            <small style={{ display: 'block', marginTop: 6 }}>{quantity} × {value.basis === 'usable' ? calculated : factor} = {value.basis === 'usable' ? usable : calculated} unidade(s) úteis</small>
            <label className="ps-checkrow" style={{ marginTop: 6 }}><input type="checkbox" checked={value.remember} onChange={event => update(item.id, { remember: event.target.checked })} /><span>Lembrar este fator para este fornecedor</span></label>
            <button className="ps-btn primary sm" style={{ marginTop: 8 }} disabled={busy === item.id} onClick={() => void save(item)}><Check size={14} /> {busy === item.id ? 'Salvando...' : 'Confirmar classificação'}</button>
          </div>
        )
      })}
    </div>
  )
}
