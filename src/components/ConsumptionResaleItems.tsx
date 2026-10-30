'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatMoney, formatQuantity, type InventoryConsumptionResaleItem } from '@/lib/inventoryConsumption'

type Props = {
  items: InventoryConsumptionResaleItem[]
  loading: boolean
  error: string | null
}

// Revenda comprada na semana sem cadastro de produto: o dinheiro dela nao
// entra no consumo nem no CMV %, porque nao ha contagem. A lista diz o que foi,
// de quem e por quanto, pela descricao da nota.
export default function ConsumptionResaleItems({ items, loading, error }: Props) {
  const [open, setOpen] = useState(false)

  if (loading) return null
  if (error) return <div style={{fontSize:12, color:'var(--red)', marginTop:8}}>{error}</div>
  if (items.length === 0) return null

  return (
    <div style={{marginTop:10}}>
      <button
        className="ps-btn ghost sm"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        style={{display:'flex', alignItems:'center', gap:4}}
      >
        {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
        Ver os {items.length} item(ns) de revenda sem cadastro
      </button>
      {open && (
        <div style={{marginTop:8}}>
          <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:6}}>
            Mercadoria de revenda lançada sem produto no cadastro: não entra no consumo nem no CMV %, e não há
            controle de estoque, perda nem margem. Para controlar, cadastre o produto e ligue a nota a ele.
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:'4px 12px', fontSize:12.5}}>
            {items.map(item => (
              <div key={`${item.supplier_name}|${item.item_description}|${item.item_unit}`} style={{display:'contents'}}>
                <span>
                  {item.item_description}
                  <span style={{color:'var(--ink-faint)'}}>
                    {` · ${item.supplier_name} · ${formatQuantity(item.quantity_purchased, item.item_unit)}`}
                    {item.purchases_count > 1 ? ` · ${item.purchases_count} notas` : ''}
                  </span>
                </span>
                <span style={{textAlign:'right'}}>{formatMoney(item.value_purchased)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
