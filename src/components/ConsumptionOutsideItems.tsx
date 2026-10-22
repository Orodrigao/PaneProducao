'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatMoney, type InventoryConsumptionOutsideItem } from '@/lib/inventoryConsumption'

type Props = {
  items: InventoryConsumptionOutsideItem[]
  loading: boolean
  error: string | null
}

// Itens de nota comprados na semana que nao estao na contagem: o dinheiro
// deles nao entra no consumo. A lista diz quais sao, em vez de so o total.
export default function ConsumptionOutsideItems({ items, loading, error }: Props) {
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
        Ver os {items.length} item(ns) fora da contagem
      </button>
      {open && (
        <div style={{marginTop:8}}>
          <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:6}}>
            Esses itens não entram no consumo. Insumo que deve entrar: marque <b>Contagem semanal</b> no
            {' '}<Link href="/produtos">cadastro do produto</Link>.
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:'4px 12px', fontSize:12.5}}>
            {items.map(item => (
              <div key={item.product_id} style={{display:'contents'}}>
                <span>
                  {item.product_name}
                  <span style={{color:'var(--ink-faint)'}}>
                    {item.product_category ? ` · ${item.product_category}` : ''}
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
