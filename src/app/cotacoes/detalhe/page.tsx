'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronLeft, MessageCircle, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
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
