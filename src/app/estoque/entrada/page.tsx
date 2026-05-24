'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'
import { useRouter } from 'next/navigation'

interface EntryItem {
  product_id: string
  product_name: string
  unit: string
  quantity: string
  unit_cost: string
}
interface Supplier { id: string; name: string }
interface Product  { id: string; name: string; unit: string; category: string }

export default function EstoqueEntradaPage() {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)

  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [products, setProducts]       = useState<Product[]>([])
  const [supplierId, setSupplierId]   = useState('')
  const [entryDate, setEntryDate]     = useState(new Date().toISOString().split('T')[0])
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [notes, setNotes]             = useState('')
  const [items, setItems]             = useState<EntryItem[]>([])
  const [search, setSearch]           = useState('')
  const [showSearch, setShowSearch]   = useState(false)
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    supabase.from('suppliers').select('id,name').eq('active', true).order('name').then(({ data }) => setSuppliers(data || []))
    supabase.from('products').select('id,name,unit,category').eq('active', true).order('name').then(({ data }) => setProducts(data || []))
  }, [])

  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50)
  }, [showSearch])

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) && !items.find(i => i.product_id === p.id)
  ).slice(0, 10)

  const addProduct = (p: Product) => {
    setItems(prev => [...prev, { product_id: p.id, product_name: p.name, unit: p.unit, quantity: '', unit_cost: '' }])
    setSearch('')
    setShowSearch(false)
  }

  const updateItem = (idx: number, field: 'quantity' | 'unit_cost', val: string) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  const totalValue = items.reduce((sum, it) => {
    const qty  = parseFloat(it.quantity)  || 0
    const cost = parseFloat(it.unit_cost) || 0
    return sum + qty * cost
  }, 0)

  const validItems = items.filter(it => parseFloat(it.quantity) > 0 && parseFloat(it.unit_cost) > 0)

  const save = async () => {
    if (!validItems.length) { showToast('Adicione ao menos 1 item com qtd e custo'); return }
    setSaving(true)
    try {
      const { data: entry, error: entryErr } = await supabase
        .from('stock_entries')
        .insert({
          supplier_id:    supplierId || null,
          entry_date:     entryDate,
          invoice_number: invoiceNumber || null,
          total_value:    parseFloat(totalValue.toFixed(2)),
          notes:          notes || null,
          created_by:     'Admin',
        })
        .select()
        .single()
      if (entryErr || !entry) throw entryErr || new Error('Erro ao criar entrada')

      await supabase.from('stock_entry_items').insert(
        validItems.map(it => ({
          entry_id:     entry.id,
          product_id:   it.product_id,
          product_name: it.product_name,
          quantity:     parseFloat(it.quantity),
          unit:         it.unit,
          unit_cost:    parseFloat(it.unit_cost),
        }))
      )

      for (const it of validItems) {
        const qty  = parseFloat(it.quantity)
        const cost = parseFloat(it.unit_cost)
        const { data: existing } = await supabase
          .from('stock_balance')
          .select('*')
          .eq('product_id', it.product_id)
          .maybeSingle()

        if (existing) {
          const newQty = existing.quantity + qty
          const newAvg = (existing.quantity * existing.average_cost + qty * cost) / newQty
          await supabase.from('stock_balance').update({
            quantity: parseFloat(newQty.toFixed(3)),
            average_cost: parseFloat(newAvg.toFixed(4)),
            last_updated: new Date().toISOString(),
          }).eq('id', existing.id)
        } else {
          await supabase.from('stock_balance').insert({
            product_id:   it.product_id,
            quantity:     qty,
            average_cost: cost,
          })
        }

        await supabase.from('stock_movements').insert({
          product_id:     it.product_id,
          movement_type:  'entrada',
          quantity:       qty,
          unit_cost:      cost,
          reference_id:   entry.id,
          reference_type: 'stock_entry',
          notes:          invoiceNumber ? `NF ${invoiceNumber}` : null,
          created_by:     'Admin',
        })
      }

      showToast('Entrada registrada!')
      router.push('/estoque')
    } catch (e) {
      console.error(e)
      showToast('Erro ao salvar. Tente novamente.')
    }
    setSaving(false)
  }

  return (
    <div id="app">
      <div className="topbar">
        <button onClick={() => router.push('/estoque')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--text-muted)', padding: '0 8px 0 0', lineHeight: 1 }}>←</button>
        <span className="topbar-logo">Nova Entrada</span>
        <span className="topbar-badge tb-amber">Estoque</span>
      </div>

      <div style={{ padding: '16px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', marginBottom: '14px' }}>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Fornecedor</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px', background: 'white' }}>
              <option value="">Sem fornecedor / compra direta</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Data</label>
              <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Nº NF / Recibo</label>
              <input type="text" placeholder="Opcional" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Observações</label>
            <input type="text" placeholder="Opcional" value={notes} onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px' }} />
          </div>
        </div>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
          Produtos comprados
        </div>

        {items.map((it, idx) => {
          const subtotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0)
          return (
            <div key={it.product_id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontWeight: 500, fontSize: '14px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>{it.product_name}</div>
                <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--coral)', fontSize: '20px', lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>Qtd ({it.unit})</label>
                  <input type="number" inputMode="decimal" placeholder="0" value={it.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    style={{ width: '100%', padding: '9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '15px', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>Custo unitário (R$)</label>
                  <input type="number" inputMode="decimal" placeholder="0,00" value={it.unit_cost}
                    onChange={e => updateItem(idx, 'unit_cost', e.target.value)}
                    style={{ width: '100%', padding: '9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '15px', outline: 'none' }} />
                </div>
              </div>
              {subtotal > 0 && (
                <div style={{ fontSize: '13px', color: 'var(--teal)', marginTop: '7px', fontWeight: 600 }}>
                  = R$ {subtotal.toFixed(2)}
                </div>
              )}
            </div>
          )
        })}

        <div style={{ background: 'var(--surface)', border: `1px dashed ${showSearch ? 'var(--amber)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius)', padding: '12px', marginBottom: '14px' }}>
          {showSearch ? (
            <>
              <input ref={searchRef} type="text" placeholder="🔍 Nome do produto..." value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px', marginBottom: '8px', outline: 'none' }} />
              {search.length > 0 ? (
                filteredProducts.length > 0 ? filteredProducts.map(p => (
                  <div key={p.id} onClick={() => addProduct(p)}
                    style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px', background: 'var(--bg)' }}>
                    <span style={{ fontSize: '14px' }}>{p.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>{p.unit}</span>
                  </div>
                )) : (
                  <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum produto encontrado</div>
                )
              ) : (
                <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-hint)', fontSize: '13px' }}>Digite o nome do produto</div>
              )}
              <button onClick={() => { setShowSearch(false); setSearch('') }}
                style={{ fontSize: '13px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', display: 'block', marginTop: '4px' }}>
                Cancelar
              </button>
            </>
          ) : (
            <button onClick={() => setShowSearch(true)}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--amber)', fontWeight: 600, fontSize: '14px' }}>
              + Adicionar produto
            </button>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--amber)', fontSize: '14px' }}>Total da entrada</div>
              <div style={{ fontSize: '12px', color: 'var(--amber)', opacity: 0.7 }}>{validItems.length} de {items.length} item(s) preenchido(s)</div>
            </div>
            <span style={{ fontWeight: 700, fontSize: '20px', color: 'var(--amber)' }}>R$ {totalValue.toFixed(2)}</span>
          </div>
        )}

        <button onClick={save} disabled={saving || validItems.length === 0}
          style={{
            width: '100%', padding: '14px',
            background: validItems.length > 0 ? 'var(--amber)' : 'var(--border)',
            color: validItems.length > 0 ? 'white' : 'var(--text-muted)',
            border: 'none', borderRadius: 'var(--radius)', fontSize: '15px', fontWeight: 600,
            cursor: validItems.length > 0 ? 'pointer' : 'default', opacity: saving ? 0.6 : 1,
          }}>
          {saving ? 'Salvando...' : `Registrar entrada${validItems.length > 0 ? ` (${validItems.length} item${validItems.length > 1 ? 's' : ''})` : ''}`}
        </button>
      </div>
    </div>
  )
}
