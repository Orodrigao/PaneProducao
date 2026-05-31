'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronLeft, MessageCircle, AlertTriangle, ExternalLink, RefreshCw, Sparkles, Save, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import { buildQuotationMessage, buildWhatsAppLink, type QuotationItemDetail } from '@/lib/quotations'

interface QuotationRow { id: string; week_reference: string; status: string; created_by: string; created_at: string }
interface ItemRow { id: string; product_id: string; quantity: number; unit: string | null; product_name: string }
interface SupplierRow {
  id: string
  supplier_id: string
  channel: string
  generated_message: string | null
  sent_at: string | null
  status: string
  supplier_name: string
  supplier_whatsapp: string | null
}
interface MapRow { supplier_id: string; product_id: string }
interface ParsedItem {
  product_id: string | null
  product_name: string
  unit_price: number
  unit: string | null
  available: boolean
  notes: string | null
}
interface SavedResponse {
  id: string
  supplier_id: string
  product_id: string
  unit_price: number
  unit: string | null
  available: boolean
  notes: string | null
}

const STATUS_LABEL: Record<string, string> = { pending:'Aguardando', sent:'Enviada', responded:'Respondida', closed:'Fechada' }
const STATUS_CLS: Record<string, string> = { pending:'separado', sent:'enviado', responded:'conferido', closed:'aprovado' }

function DetalheInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const quotationId = sp.get('id') || ''

  const [user, setUser] = useState<AppUser | null>(null)
  const [quotation, setQuotation] = useState<QuotationRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [mappings, setMappings] = useState<MapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingMsg, setEditingMsg] = useState<Record<string, string>>({})
  const [pasteText, setPasteText] = useState<Record<string, string>>({})
  const [parsing, setParsing] = useState<Record<string, boolean>>({})
  const [parsed, setParsed] = useState<Record<string, ParsedItem[]>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [responses, setResponses] = useState<SavedResponse[]>([])

  useEffect(() => { setUser(getCurrentUser()); if (quotationId) load() }, [quotationId])

  async function load() {
    setLoading(true)
    try {
      const [{ data: q }, { data: its }] = await Promise.all([
        supabase.from('quotations').select('*').eq('id', quotationId).single(),
        supabase.from('quotation_items').select('id,product_id,quantity,unit,products(name)').eq('quotation_id', quotationId),
      ])
      setQuotation(q as QuotationRow)
      const itemsRows: ItemRow[] = ((its || []) as any[]).map(i => ({
        id: i.id, product_id: i.product_id, quantity: Number(i.quantity), unit: i.unit, product_name: i.products?.name || '(removido)'
      }))
      setItems(itemsRows)

      // Respostas já salvas em quotation_responses
      const { data: resps } = await supabase
        .from('quotation_responses')
        .select('id,supplier_id,product_id,unit_price,unit,available,notes')
        .eq('quotation_id', quotationId)
      setResponses(((resps || []) as any[]).map(r => ({
        id: r.id, supplier_id: r.supplier_id, product_id: r.product_id,
        unit_price: Number(r.unit_price), unit: r.unit, available: r.available, notes: r.notes,
      })))

      // Carrega supplier_products dos produtos da cotação SEM filtrar por
      // fornecedores já-na-cotação. Se o user mapeou um fornecedor novo
      // depois que a cotação foi gerada (resolvendo um órfão), pegamos ele
      // aqui e criamos a quotation_suppliers row faltante no caminho.
      const productIds = itemsRows.map(i => i.product_id)
      let allMaps: any[] = []
      if (productIds.length > 0) {
        const { data } = await supabase.from('supplier_products')
          .select('supplier_id,product_id,suppliers!inner(active)')
          .in('product_id', productIds)
          .eq('active', true)
          .eq('suppliers.active', true)
        allMaps = data || []
      }
      setMappings(allMaps.map(m => ({ supplier_id: m.supplier_id, product_id: m.product_id })))

      // Carrega fornecedores existentes da cotação
      const { data: existingSups } = await supabase
        .from('quotation_suppliers')
        .select('id,supplier_id,channel,generated_message,sent_at,status,suppliers(name,whatsapp_e164)')
        .eq('quotation_id', quotationId)
      const existingSupplierIds = new Set(((existingSups || []) as any[]).map(s => s.supplier_id))

      // Detecta novos fornecedores que ganharam mapeamento depois da geração
      const newSupplierIds = Array.from(new Set(allMaps.map(m => m.supplier_id)))
        .filter(id => !existingSupplierIds.has(id))
      if (newSupplierIds.length > 0) {
        const rows = newSupplierIds.map(sid => ({
          quotation_id: quotationId, supplier_id: sid, status: 'pending', channel: 'whatsapp',
        }))
        await supabase.from('quotation_suppliers').insert(rows)
        // Recarrega pra pegar os recém-inseridos com o join de suppliers
        const { data: refreshed } = await supabase
          .from('quotation_suppliers')
          .select('id,supplier_id,channel,generated_message,sent_at,status,suppliers(name,whatsapp_e164)')
          .eq('quotation_id', quotationId)
        const supRows: SupplierRow[] = ((refreshed || []) as any[]).map(s => ({
          id: s.id, supplier_id: s.supplier_id, channel: s.channel, generated_message: s.generated_message,
          sent_at: s.sent_at, status: s.status,
          supplier_name: s.suppliers?.name || '(removido)',
          supplier_whatsapp: s.suppliers?.whatsapp_e164 || null,
        }))
        setSuppliers(supRows)
      } else {
        const supRows: SupplierRow[] = ((existingSups || []) as any[]).map(s => ({
          id: s.id, supplier_id: s.supplier_id, channel: s.channel, generated_message: s.generated_message,
          sent_at: s.sent_at, status: s.status,
          supplier_name: s.suppliers?.name || '(removido)',
          supplier_whatsapp: s.suppliers?.whatsapp_e164 || null,
        }))
        setSuppliers(supRows)
      }
    } catch (e: any) {
      showToast('Erro ao carregar: '+(e.message||''))
    } finally {
      setLoading(false)
    }
  }

  // Lista de itens que um fornecedor cobre
  function itemsForSupplier(supplierId: string): ItemRow[] {
    const mineProductIds = new Set(mappings.filter(m => m.supplier_id === supplierId).map(m => m.product_id))
    return items.filter(it => mineProductIds.has(it.product_id))
  }

  // Itens sem nenhum fornecedor mapeado nessa cotação
  const orphanItems = (() => {
    const coveredProductIds = new Set(mappings.map(m => m.product_id))
    return items.filter(it => !coveredProductIds.has(it.product_id))
  })()

  function messageFor(sup: SupplierRow): string {
    // Se editado em memória, usa. Senão se já tem persistido, usa. Senão gera.
    const edited = editingMsg[sup.id]
    if (edited !== undefined) return edited
    if (sup.generated_message) return sup.generated_message
    const myItems: QuotationItemDetail[] = itemsForSupplier(sup.supplier_id).map(it => ({
      name: it.product_name, quantity: it.quantity, unit: it.unit
    }))
    return buildQuotationMessage({ name: sup.supplier_name, whatsapp_e164: sup.supplier_whatsapp }, quotation?.week_reference || '', myItems)
  }

  async function persistMessage(sup: SupplierRow, msg: string) {
    const { error } = await supabase.from('quotation_suppliers')
      .update({ generated_message: msg }).eq('id', sup.id)
    if (error) { showToast('Erro: '+error.message); return false }
    setSuppliers(prev => prev.map(s => s.id === sup.id ? { ...s, generated_message: msg } : s))
    setEditingMsg(prev => { const n = { ...prev }; delete n[sup.id]; return n })
    return true
  }

  async function openWhatsApp(sup: SupplierRow) {
    const msg = messageFor(sup)
    const link = buildWhatsAppLink({ name: sup.supplier_name, whatsapp_e164: sup.supplier_whatsapp }, msg)
    if (!link) { showToast('Sem WhatsApp E.164 cadastrado pro fornecedor'); return }

    // Persiste a mensagem (se ainda não persistida) + marca sent
    await persistMessage(sup, msg)
    const now = new Date().toISOString()
    await supabase.from('quotation_suppliers').update({ sent_at: now, status: 'sent' }).eq('id', sup.id)
    setSuppliers(prev => prev.map(s => s.id === sup.id ? { ...s, sent_at: now, status: 'sent' } : s))

    // Promove a cotação pai pra 'sent' no primeiro envio.
    // Se já saiu de 'draft' (sent/responded/closed), preserva — nunca volta atrás.
    if (quotation?.status === 'draft') {
      await supabase.from('quotations').update({ status: 'sent' }).eq('id', quotationId)
      setQuotation(prev => prev ? { ...prev, status: 'sent' } : prev)
    }

    // Abre o link no WhatsApp
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  async function parseWithAI(sup: SupplierRow) {
    const text = (pasteText[sup.id] || '').trim()
    if (!text) { showToast('Cole a resposta primeiro'); return }
    setParsing(prev => ({...prev, [sup.id]: true}))
    try {
      const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const myItems = itemsForSupplier(sup.supplier_id)
      const catalog = myItems.map(it => ({ id: it.product_id, name: it.product_name, unit: it.unit }))
      const resp = await fetch(`${SB_URL}/functions/v1/parse-cotacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
        body: JSON.stringify({ text, products: catalog }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        showToast('Erro IA: '+(data?.error || resp.status))
        return
      }
      const items: ParsedItem[] = Array.isArray(data?.items) ? data.items : []
      if (items.length === 0) { showToast('IA não achou nenhum item.'); return }
      setParsed(prev => ({...prev, [sup.id]: items}))
      showToast(`✅ IA extraiu ${items.length} itens. Confira e salve.`)
    } catch (e: any) {
      showToast('Erro: '+(e?.message || ''))
    } finally {
      setParsing(prev => ({...prev, [sup.id]: false}))
    }
  }

  function updateParsedItem(supId: string, idx: number, patch: Partial<ParsedItem>) {
    setParsed(prev => ({
      ...prev,
      [supId]: (prev[supId] || []).map((it, i) => i === idx ? { ...it, ...patch } : it)
    }))
  }
  function removeParsedItem(supId: string, idx: number) {
    setParsed(prev => ({
      ...prev,
      [supId]: (prev[supId] || []).filter((_, i) => i !== idx)
    }))
  }

  async function saveResponses(sup: SupplierRow) {
    const items = parsed[sup.id] || []
    const valid = items.filter(it => it.product_id && (it.unit_price > 0 || !it.available))
    if (valid.length === 0) { showToast('Nenhum item com produto selecionado e preço/indisponível pra salvar'); return }
    setSaving(prev => ({...prev, [sup.id]: true}))
    try {
      const rows = valid.map(it => ({
        quotation_id: quotationId,
        supplier_id: sup.supplier_id,
        product_id: it.product_id!,
        unit_price: it.available ? it.unit_price : 0,
        unit: it.unit,
        available: it.available,
        notes: it.notes,
      }))
      const { error } = await supabase
        .from('quotation_responses')
        .upsert(rows, { onConflict: 'quotation_id,supplier_id,product_id' })
      if (error) { showToast('Erro: '+error.message); return }

      // Marca o fornecedor como respondida
      if (sup.status !== 'responded' && sup.status !== 'closed') {
        await supabase.from('quotation_suppliers').update({ status: 'responded' }).eq('id', sup.id)
        setSuppliers(prev => prev.map(s => s.id === sup.id ? { ...s, status: 'responded' } : s))
      }

      // Bump quotation.status pra 'responded' se ainda tava draft/sent
      if (quotation && (quotation.status === 'draft' || quotation.status === 'sent')) {
        await supabase.from('quotations').update({ status: 'responded' }).eq('id', quotationId)
        setQuotation(prev => prev ? { ...prev, status: 'responded' } : prev)
      }

      // Limpa textarea + parsed dessa fornecedora; recarrega responses
      setPasteText(prev => { const n = {...prev}; delete n[sup.id]; return n })
      setParsed(prev => { const n = {...prev}; delete n[sup.id]; return n })
      const { data: refresh } = await supabase
        .from('quotation_responses')
        .select('id,supplier_id,product_id,unit_price,unit,available,notes')
        .eq('quotation_id', quotationId)
      setResponses(((refresh || []) as any[]).map(r => ({
        id: r.id, supplier_id: r.supplier_id, product_id: r.product_id,
        unit_price: Number(r.unit_price), unit: r.unit, available: r.available, notes: r.notes,
      })))
      showToast(`✅ ${rows.length} respostas salvas`)
    } finally {
      setSaving(prev => ({...prev, [sup.id]: false}))
    }
  }

  if (!quotationId) {
    return (
      <div className="ps-canvas"><div className="ps-shell"><div className="ps-card" style={{padding:20, textAlign:'center', marginTop:14}}>
        <AlertTriangle size={28} style={{color:'var(--berry)', margin:'0 auto 8px', display:'block'}}/>
        <div style={{marginBottom:12, color:'var(--berry)'}}>Cotação não especificada.</div>
        <Link href="/cotacoes" className="ps-btn primary">Voltar pra Cotações</Link>
      </div></div></div>
    )
  }

  const semana = (() => {
    if (!quotation) return ''
    const [y, m, d] = quotation.week_reference.split('-')
    return (d && m && y) ? `${d}/${m}/${y}` : quotation.week_reference
  })()

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/cotacoes')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Cotação</b>
              <span>Semana de {semana}</span>
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
          ) : !quotation ? (
            <div className="ps-card" style={{padding:20, textAlign:'center'}}>Cotação não encontrada.</div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
                <div style={{fontSize:12, color:'var(--ink-faint)'}}>
                  {items.length} itens · {suppliers.length} fornecedores · criada por {quotation.created_by}
                </div>
                <button onClick={load} className="ps-btn ghost sm" title="Recarregar">
                  <RefreshCw size={12}/>
                </button>
              </div>

              {responses.length > 0 && (
                <Link href={`/cotacoes/comparativo?id=${quotationId}`} className="ps-btn block" style={{marginBottom:12, background:'var(--honey-deep)', color:'white'}}>
                  📊 Ver comparativo &amp; gerar pedidos ({responses.length} respostas)
                </Link>
              )}

              {/* Bloco de órfãos */}
              {orphanItems.length > 0 && (
                <div className="ps-card" style={{padding:14, marginBottom:12, borderLeft:'4px solid var(--berry)'}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                    <AlertTriangle size={14} style={{color:'var(--berry)'}}/>
                    <div style={{fontWeight:700, color:'var(--berry)', fontSize:13}}>
                      Sem fornecedor mapeado ({orphanItems.length})
                    </div>
                  </div>
                  <div style={{fontSize:11, color:'var(--ink-soft)', marginBottom:8}}>
                    Esses itens da cotação não têm fornecedor cadastrado em <Link href="/fornecedores" style={{textDecoration:'underline'}}>/fornecedores</Link>. Cadastra o vínculo lá e recarrega esta página.
                  </div>
                  {orphanItems.map(it => (
                    <div key={it.id} style={{fontSize:13, padding:'4px 0', borderBottom:'1px solid var(--line-soft)'}}>
                      {it.product_name} <span style={{color:'var(--ink-faint)'}}>· {it.quantity}{it.unit?' '+it.unit:''}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Cards por fornecedor */}
              {suppliers.length === 0 ? (
                <div className="ps-empty">Nenhum fornecedor mapeado pra esta cotação.</div>
              ) : suppliers.map(sup => {
                const myItems = itemsForSupplier(sup.supplier_id)
                const msg = messageFor(sup)
                const hasWa = !!sup.supplier_whatsapp
                return (
                  <div key={sup.id} className="ps-card" style={{padding:14, marginBottom:12}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:8}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div className="ps-pname" style={{fontSize:14}}>{sup.supplier_name}</div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {myItems.length} {myItems.length === 1 ? 'item' : 'itens'}
                          {sup.sent_at && ` · enviada ${new Date(sup.sent_at).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' })}`}
                          {!hasWa && <span style={{color:'var(--berry)'}}> · sem WhatsApp</span>}
                        </div>
                      </div>
                      <span className={`ps-status ${STATUS_CLS[sup.status] || 'separado'}`}>{STATUS_LABEL[sup.status] || sup.status}</span>
                    </div>

                    {myItems.length === 0 ? (
                      <div style={{fontSize:12, color:'var(--ink-faint)', fontStyle:'italic', padding:'8px 0'}}>
                        Nenhum item dessa cotação está mapeado pra esse fornecedor.
                      </div>
                    ) : (
                      <>
                        <div className="ps-fieldgroup" style={{marginBottom:10}}>
                          <div className="ps-fieldlabel">Mensagem pro WhatsApp</div>
                          <textarea
                            value={msg}
                            onChange={e => setEditingMsg(prev => ({...prev, [sup.id]: e.target.value}))}
                            onBlur={e => persistMessage(sup, e.target.value)}
                            rows={Math.min(14, msg.split('\n').length + 1)}
                            className="ps-input"
                            style={{fontFamily:'inherit', resize:'vertical', minHeight:120, fontSize:12, lineHeight:1.5}}
                          />
                        </div>
                        <button
                          onClick={() => openWhatsApp(sup)}
                          disabled={!hasWa}
                          className="ps-btn primary block"
                          style={!hasWa ? {opacity:.5, cursor:'not-allowed'} : undefined}
                        >
                          <MessageCircle size={14}/> {sup.sent_at ? 'Reenviar pelo WhatsApp' : 'Abrir no WhatsApp'} <ExternalLink size={12}/>
                        </button>

                        {/* Respostas já salvas */}
                        {(() => {
                          const saved = responses.filter(r => r.supplier_id === sup.supplier_id)
                          if (saved.length === 0) return null
                          return (
                            <div style={{marginTop:12, padding:10, background:'var(--cream)', borderRadius:8}}>
                              <div className="ps-flabel" style={{marginBottom:6}}>Respostas salvas ({saved.length})</div>
                              {saved.map(r => {
                                const it = myItems.find(i => i.product_id === r.product_id)
                                return (
                                  <div key={r.id} style={{fontSize:12, padding:'3px 0', display:'flex', justifyContent:'space-between'}}>
                                    <span>{it?.product_name || '(produto)'}{!r.available && <span style={{color:'var(--berry)'}}> · indisponível</span>}</span>
                                    {r.available && <strong>R$ {Number(r.unit_price).toFixed(2)}{r.unit ? `/${r.unit}` : ''}</strong>}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}

                        {/* Lançamento de resposta */}
                        <div style={{marginTop:12, padding:10, background:'var(--honey-tint)', borderRadius:8}}>
                          <div className="ps-flabel" style={{marginBottom:6}}>Lançar resposta do fornecedor</div>
                          <textarea
                            value={pasteText[sup.id] || ''}
                            onChange={e => setPasteText(prev => ({...prev, [sup.id]: e.target.value}))}
                            placeholder={`Cole aqui a resposta recebida (ex: "Farinha: R$ 4,20/kg, sim\\nAçúcar: R$ 5,50/kg | sim")`}
                            className="ps-input"
                            rows={4}
                            style={{fontFamily:'inherit', fontSize:12, resize:'vertical', minHeight:80, marginBottom:8}}
                          />
                          <button
                            onClick={() => parseWithAI(sup)}
                            disabled={parsing[sup.id] || !pasteText[sup.id]}
                            className="ps-btn block"
                            style={{marginBottom:8, background:'var(--sage)', color:'white'}}
                          >
                            <Sparkles size={14}/> {parsing[sup.id] ? 'Extraindo…' : 'Extrair preços com IA'}
                          </button>

                          {parsed[sup.id] && parsed[sup.id].length > 0 && (
                            <>
                              <div className="ps-flabel" style={{marginTop:6, marginBottom:6}}>Confira antes de salvar ({parsed[sup.id].length})</div>
                              {parsed[sup.id].map((it, idx) => (
                                <div key={idx} style={{padding:8, background:'white', borderRadius:6, marginBottom:6, border:'1px solid var(--line-soft)'}}>
                                  <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:6}}>
                                    <select
                                      value={it.product_id || ''}
                                      onChange={e => updateParsedItem(sup.id, idx, { product_id: e.target.value || null })}
                                      className="ps-select"
                                      style={{flex:1, fontSize:12, padding:'4px 6px'}}
                                    >
                                      <option value="">— escolha o produto —</option>
                                      {myItems.map(mi => (
                                        <option key={mi.product_id} value={mi.product_id}>{mi.product_name}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => removeParsedItem(sup.id, idx)} className="ps-iconbtn" style={{width:26, height:26}} title="Remover">
                                      <Trash2 size={12}/>
                                    </button>
                                  </div>
                                  <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:6}}>IA leu: <em>{it.product_name}</em></div>
                                  <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                                    <label style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                      <input type="checkbox" checked={it.available} onChange={e => updateParsedItem(sup.id, idx, { available: e.target.checked })}/>
                                      disponível
                                    </label>
                                    {it.available && <>
                                      <span style={{fontSize:11}}>R$</span>
                                      <input
                                        type="number" step="0.01" min="0"
                                        value={it.unit_price}
                                        onChange={e => updateParsedItem(sup.id, idx, { unit_price: parseFloat(e.target.value.replace(',','.')) || 0 })}
                                        className="ps-input" style={{width:80, fontSize:11, padding:'3px 6px'}}
                                      />
                                      <span style={{fontSize:11}}>/</span>
                                      <input
                                        type="text"
                                        value={it.unit || ''}
                                        onChange={e => updateParsedItem(sup.id, idx, { unit: e.target.value || null })}
                                        placeholder="un"
                                        className="ps-input" style={{width:50, fontSize:11, padding:'3px 6px'}}
                                      />
                                    </>}
                                  </div>
                                  {it.notes && <div style={{fontSize:11, color:'var(--ink-faint)', fontStyle:'italic', marginTop:4}}>{it.notes}</div>}
                                </div>
                              ))}
                              <button
                                onClick={() => saveResponses(sup)}
                                disabled={saving[sup.id]}
                                className="ps-btn primary block"
                              >
                                <Save size={14}/> {saving[sup.id] ? 'Salvando…' : 'Salvar respostas'}
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CotacaoDetalhePage() {
  return (
    <Suspense fallback={
      <div className="ps-canvas"><div className="ps-shell"><div style={{padding:24, color:'var(--ink-faint)'}}>Carregando…</div></div></div>
    }>
      <DetalheInner/>
    </Suspense>
  )
}
