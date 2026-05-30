'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Plus, X, Search, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'

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
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/estoque')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Nova Entrada</b>
              <span>Estoque</span>
            </div>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-card" style={{marginTop:14, gap:10}}>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Fornecedor</div>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="ps-select">
                <option value="">Sem fornecedor / compra direta</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="ps-fieldrow">
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Data</div>
                <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className="ps-input"/>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Nº NF / Recibo</div>
                <input type="text" placeholder="Opcional" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="ps-input"/>
              </div>
            </div>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Observações</div>
              <input type="text" placeholder="Opcional" value={notes} onChange={e => setNotes(e.target.value)} className="ps-input"/>
            </div>
          </div>

          <div className="ps-label">Produtos comprados</div>

          {items.length === 0 && !showSearch && (
            <div className="ps-empty" style={{padding:'20px 0'}}>Nenhum produto adicionado ainda.</div>
          )}

          {items.map((it, idx) => {
            const subtotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0)
            return (
              <div key={it.product_id} className="ps-card" style={{padding:'12px 14px', marginBottom:8}}>
                <div className="ps-card-head" style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:8}}>
                  <div className="ps-pname" style={{fontSize:14, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.product_name}</div>
                  <button onClick={() => removeItem(idx)} className="ps-iconbtn" style={{width:30, height:30}} aria-label="Remover">
                    <X size={14}/>
                  </button>
                </div>
                <div className="ps-fieldrow">
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Qtd ({it.unit})</div>
                    <input type="number" inputMode="decimal" placeholder="0" value={it.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)} className="ps-input"/>
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Custo unitário (R$)</div>
                    <input type="number" inputMode="decimal" placeholder="0,00" value={it.unit_cost}
                      onChange={e => updateItem(idx, 'unit_cost', e.target.value)} className="ps-input"/>
                  </div>
                </div>
                {subtotal > 0 && (
                  <div style={{fontSize:13, color:'var(--sage)', fontWeight:700, textAlign:'right'}}>
                    = R$ {subtotal.toFixed(2)}
                  </div>
                )}
              </div>
            )
          })}

          <div className="ps-card" style={{borderStyle:'dashed', borderColor:showSearch?'var(--honey-deep)':'var(--ps-line)', padding:12, marginBottom:14}}>
            {showSearch ? (
              <>
                <div style={{position:'relative', marginBottom:8}}>
                  <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
                  <input ref={searchRef} type="text" placeholder="Nome do produto..." value={search}
                    onChange={e => setSearch(e.target.value)} className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px'}}/>
                </div>
                {search.length > 0 ? (
                  filteredProducts.length > 0 ? filteredProducts.map(p => (
                    <div key={p.id} onClick={() => addProduct(p)}
                      style={{padding:'10px 12px', borderRadius:'var(--r-ctrl)', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3, background:'var(--cream-raise)'}}>
                      <span style={{fontSize:14}}>{p.name}</span>
                      <span style={{fontSize:12, color:'var(--ink-faint)', flexShrink:0}}>{p.unit}</span>
                    </div>
                  )) : (
                    <div style={{textAlign:'center', padding:12, color:'var(--ink-faint)', fontSize:13}}>Nenhum produto encontrado</div>
                  )
                ) : (
                  <div style={{textAlign:'center', padding:8, color:'var(--ink-faint)', fontSize:13}}>Digite o nome do produto</div>
                )}
                <button onClick={() => { setShowSearch(false); setSearch('') }} className="ps-btn ghost sm" style={{marginTop:4}}>
                  Cancelar
                </button>
              </>
            ) : (
              <button onClick={() => setShowSearch(true)} className="ps-btn block" style={{background:'transparent', boxShadow:'none', color:'var(--crust)'}}>
                <Plus size={16}/> Adicionar produto
              </button>
            )}
          </div>

          {items.length > 0 && (
            <div className="ps-banner honey">
              <span>
                <b>Total da entrada · R$ {totalValue.toFixed(2)}</b>
                <small style={{display:'block', fontWeight:500, fontSize:12, opacity:.85, marginTop:2}}>
                  {validItems.length} de {items.length} item(s) preenchido(s)
                </small>
              </span>
            </div>
          )}
        </div>

        <div className="ps-totalbar">
          <div className="ps-total-num">
            <b>R$ {totalValue.toFixed(2)}</b>
            <span>{validItems.length} item{validItems.length!==1?'s':''}</span>
          </div>
          <button onClick={save} disabled={saving || validItems.length === 0} className="ps-save">
            <Save size={16}/> {saving ? 'Salvando...' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
