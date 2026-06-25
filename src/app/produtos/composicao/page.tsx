'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, X, Search, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface ParentProduct {
  id: string
  name: string
  kind: string | null
  category: string | null
  unit: string | null
  cost_price: number | null
  is_revenda: boolean | null
  is_fabricacao_propria: boolean | null
}
interface Component {
  id: string
  parent_product_id: string
  component_source: 'bread' | 'product'
  component_id: string
  quantity: number
}
interface BreadLite   { id: string; name: string; cost_price: number | null; unit: string | null; active: boolean | null }
interface ProductLite {
  id: string
  name: string
  cost_price: number | null
  unit: string | null
  kind: string | null
  active: boolean | null
  is_fabricacao_propria: boolean | null
  legacy_bread_id: string | null
}

function parsePositiveDecimal(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function formatQty(value: number): string {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function ComposicaoInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const parentId = sp.get('id') || ''

  const [user, setUser]           = useState<AppUser | null>(null)
  const [parent, setParent]       = useState<ParentProduct | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [breads, setBreads]       = useState<BreadLite[]>([])
  const [products, setProducts]   = useState<ProductLite[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [newQty, setNewQty]       = useState('1')
  const [qtyEdits, setQtyEdits]   = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, cRes, bRes, prRes] = await Promise.all([
        supabase.from('products').select('id,name,kind,category,unit,cost_price,is_revenda,is_fabricacao_propria').eq('id', parentId).single(),
        supabase.from('product_components').select('*').eq('parent_product_id', parentId),
        supabase.from('breads').select('id,name,cost_price,unit,active').order('name'),
        supabase.from('products').select('id,name,cost_price,unit,kind,active,is_fabricacao_propria,legacy_bread_id').order('name'),
      ])
      if (pRes.error) throw pRes.error
      setParent(pRes.data as ParentProduct)
      setComponents((cRes.data || []) as Component[])
      setBreads((bRes.data || []) as BreadLite[])
      setProducts((prRes.data || []) as ProductLite[])
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao carregar'))
    } finally {
      setLoading(false)
    }
  }, [parentId])

  useEffect(() => { setUser(getCurrentUser()); if (parentId) load() }, [parentId, load])

  async function addComponent(source: 'bread' | 'product', componentId: string) {
    const qty = parsePositiveDecimal(newQty)
    if (qty === null) { showToast('Quantidade inválida'); return }
    try {
      const { data, error } = await supabase
        .from('product_components')
        .insert({ parent_product_id: parentId, component_source: source, component_id: componentId, quantity: qty })
        .select()
        .single()
      if (error) throw error
      setComponents(prev => [...prev, data as Component])
      setSearch('')
      setNewQty('1')
      showToast('Componente adicionado')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao adicionar'))
    }
  }

  async function updateQty(componentId: string, raw: string) {
    const qty = parsePositiveDecimal(raw)
    if (qty === null) { showToast('Quantidade inválida'); return }
    try {
      const { error } = await supabase
        .from('product_components')
        .update({ quantity: qty })
        .eq('id', componentId)
      if (error) throw error
      setComponents(prev => prev.map(c => c.id === componentId ? { ...c, quantity: qty } : c))
      setQtyEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      showToast('Quantidade atualizada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar'))
    }
  }

  async function removeComponent(componentId: string) {
    if (!confirm('Remover este componente?')) return
    try {
      const { error } = await supabase.from('product_components').delete().eq('id', componentId)
      if (error) throw error
      setComponents(prev => prev.filter(c => c.id !== componentId))
      showToast('Componente removido')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao remover'))
    }
  }

  // Hidrata componentes com nome/custo/unidade do catalog
  const enriched = useMemo(() => components.map(c => {
    const item = c.component_source === 'bread'
      ? breads.find(b => b.id === c.component_id)
      : products.find(p => p.id === c.component_id)
    const cost = item?.cost_price ?? null
    return {
      ...c,
      name: item?.name ?? '(não encontrado)',
      cost: cost ?? 0,
      hasCost: cost !== null && Number(cost) > 0,
      unit: item?.unit ?? '',
    }
  }), [components, breads, products])

  const totalCMV = enriched.reduce((sum, e) => sum + Number(e.cost) * Number(e.quantity), 0)
  const partialCount = enriched.filter(e => !e.hasCost).length
  const manualCost = parent?.cost_price !== null && parent?.cost_price !== undefined ? Number(parent.cost_price) : null
  const manualDiff = manualCost !== null ? totalCMV - manualCost : null
  const canEditFicha = !!parent && parent.kind !== 'insumo' && !parent.is_revenda

  // Candidatos novos priorizam products. Breads legados só aparecem quando ainda não há produto migrado.
  const addedKeys = new Set(components.map(c => `${c.component_source}-${c.component_id}`))
  const migratedBreadIds = new Set(products.map(p => p.legacy_bread_id).filter(Boolean))
  const q = search.trim().toLowerCase()
  const candidates = q.length < 2 ? [] : [
    ...products
      .filter(p => p.active !== false && p.id !== parentId && p.kind !== 'kit' && !addedKeys.has(`product-${p.id}`) && p.name.toLowerCase().includes(q))
      .map(p => ({ source: 'product' as const, id: p.id, name: p.name, cost: p.cost_price, unit: p.unit, isFabricacao: !!p.is_fabricacao_propria })),
    ...breads
      .filter(b => b.active !== false && !migratedBreadIds.has(b.id) && !addedKeys.has(`bread-${b.id}`) && b.name.toLowerCase().includes(q))
      .map(b => ({ source: 'bread' as const, id: b.id, name: b.name, cost: b.cost_price, unit: b.unit, isFabricacao: false })),
  ].slice(0, 20)

  if (!parentId) {
    return (
      <div className="ps-canvas"><div className="ps-shell"><div className="ps-card" style={{padding:20, textAlign:'center'}}>
        <AlertTriangle size={28} style={{color:'var(--berry)', margin:'0 auto 8px', display:'block'}}/>
        <div style={{marginBottom:12, color:'var(--berry)'}}>Produto não especificado.</div>
        <Link href="/produtos" className="ps-btn primary">Voltar pra Produtos</Link>
      </div></div></div>
    )
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button onClick={() => router.push('/produtos')} className="ps-iconbtn" style={{marginRight:8}}>
              <ArrowLeft size={16}/>
            </button>
            <div className="ps-brand">
              <b>Ficha Técnica</b>
              <span>{parent?.name || '…'}</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-body">
          {loading ? (
            <div className="ps-card" style={{padding:24, textAlign:'center', color:'var(--ink-faint)'}}>Carregando…</div>
          ) : (
            <>
              {!canEditFicha && parent && (
                <div className="ps-warning" style={{marginBottom:12}}>
                  <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
                  <span>
                    <strong>{parent.name}</strong> usa custo direto. Para montar ficha técnica, ajuste o tipo para <strong>Produto final</strong> ou <strong>Kit</strong> em <Link href="/produtos" style={{textDecoration:'underline'}}>Catálogo</Link>.
                  </span>
                </div>
              )}

              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, marginBottom:12}}>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">CMV teórico</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{formatBRL(totalCMV)}</div>
                  <div style={{fontSize:11, color:partialCount > 0 ? 'var(--berry)' : 'var(--ink-faint)'}}>
                    {enriched.length === 0 ? 'sem ficha' : partialCount > 0 ? `${partialCount} sem custo` : 'custos completos'}
                  </div>
                </div>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">Componentes</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{enriched.length}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>produtos ou insumos</div>
                </div>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">Custo manual</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{manualCost === null ? '—' : formatBRL(manualCost)}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                    {manualDiff === null ? 'não cadastrado' : `${manualDiff >= 0 ? '+' : ''}${formatBRL(manualDiff)} vs ficha`}
                  </div>
                </div>
              </div>

              {/* Lista de componentes atuais */}
              <div className="ps-card" style={{padding:14, marginBottom:12}}>
                <div className="ps-flabel" style={{marginBottom:8}}>Componentes ({enriched.length})</div>
                {enriched.length === 0 ? (
                  <div style={{padding:'14px 4px', color:'var(--ink-faint)', fontSize:13, textAlign:'center'}}>
                    Nenhum componente cadastrado ainda.
                  </div>
                ) : (
                  enriched.map(e => (
                    <div key={e.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                          {e.name}
                          <span className={`ps-store-chip ${e.component_source==='bread'?'jc':'ja'}`}>{e.component_source==='bread'?'PÃO':'PRODUTO'}</span>
                          {!e.hasCost && <span className="ps-store-chip" style={{background:'var(--berry-tint)', color:'var(--berry)'}}>SEM CUSTO</span>}
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {e.hasCost
                            ? `${formatBRL(Number(e.cost))}${e.unit?`/${e.unit}`:''} × ${formatQty(Number(e.quantity))} = ${formatBRL(Number(e.cost)*Number(e.quantity))}`
                            : `× ${formatQty(Number(e.quantity))}${e.unit?` ${e.unit}`:''}`}
                        </div>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={qtyEdits[e.id] ?? formatQty(Number(e.quantity))}
                        onChange={ev => setQtyEdits(prev => ({...prev, [e.id]: ev.target.value.replace(/[^\d,.]/g, '')}))}
                        onBlur={ev => {
                          const v = ev.target.value
                          const parsed = parsePositiveDecimal(v)
                          if (parsed === null) {
                            showToast('Quantidade inválida')
                            setQtyEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                          } else if (parsed !== Number(e.quantity)) updateQty(e.id, v)
                          else setQtyEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                        }}
                        disabled={!canEditFicha}
                        className="ps-input"
                        style={{width:70, textAlign:'right', padding:'6px 8px'}}
                      />
                      {canEditFicha && (
                        <button onClick={() => removeComponent(e.id)} className="ps-iconbtn" style={{width:30, height:30}} title="Remover componente">
                          <X size={14}/>
                        </button>
                      )}
                    </div>
                  ))
                )}

                {/* Sumário CMV */}
                {enriched.length > 0 && (
                  <div style={{marginTop:12, paddingTop:10, borderTop:'1px solid var(--ps-line)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                    <div style={{fontSize:12, color:'var(--ink-soft)'}}>
                      CMV teórico{partialCount > 0 && <span style={{color:'var(--berry)'}}> · {partialCount} sem custo</span>}
                    </div>
                    <div style={{fontSize:18, fontWeight:700, color:'var(--ps-ink)'}}>{formatBRL(totalCMV)}</div>
                  </div>
                )}

                {parent && parent.cost_price !== null && (
                  <div style={{marginTop:6, fontSize:11, color:'var(--ink-faint)', textAlign:'right'}}>
                    Custo manual cadastrado: {formatBRL(Number(parent.cost_price))}
                  </div>
                )}
              </div>

              {/* Adicionar componente */}
              {canEditFicha && (
                <div className="ps-card" style={{padding:14}}>
                  <div className="ps-flabel" style={{marginBottom:8}}>Adicionar componente</div>
                  <div style={{display:'flex', gap:8, marginBottom:8}}>
                    <div style={{flex:1, position:'relative'}}>
                      <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar pão ou produto…"
                        className="ps-input"
                        style={{paddingLeft:30}}
                      />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newQty}
                      onChange={e => setNewQty(e.target.value.replace(/[^\d,.]/g, ''))}
                      placeholder="Qtd"
                      className="ps-input"
                      style={{width:80, textAlign:'right'}}
                    />
                  </div>

                  {q.length >= 2 && (
                    <div style={{maxHeight:300, overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:8}}>
                      {candidates.length === 0 ? (
                        <div style={{padding:14, textAlign:'center', color:'var(--ink-faint)', fontSize:13}}>
                          Nenhum resultado. (Kits e itens já adicionados são filtrados.)
                        </div>
                      ) : candidates.map(c => (
                        <button
                          key={`${c.source}-${c.id}`}
                          onClick={() => addComponent(c.source, c.id)}
                          style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer'}}
                        >
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6}}>
                              {c.name}
                              <span className={`ps-store-chip ${c.source==='bread'?'jc':'ja'}`}>{c.source==='bread'?'PÃO':'PRODUTO'}</span>
                              {c.isFabricacao && <span className="ps-store-chip jc">FABRICAÇÃO</span>}
                            </div>
                            <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                              {c.cost ? `${formatBRL(Number(c.cost))}${c.unit?`/${c.unit}`:''}` : 'sem custo cadastrado'}
                            </div>
                          </div>
                          <Plus size={14} style={{color:'var(--honey-deep)'}}/>
                        </button>
                      ))}
                    </div>
                  )}

                  {q.length > 0 && q.length < 2 && (
                    <div style={{padding:10, fontSize:12, color:'var(--ink-faint)'}}>Digite ao menos 2 caracteres…</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ComposicaoPage() {
  return (
    <Suspense fallback={
      <div className="ps-canvas"><div className="ps-shell"><div style={{padding:24, color:'var(--ink-faint)'}}>Carregando…</div></div></div>
    }>
      <ComposicaoInner/>
    </Suspense>
  )
}
