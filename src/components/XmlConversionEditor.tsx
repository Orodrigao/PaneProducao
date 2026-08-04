'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  formatConversionExplanation,
  type NfeConversionBasis,
  type NfeItemDraft,
} from '@/lib/nfeXml'
import type { PayableProduct } from '@/lib/payables'

export function ProductSelector({
  item,
  products,
  onChange,
  onCreate,
}: {
  item: NfeItemDraft
  products: PayableProduct[]
  onChange: (productId: string) => void
  onCreate: () => void
}) {
  return (
    <div className="ps-fieldgroup">
      <div className="ps-fieldlabel">Item-base da receita</div>
      <select className="ps-select" value={item.baseProductId ?? ''} onChange={event => onChange(event.target.value)}>
        <option value="">Pendente — escolher depois</option>
        {products.map(product => <option key={product.id} value={product.id}>{product.name}{product.unit ? ` · ${product.unit}` : ''}</option>)}
      </select>
      <button className="ps-btn ghost sm" style={{ marginTop: 6, alignSelf: 'start' }} onClick={onCreate}><Plus size={14} /> Cadastrar item novo aqui</button>
    </div>
  )
}

export function ConversionEditor({ item, onChange }: { item: NfeItemDraft; onChange: (next: NfeItemDraft) => void }) {
  const [open, setOpen] = useState(false)
  if (!item.baseProductId) return <small style={{ color: 'var(--honey-deep)' }}>Classifique o item para liberar o custo normalizado.</small>

  const explanation = formatConversionExplanation(item)
  const basis = item.conversionBasis
  const factor = item.conversionFactor ?? 1
  const usable = item.usableQuantity ?? calculateUsableQuantity(item.quantity, factor)

  function updateFactor(value: number) {
    const safe = value > 0 ? value : 0
    onChange({ ...item, conversionFactor: safe, usableQuantity: calculateUsableQuantity(item.quantity, safe) })
  }

  function updateUsable(value: number) {
    const safe = value > 0 ? value : 0
    onChange({ ...item, usableQuantity: safe, conversionFactor: conversionFactorFromUsableQuantity(item.quantity, safe) })
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="ps-btn ghost sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'Fechar fator de conversão' : 'Fator de conversão'}</button>
      {open && (
        <div className="ps-banner honey" style={{ marginTop: 8 }}>
          <div className="ps-fieldgroup"><div className="ps-fieldlabel">Como este item entra na receita?</div><select className="ps-select" value={basis} onChange={event => onChange({ ...item, conversionBasis: event.target.value as NfeConversionBasis })}><option value="simple">A quantidade da NF já é a quantidade útil</option><option value="package">Cada unidade comprada contém quantas unidades úteis?</option><option value="usable">Informar o total aproveitável (ex.: peso drenado)</option></select></div>
          {basis === 'usable' ? (
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}><div className="ps-fieldlabel">Quantidade aproveitável total ({item.baseUnit})</div><input className="ps-input" type="number" min="0" step="0.001" value={usable || ''} onChange={event => updateUsable(Number(event.target.value))} /></div>
          ) : (
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}><div className="ps-fieldlabel">Fator por unidade comprada ({item.baseUnit})</div><input className="ps-input" type="number" min="0" step="0.001" value={factor || ''} onChange={event => updateFactor(Number(event.target.value))} /></div>
          )}
          <div style={{ marginTop: 10 }}><b>Conferência do cálculo</b><small style={{ display: 'block', marginTop: 4 }}>{explanation.input}</small><small style={{ display: 'block' }}>{explanation.operation}</small><small style={{ display: 'block' }}>{explanation.output}</small><small style={{ display: 'block', marginTop: 4 }}><b>{explanation.cost}</b></small></div>
        </div>
      )}
    </div>
  )
}
