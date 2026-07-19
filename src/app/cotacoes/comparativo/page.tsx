'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronLeft, AlertTriangle, Trophy, ShoppingBag, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import { ModulePaused } from '@/components/ModulePaused'
import { COMPRAS_COTACOES_PAUSADAS } from '@/lib/features'

interface QuotationRow { id: string; week_reference: string; status: string; created_by: string }
interface ItemRow { id: string; product_id: string; quantity: number; unit: string | null; product_name: string }
interface SupplierLite { supplier_id: string; supplier_name: string }
interface ResponseRow {
  supplier_id: string
  product_id: string
  unit_price: number
  unit: string | null
  available: boolean
}
interface OrderRow { id: string; supplier_id: string; status: string; supplier_name: string }
interface OrderItemRow { supplier_order_id: string; product_id: string; quantity: number; unit_price: number; unit: string | null }

function ComparativoInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const quotationId = sp.get('id') || ''

  const [user, setUser] = useState<AppUser | null>(null)
  const [quotation, setQuotation] = useState<QuotationRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([])
  const [responses, setResponses] = useState<ResponseRow[]>([])
  const [choices, setChoices] = useState<Record<string, string | null>>({})  // product_id → supplier_id
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([])

  useEffect(() => { setUser(getCurrentUser()); if (quotationId) load() }, [quotationId])

  async function load() {
    setLoading(true)
    try {
      const [{ data: q }, { data: its }, { data: sups }, { data: resps }] = await Promise.all([
        supabase.from('quotations').select('*').eq('id', quotationId).single(),
        supabase.from('quotation_items').select('id,product_id,quantity,unit,products(name)').eq('quotation_id', quotationId),
        supabase.from('quotation_suppliers').select('supplier_id,suppliers(name)').eq('quotation_id', quotationId),
        supabase.from('quotation_responses').select('supplier_id,product_id,unit_price,unit,available').eq('quotation_id', quotationId),
      ])
      setQuotation(q as QuotationRow)
      const itemsRows: ItemRow[] = ((its || []) as any[]).map(i => ({
        id: i.id, product_id: i.product_id, quantity: Number(i.quantity), unit: i.unit,
        product_name: i.products?.name || '(removido)'
      }))
      setItems(itemsRows)
      setSuppliers(((sups || []) as any[]).map(s => ({
        supplier_id: s.supplier_id, supplier_name: s.suppliers?.name || '(removido)'
      })))
      const respsTyped: ResponseRow[] = ((resps || []) as any[]).map(r => ({
        supplier_id: r.supplier_id, product_id: r.product_id,
        unit_price: Number(r.unit_price), unit: r.unit, available: r.available,
      }))
      setResponses(respsTyped)

      // Se a cotação tá fechada, carrega os pedidos já gerados pra modo read-only
      if (q && (q as any).status === 'closed') {
        const { data: ords } = await supabase
          .from('supplier_orders')
          .select('id,supplier_id,status,suppliers(name)')
          .eq('quotation_id', quotationId)
        const ordsTyped: OrderRow[] = ((ords || []) as any[]).map(o => ({
          id: o.id, supplier_id: o.supplier_id, status: o.status, supplier_name: o.suppliers?.name || '(removido)'
        }))
        setOrders(ordsTyped)
        if (ordsTyped.length > 0) {
          const { data: ois } = await supabase
            .from('supplier_order_items')
            .select('supplier_order_id,product_id,quantity,unit_price,unit')
            .in('supplier_order_id', ordsTyped.map(o => o.id))
          setOrderItems(((ois || []) as any[]).map(oi => ({
            supplier_order_id: oi.supplier_order_id, product_id: oi.product_id,
            quantity: Number(oi.quantity), unit_price: Number(oi.unit_price), unit: oi.unit,
          })))
        }
      } else {
        // Default: escolhe automaticamente o fornecedor com menor preço disponível por item
        const auto: Record<string, string | null> = {}
        for (const it of itemsRows) {
          const candidates = respsTyped.filter(r => r.product_id === it.product_id && r.available && r.unit_price > 0)
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.unit_price - b.unit_price)
            auto[it.product_id] = candidates[0].supplier_id
          } else {
            auto[it.product_id] = null
          }
        }
        setChoices(auto)
      }
    } catch (e: any) {
      showToast('Erro ao carregar: '+(e?.message || ''))
    } finally {
      setLoading(false)
    }
  }

  // Lookup do preço de um fornecedor pra um produto
  function priceFor(productId: string, supplierId: string): ResponseRow | null {
    return responses.find(r => r.product_id === productId && r.supplier_id === supplierId) || null
  }

  // Menor preço disponível por item
  const lowestBySupplier = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const it of items) {
      const cands = responses.filter(r => r.product_id === it.product_id && r.available && r.unit_price > 0)
      cands.sort((a, b) => a.unit_price - b.unit_price)
      map[it.product_id] = cands[0]?.supplier_id || null
    }
    return map
  }, [items, responses])

  // Total por fornecedor com base nas choices
  const totalsBySupplier = useMemo(() => {
    const totals: Record<string, { items: number; total: number }> = {}
    for (const it of items) {
      const sid = choices[it.product_id]
      if (!sid) continue
      const resp = priceFor(it.product_id, sid)
      if (!resp || !resp.available) continue
      if (!totals[sid]) totals[sid] = { items: 0, total: 0 }
      totals[sid].items++
      totals[sid].total += Number(resp.unit_price) * Number(it.quantity)
    }
    return totals
  }, [items, choices, responses])

  async function generateOrders() {
    if (!user) return
    setSubmitting(true)
    try {
      // Agrupa items por fornecedor escolhido
      const groups: Record<string, ItemRow[]> = {}
      for (const it of items) {
        const sid = choices[it.product_id]
        if (!sid) continue
        const resp = priceFor(it.product_id, sid)
        if (!resp || !resp.available || resp.unit_price <= 0) continue
        if (!groups[sid]) groups[sid] = []
        groups[sid].push(it)
      }
      const entries = Object.entries(groups)
      if (entries.length === 0) { showToast('Nenhum item com fornecedor escolhido'); return }

      // Confirmação visual antes de gravar (impacto operacional)
      const summary = entries.map(([sid, its]) => {
        const supName = suppliers.find(s => s.supplier_id === sid)?.supplier_name || sid.slice(0,8)
        return `${supName}: ${its.length} ${its.length === 1 ? 'item' : 'itens'}`
      }).join('\n')
      if (!confirm(`Gerar ${entries.length} ${entries.length === 1 ? 'pedido' : 'pedidos'}?\n\n${summary}\n\nA cotação será marcada como fechada.`)) return

      // Lock atômico contra geração dupla: fecha a cotação ANTES de inserir,
      // mas só se ainda não estava fechada (WHERE status != 'closed').
      // Se outra aba/admin já fechou (ou um retry), o filtro não casa nenhuma
      // linha → abortamos sem inserir pedidos duplicados. Static export não tem
      // transação no servidor, então esse UPDATE condicional é o ponto de
      // serialização disponível.
      const { data: locked, error: lockErr } = await supabase
        .from('quotations')
        .update({ status: 'closed' })
        .eq('id', quotationId)
        .neq('status', 'closed')
        .select('id')
      if (lockErr) { showToast('Erro: '+lockErr.message); return }
      if (!locked || locked.length === 0) {
        showToast('Esta cotação já foi fechada (pedidos já gerados).')
        await load()
        return
      }

      // Ganhamos o lock. Cria supplier_orders.
      const ordersToInsert = entries.map(([supplier_id]) => ({
        quotation_id: quotationId, supplier_id, status: 'open',
      }))
      const { data: createdOrders, error: ordErr } = await supabase
        .from('supplier_orders')
        .insert(ordersToInsert)
        .select('id,supplier_id')
      if (ordErr || !createdOrders) {
        // Inserção falhou após o lock — reabre a cotação pra permitir retry,
        // senão ela fica 'closed' com zero pedidos.
        await supabase.from('quotations').update({ status: 'responded' }).eq('id', quotationId)
        showToast('Erro: '+(ordErr?.message || 'sem dados'))
        return
      }

      // Cria supplier_order_items
      const orderItemsToInsert = createdOrders.flatMap((ord: any) => {
        const its = groups[ord.supplier_id] || []
        return its.map(it => {
          const resp = priceFor(it.product_id, ord.supplier_id)!
          return {
            supplier_order_id: ord.id,
            product_id: it.product_id,
            quantity: it.quantity,
            unit_price: resp.unit_price,
            unit: resp.unit || it.unit,
          }
        })
      })
      const { error: oiErr } = await supabase.from('supplier_order_items').insert(orderItemsToInsert)
      if (oiErr) {
        // Falha ao inserir items DEPOIS dos orders já gravados. Sem transação
        // no static export, desfaz manualmente: apaga os supplier_orders
        // criados (CASCADE limpa items parciais) e reabre a cotação pra retry.
        // Sem isso, ficariam pedidos órfãos com a cotação travada em 'closed'.
        const createdIds = (createdOrders as any[]).map(o => o.id)
        await supabase.from('supplier_orders').delete().in('id', createdIds)
        await supabase.from('quotations').update({ status: 'responded' }).eq('id', quotationId)
        showToast('Erro itens: '+oiErr.message+' — revertido, tente de novo')
        await load()
        return
      }

      showToast(`✅ ${createdOrders.length} ${createdOrders.length === 1 ? 'pedido criado' : 'pedidos criados'}`)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  if (!quotationId) {
    return (
      <div className="ps-canvas"><div className="ps-shell"><div className="ps-card" style={{padding:20, textAlign:'center', marginTop:14}}>
        <AlertTriangle size={28} style={{color:'var(--berry)', margin:'0 auto 8px', display:'block'}}/>
        <div style={{marginBottom:12, color:'var(--berry)'}}>Cotação não especificada.</div>
        <Link href="/cotacoes" className="ps-btn primary">Voltar</Link>
      </div></div></div>
    )
  }

  const isClosed = quotation?.status === 'closed'

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push(`/cotacoes/detalhe?id=${quotationId}`)} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Comparativo</b>
              <span>{isClosed ? 'Fechada' : 'Escolha fornecedor por item'}</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          {loading ? (
            <div style={{padding:24, textAlign:'center', color:'var(--ink-faint)'}}>Carregando…</div>
          ) : isClosed ? (
            <>
              <div className="ps-card" style={{padding:14, marginBottom:12, background:'var(--sage)', color:'white'}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <Lock size={16}/>
                  <strong>Cotação fechada</strong>
                </div>
                <div style={{fontSize:12, marginTop:4, opacity:.9}}>
                  {orders.length} {orders.length === 1 ? 'pedido gerado' : 'pedidos gerados'}.
                </div>
              </div>
              {orders.map(ord => {
                const ois = orderItems.filter(oi => oi.supplier_order_id === ord.id)
                const total = ois.reduce((s, oi) => s + oi.quantity * oi.unit_price, 0)
                return (
                  <div key={ord.id} className="ps-card" style={{padding:14, marginBottom:12}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                      <div className="ps-pname" style={{fontSize:14}}>{ord.supplier_name}</div>
                      <strong style={{fontSize:14}}>R$ {total.toFixed(2)}</strong>
                    </div>
                    {ois.map(oi => {
                      const it = items.find(i => i.product_id === oi.product_id)
                      return (
                        <div key={oi.product_id} style={{display:'flex', justifyContent:'space-between', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--line-soft)'}}>
                          <span>{it?.product_name || '(produto)'} <span style={{color:'var(--ink-faint)'}}>· {oi.quantity}{oi.unit ? ' '+oi.unit : ''}</span></span>
                          <span>R$ {Number(oi.unit_price).toFixed(2)}{oi.unit ? `/${oi.unit}` : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </>
          ) : items.length === 0 ? (
            <div className="ps-empty">Cotação sem itens.</div>
          ) : responses.length === 0 ? (
            <div className="ps-card" style={{padding:20, textAlign:'center'}}>
              <AlertTriangle size={28} style={{color:'var(--berry)', margin:'0 auto 8px', display:'block'}}/>
              <div style={{marginBottom:8}}>Nenhuma resposta cadastrada ainda.</div>
              <Link href={`/cotacoes/detalhe?id=${quotationId}`} className="ps-btn primary">Voltar pra Detalhe</Link>
            </div>
          ) : (
            <>
              <div style={{fontSize:12, color:'var(--ink-faint)', marginBottom:12}}>
                {items.length} itens · {suppliers.length} fornecedores · pré-selecionei o menor preço por linha
              </div>

              {/* Cards por item */}
              {items.map(it => {
                const cands = responses.filter(r => r.product_id === it.product_id)
                const available = cands.filter(c => c.available && c.unit_price > 0)
                  .sort((a, b) => a.unit_price - b.unit_price)
                const unavailable = cands.filter(c => !c.available)
                const noResp = suppliers.filter(s =>
                  !cands.find(c => c.supplier_id === s.supplier_id)
                )
                const lowest = lowestBySupplier[it.product_id]
                const chosen = choices[it.product_id]
                return (
                  <div key={it.id} className="ps-card" style={{padding:12, marginBottom:10}}>
                    <div style={{marginBottom:8}}>
                      <div className="ps-pname" style={{fontSize:14}}>{it.product_name}</div>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                        Pedido: {it.quantity}{it.unit ? ' '+it.unit : ''}
                      </div>
                    </div>

                    {available.length === 0 && unavailable.length === 0 && noResp.length > 0 ? (
                      <div style={{padding:8, fontSize:12, color:'var(--ink-faint)', fontStyle:'italic'}}>
                        Nenhum fornecedor respondeu ainda.
                      </div>
                    ) : (
                      <>
                        {/* Disponíveis */}
                        {available.map(c => {
                          const supName = suppliers.find(s => s.supplier_id === c.supplier_id)?.supplier_name || '?'
                          const isLowest = c.supplier_id === lowest
                          const subtotal = c.unit_price * it.quantity
                          return (
                            <label key={c.supplier_id} style={{
                              display:'flex', alignItems:'center', gap:8, padding:'8px 6px',
                              borderTop:'1px solid var(--line-soft)', cursor:'pointer',
                              background: chosen === c.supplier_id ? 'var(--honey-tint)' : 'transparent',
                              borderRadius: chosen === c.supplier_id ? 6 : 0,
                            }}>
                              <input
                                type="radio"
                                checked={chosen === c.supplier_id}
                                onChange={() => setChoices(prev => ({...prev, [it.product_id]: c.supplier_id}))}
                              />
                              <div style={{flex:1, minWidth:0}}>
                                <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6}}>
                                  {supName}
                                  {isLowest && <span className="ps-store-chip jc"><Trophy size={10} style={{verticalAlign:'middle'}}/> MELHOR</span>}
                                </div>
                                <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                                  R$ {c.unit_price.toFixed(2)}{c.unit ? `/${c.unit}` : ''} · subtotal R$ {subtotal.toFixed(2)}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                        {/* Indisponíveis */}
                        {unavailable.map(c => {
                          const supName = suppliers.find(s => s.supplier_id === c.supplier_id)?.supplier_name || '?'
                          return (
                            <div key={c.supplier_id} style={{padding:'6px', borderTop:'1px solid var(--line-soft)', fontSize:12, color:'var(--ink-faint)', textDecoration:'line-through'}}>
                              {supName} · indisponível
                            </div>
                          )
                        })}
                        {/* "Não comprar este item" */}
                        <label style={{display:'flex', alignItems:'center', gap:8, padding:'8px 6px', borderTop:'1px solid var(--line-soft)', cursor:'pointer'}}>
                          <input
                            type="radio"
                            checked={chosen === null || chosen === ''}
                            onChange={() => setChoices(prev => ({...prev, [it.product_id]: null}))}
                          />
                          <span style={{fontSize:12, color:'var(--ink-soft)'}}>Não comprar este item</span>
                        </label>
                      </>
                    )}
                  </div>
                )
              })}

              {/* Total por fornecedor */}
              <div className="ps-card" style={{padding:14, marginBottom:12, marginTop:6}}>
                <div className="ps-flabel" style={{marginBottom:8}}>Total por fornecedor</div>
                {Object.keys(totalsBySupplier).length === 0 ? (
                  <div style={{fontSize:12, color:'var(--ink-faint)', fontStyle:'italic'}}>Nenhum item selecionado.</div>
                ) : (
                  Object.entries(totalsBySupplier).map(([sid, t]) => {
                    const supName = suppliers.find(s => s.supplier_id === sid)?.supplier_name || sid.slice(0,8)
                    return (
                      <div key={sid} style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--line-soft)'}}>
                        <span style={{fontSize:13}}>{supName} <span style={{color:'var(--ink-faint)'}}>· {t.items} {t.items === 1 ? 'item' : 'itens'}</span></span>
                        <strong>R$ {t.total.toFixed(2)}</strong>
                      </div>
                    )
                  })
                )}
                <div style={{display:'flex', justifyContent:'space-between', padding:'8px 0 0', marginTop:6, borderTop:'2px solid var(--ps-line)'}}>
                  <strong>Total geral</strong>
                  <strong style={{fontSize:16}}>R$ {Object.values(totalsBySupplier).reduce((s, t) => s + t.total, 0).toFixed(2)}</strong>
                </div>
              </div>

              <button
                onClick={generateOrders}
                disabled={submitting || Object.keys(totalsBySupplier).length === 0}
                className="ps-btn primary block"
              >
                <ShoppingBag size={14}/> {submitting ? 'Gerando…' : `Gerar ${Object.keys(totalsBySupplier).length || ''} ${Object.keys(totalsBySupplier).length === 1 ? 'pedido' : 'pedidos'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ComparativoPage() {
  if (COMPRAS_COTACOES_PAUSADAS) return <ModulePaused/>

  return (
    <Suspense fallback={
      <div className="ps-canvas"><div className="ps-shell"><div style={{padding:24, color:'var(--ink-faint)'}}>Carregando…</div></div></div>
    }>
      <ComparativoInner/>
    </Suspense>
  )
}
