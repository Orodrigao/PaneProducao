'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, Plus, Copy, Trash2, Save, AlertTriangle, RotateCw, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface PriceTier { id:string; name:string; description:string|null; active:boolean }
interface TierItem {
  id:string; tier_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}
interface Customer { id:string; name:string; default_tier_id:string|null; discount_pct:number; active:boolean }
interface Override {
  id:string; customer_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}
interface CatalogItem { id:string; name:string; unit:string|null; _source:'bread'|'product' }
type CatalogRow = { id:string; name:string; unit:string|null }
type DbError = { code?: string; message?: string }

const DUPLICATE_TIER_MESSAGE = 'Já existe uma tabela de preço com esse nome. Verifique se ela está oculta, inativa ou já cadastrada.'

function normalizeTierName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isDuplicatePriceTierError(error: DbError | null | undefined) {
  const msg = error?.message ?? ''
  return error?.code === '23505' || msg.includes('price_tiers_name_key')
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export default function TabelasPrecoPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [tab, setTab]   = useState<'tabelas'|'precos'>('tabelas')

  // Tabelas
  const [tiers, setTiers]       = useState<PriceTier[]>([])
  const [items, setItems]       = useState<TierItem[]>([])
  const [selTierId, setSelTierId] = useState<string|null>(null)
  const [newTierOpen, setNewTierOpen] = useState(false)
  const [newTierName, setNewTierName] = useState('')
  const [newTierDesc, setNewTierDesc] = useState('')

  // Edição de item / busca
  const [search, setSearch]     = useState('')
  const [catalog, setCatalog]   = useState<CatalogItem[]>([])

  // Aba preços por cliente
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selCustId, setSelCustId] = useState<string|null>(null)
  const [overrides, setOverrides] = useState<Override[]>([])

  // Loading
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string|null>(null)

  // Drafts dos inputs nome/descrição
  const [tierNameDraft, setTierNameDraft] = useState('')
  const [tierDescDraft, setTierDescDraft] = useState('')

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [tRes, iRes, cRes, oRes, bRes, pRes] = await Promise.all([
        supabase.from('price_tiers').select('*').order('name'),
        supabase.from('price_tier_items').select('*').eq('active', true),
        supabase.from('customers').select('id,name,default_tier_id,discount_pct,active').eq('active',true).order('name'),
        supabase.from('customer_price_overrides').select('*').eq('active', true),
        supabase.from('breads').select('id,name,unit').eq('active', true),
        supabase.from('products').select('id,name,unit').eq('active', true).neq('category', 'INSUMOS'),
      ])
      const firstErr = [tRes, iRes, cRes, oRes, bRes, pRes].find(r => r.error)?.error
      if (firstErr) throw firstErr
      setTiers((tRes.data || []) as PriceTier[])
      setItems((iRes.data || []) as TierItem[])
      setCustomers((cRes.data || []) as Customer[])
      setOverrides((oRes.data || []) as Override[])
      const breads:   CatalogItem[] = ((bRes.data || []) as CatalogRow[]).map(b => ({ id:b.id, name:b.name, unit:b.unit, _source:'bread' }))
      const prods:    CatalogItem[] = ((pRes.data || []) as CatalogRow[]).map(p => ({ id:p.id, name:p.name, unit:p.unit, _source:'product' }))
      setCatalog([...breads, ...prods].sort((a,b) => a.name.localeCompare(b.name)))
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Falha ao carregar os dados.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // ========== TABELAS ==========
  const selTier = tiers.find(t => t.id === selTierId) || null
  const activeTiers = useMemo(() => tiers.filter(t => t.active), [tiers])
  const inactiveTiers = useMemo(() => tiers.filter(t => !t.active), [tiers])
  const findTierByNormalizedName = useCallback((name: string, ignoreId?: string) => {
    const normalized = normalizeTierName(name)
    return tiers.find(t => t.id !== ignoreId && normalizeTierName(t.name) === normalized) || null
  }, [tiers])

  useEffect(() => {
    if (selTier) {
      setTierNameDraft(selTier.name)
      setTierDescDraft(selTier.description ?? '')
    }
  }, [selTier?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const commitTierName = () => {
    if (!selTier) return
    const v = tierNameDraft.trim().replace(/\s+/g, ' ')
    if (!v) { setTierNameDraft(selTier.name); showToast('Nome obrigatório'); return }
    if (v === selTier.name) return
    const existing = findTierByNormalizedName(v, selTier.id)
    if (existing) {
      setTierNameDraft(selTier.name)
      showToast(DUPLICATE_TIER_MESSAGE, 4800)
      return
    }
    updateTier({ name: v })
  }

  const commitTierDesc = () => {
    if (!selTier) return
    const v = tierDescDraft.trim()
    const cur = selTier.description ?? ''
    if (v === cur) return
    updateTier({ description: v || null })
  }
  const itemsOfSel = useMemo(() => items.filter(i => i.tier_id === selTierId).sort((a,b) => a.product_name.localeCompare(b.product_name)), [items, selTierId])
  const itemsKeySet = useMemo(() => new Set(itemsOfSel.map(i => `${i.product_source}_${i.product_id}`)), [itemsOfSel])

  const createTier = async () => {
    const name = newTierName.trim().replace(/\s+/g, ' ')
    const description = newTierDesc.trim()
    setNewTierName(name)
    setNewTierDesc(description)
    if (!name) { showToast('Nome obrigatório'); return }
    const existing = findTierByNormalizedName(name)
    if (existing) {
      showToast(DUPLICATE_TIER_MESSAGE, 4800)
      if (!existing.active && confirm(`Já existe uma tabela inativa chamada "${existing.name}". Abrir essa tabela para revisar ou reativar?`)) {
        setNewTierOpen(false)
        setNewTierName('')
        setNewTierDesc('')
        setSelTierId(existing.id)
      }
      return
    }
    const { data, error } = await supabase.from('price_tiers').insert({
      name,
      description: description || null,
    }).select().single()
    if (error) {
      console.error('Erro ao criar tabela de preço:', error)
      showToast(isDuplicatePriceTierError(error) ? DUPLICATE_TIER_MESSAGE : 'Erro ao criar tabela de preço. Tente novamente.', 4800)
      return
    }
    showToast('✅ Tabela criada')
    setNewTierName(''); setNewTierDesc(''); setNewTierOpen(false)
    await loadAll()
    if (data) setSelTierId(data.id)
  }

  const updateTier = async (patch: Partial<PriceTier>) => {
    if (!selTierId) return
    const { error } = await supabase.from('price_tiers').update(patch).eq('id', selTierId)
    if (error) {
      console.error('Erro ao atualizar tabela de preço:', error)
      showToast(isDuplicatePriceTierError(error) ? DUPLICATE_TIER_MESSAGE : 'Erro ao atualizar tabela de preço. Tente novamente.', 4800)
      return
    }
    showToast('✅ Tabela atualizada')
    loadAll()
  }

  const deleteTier = async () => {
    if (!selTier) return
    const itemsCount = items.filter(i => i.tier_id === selTier.id).length
    const usingThis = customers.filter(c => c.default_tier_id === selTier.id)
    const lines = [`Excluir tabela "${selTier.name}"?`, '']
    if (itemsCount > 0) lines.push(`• ${itemsCount} produto(s) configurado(s) ficam preservados.`)
    if (usingThis.length > 0) {
      const names = usingThis.slice(0,3).map(c=>c.name).join(', ') + (usingThis.length > 3 ? '...' : '')
      lines.push(`⚠️ ${usingThis.length} cliente(s) usam essa tabela como padrão: ${names}`)
      lines.push('Eles ficarão sem tabela default — ajuste em /clientes.')
    }
    lines.push('', '(Soft delete: a tabela fica desativada, histórico preservado.)')
    if (!confirm(lines.join('\n'))) return
    const { error } = await supabase.from('price_tiers').update({ active: false }).eq('id', selTier.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('✅ Tabela excluída')
    setSelTierId(null)
    await loadAll()
  }

  const duplicateTier = async () => {
    if (!selTier) return
    const newName = prompt(`Copiar "${selTier.name}" como:`, `${selTier.name} (cópia)`)
    const name = newName?.trim().replace(/\s+/g, ' ')
    if (!name) return
    const existing = findTierByNormalizedName(name)
    if (existing) {
      showToast(DUPLICATE_TIER_MESSAGE, 4800)
      if (!existing.active && confirm(`Já existe uma tabela inativa chamada "${existing.name}". Abrir essa tabela para revisar ou reativar?`)) {
        setSelTierId(existing.id)
      }
      return
    }
    const { data: newT, error: e1 } = await supabase.from('price_tiers').insert({
      name,
      description: selTier.description,
    }).select().single()
    if (e1 || !newT) {
      console.error('Erro ao copiar tabela de preço:', e1)
      showToast(isDuplicatePriceTierError(e1) ? DUPLICATE_TIER_MESSAGE : 'Erro ao copiar tabela de preço. Tente novamente.', 4800)
      return
    }
    if (itemsOfSel.length > 0) {
      const rows = itemsOfSel.map(i => ({
        tier_id: newT.id, product_id: i.product_id, product_source: i.product_source,
        product_name: i.product_name, unit_price: i.unit_price,
        pricing_unit: i.pricing_unit, pack_size: i.pack_size, active: true,
      }))
      const { error: e2 } = await supabase.from('price_tier_items').insert(rows)
      if (e2) { showToast('Tabela criada, mas erro nos itens: ' + e2.message); return }
    }
    showToast(`✅ Cópia "${name}" criada`)
    await loadAll()
    setSelTierId(newT.id)
  }

  const addItem = async (p: CatalogItem) => {
    if (!selTierId) return
    if (itemsKeySet.has(`${p._source}_${p.id}`)) { showToast('Já existe nessa tabela'); return }
    const { error } = await supabase.from('price_tier_items').insert({
      tier_id: selTierId,
      product_id: p.id,
      product_source: p._source,
      product_name: p.name,
      unit_price: 0,
      pricing_unit: 'un',
      pack_size: 1,
      active: true,
    })
    if (error) { showToast('Erro: ' + error.message); return }
    setSearch('')
    loadAll()
  }

  const updateItem = async (it: TierItem, patch: Partial<TierItem>) => {
    const { error } = await supabase.from('price_tier_items').update(patch).eq('id', it.id)
    if (error) { showToast('Erro: ' + error.message); return }
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x))
  }

  const removeItem = async (it: TierItem) => {
    if (!confirm(`Remover "${it.product_name}" desta tabela?`)) return
    const { error } = await supabase.from('price_tier_items').update({ active: false }).eq('id', it.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('Removido')
    loadAll()
  }

  // ========== PREÇOS POR CLIENTE ==========
  const selCust = customers.find(c => c.id === selCustId) || null
  const custTier = selCust && tiers.find(t => t.id === selCust.default_tier_id) || null
  const custTierItems = useMemo(() => custTier ? items.filter(i => i.tier_id === custTier.id) : [], [items, custTier])
  const custOverrides = useMemo(() => selCustId ? overrides.filter(o => o.customer_id === selCustId) : [], [overrides, selCustId])
  const custOverrideMap = useMemo(() => {
    const m = new Map<string, Override>()
    custOverrides.forEach(o => m.set(`${o.product_source}_${o.product_id}`, o))
    return m
  }, [custOverrides])

  const custRows = useMemo(() => {
    if (!selCust) return []
    const seen = new Set<string>()
    const rows: Array<{ key:string; product_id:string; product_source:'bread'|'product'; product_name:string;
                        tier?: TierItem; override?: Override }> = []
    custTierItems.forEach(t => {
      const key = `${t.product_source}_${t.product_id}`
      seen.add(key)
      rows.push({ key, product_id:t.product_id, product_source:t.product_source, product_name:t.product_name,
                  tier:t, override: custOverrideMap.get(key) })
    })
    custOverrides.forEach(o => {
      const key = `${o.product_source}_${o.product_id}`
      if (!seen.has(key)) rows.push({ key, product_id:o.product_id, product_source:o.product_source, product_name:o.product_name, override:o })
    })
    return rows.sort((a,b) => a.product_name.localeCompare(b.product_name))
  }, [selCust, custTierItems, custOverrides, custOverrideMap])

  const computeFinalPrice = (tier?: TierItem, override?: Override, discountPct = 0) => {
    if (override) return { price: override.unit_price, unit: override.pricing_unit, pack: override.pack_size, source: 'override' as const }
    if (tier) {
      const finalPrice = tier.unit_price * (1 - (discountPct || 0) / 100)
      return { price: finalPrice, unit: tier.pricing_unit, pack: tier.pack_size, source: 'tier' as const }
    }
    return null
  }

  const createOverride = async (row: typeof custRows[number]) => {
    if (!selCustId) return
    const basePrice = row.tier?.unit_price ?? 0
    const { error } = await supabase.from('customer_price_overrides').insert({
      customer_id: selCustId,
      product_id: row.product_id,
      product_source: row.product_source,
      product_name: row.product_name,
      unit_price: basePrice,
      pricing_unit: row.tier?.pricing_unit || 'un',
      pack_size: row.tier?.pack_size || 1,
      active: true,
    })
    if (error) { showToast('Erro: ' + error.message); return }
    loadAll()
  }

  const updateOverride = async (o: Override, patch: Partial<Override>) => {
    const { error } = await supabase.from('customer_price_overrides').update(patch).eq('id', o.id)
    if (error) { showToast('Erro: ' + error.message); return }
    setOverrides(prev => prev.map(x => x.id === o.id ? { ...x, ...patch } : x))
  }

  const removeOverride = async (o: Override) => {
    if (!confirm(`Remover override de "${o.product_name}"? (volta a usar o preço da tabela)`)) return
    const { error } = await supabase.from('customer_price_overrides').update({ active: false }).eq('id', o.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('Override removido')
    loadAll()
  }

  // ========== UI ==========
  const filteredCatalog = useMemo(() => {
    if (search.trim().length < 2) return []
    const norm = (s:string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const q = norm(search)
    return catalog
      .filter(c => !itemsKeySet.has(`${c._source}_${c.id}`) && norm(c.name).includes(q))
      .sort((a, b) => {
        // nomes que começam com o termo digitado aparecem primeiro
        const aS = norm(a.name).startsWith(q) ? 0 : 1
        const bS = norm(b.name).startsWith(q) ? 0 : 1
        return aS - bS || a.name.localeCompare(b.name)
      })
      .slice(0, 30)
  }, [catalog, search, itemsKeySet])

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Tabelas de Preço</b>
              <span>Catálogo &amp; clientes</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-pad" style={{marginTop:14}}>
          <div className="ps-tabs" role="tablist">
            {(['tabelas','precos'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab===t} onClick={()=>{ setTab(t); setSelTierId(null); setSelCustId(null) }} className="ps-tab">
                {t==='tabelas' ? '📋 Tabelas' : '👤 Preços por cliente'}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : loadError ? (
            <div className="ps-empty">
              <AlertTriangle size={36} style={{display:'block', margin:'0 auto 8px', color:'var(--berry)', opacity:.6}}/>
              <div style={{color:'var(--berry)', fontSize:14, fontWeight:600, marginBottom:8}}>Não foi possível carregar os dados.</div>
              <div style={{color:'var(--ink-faint)', fontSize:12, marginBottom:14}}>{loadError}</div>
              <button onClick={()=>loadAll()} className="ps-btn primary">
                <RotateCw size={14}/> Tentar de novo
              </button>
            </div>
          ) : tab === 'tabelas' ? (
            selTier ? (
              // ===== EDITOR DE TABELA =====
              <>
                <button onClick={()=>setSelTierId(null)} className="ps-backlink" style={{marginTop:14, marginBottom:12}}>
                  <ChevronLeft size={14}/> Voltar pra lista
                </button>

                <div className="ps-card" style={{gap:10}}>
                  <input value={tierNameDraft}
                    onChange={e=>setTierNameDraft(e.target.value)}
                    onBlur={commitTierName}
                    onKeyDown={e=>{ if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="ps-input"
                    style={{fontWeight:700, fontSize:16, fontFamily:'var(--font-display)'}}/>
                  <input value={tierDescDraft}
                    onChange={e=>setTierDescDraft(e.target.value)}
                    onBlur={commitTierDesc}
                    onKeyDown={e=>{ if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    placeholder="Descrição (opcional)" className="ps-input"/>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
                    <button onClick={duplicateTier} className="ps-btn ghost sm">
                      <Copy size={12}/> Copiar tabela
                    </button>
                    <button onClick={deleteTier} className="ps-btn danger sm">
                      <Trash2 size={12}/> Excluir
                    </button>
                    <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, color:'var(--ink-soft)', cursor:'pointer', marginLeft:'auto'}}>
                      <input type="checkbox" checked={selTier.active} onChange={e=>updateTier({active:e.target.checked})}/>
                      Ativa
                    </label>
                  </div>
                </div>

                <div className="ps-card" style={{marginTop:12, position:'relative', overflow:'visible'}}>
                  <div className="ps-flabel">+ Adicionar produto</div>
                  <input placeholder="Buscar pão ou produto..." value={search} onChange={e=>setSearch(e.target.value)} className="ps-input"/>
                  {filteredCatalog.length > 0 && (
                    <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:240, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                      {filteredCatalog.map(p => (
                        <div key={`${p._source}_${p.id}`} onClick={()=>addItem(p)}
                          style={{padding:'10px 12px', cursor:'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', fontFamily:'var(--font-ui)'}}>
                          {p.name}
                          {p._source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖 PÃO</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {itemsOfSel.length === 0 ? (
                  <div className="ps-empty">Nenhum produto nesta tabela ainda. Use o campo acima pra adicionar.</div>
                ) : (
                  <div className="ps-table-wrap" style={{marginTop:14, overflowX:'auto'}}>
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="right">Preço</th>
                          <th>Un.</th>
                          <th>Pack</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsOfSel.map(it => (
                          <tr key={it.id}>
                            <td>
                              {it.product_name}
                              {it.product_source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖</span>}
                            </td>
                            <td className="right">
                              <input type="number" step={0.01} min={0} value={it.unit_price}
                                onChange={e=>updateItem(it, { unit_price: Number(e.target.value) || 0 })}
                                className="ps-input" style={{width:90, padding:'4px 8px', fontSize:13, textAlign:'right'}}/>
                            </td>
                            <td>
                              <select value={it.pricing_unit} onChange={e=>updateItem(it, { pricing_unit: e.target.value as 'un'|'kg' })}
                                className="ps-select" style={{padding:'4px 6px', fontSize:13, width:60}}>
                                <option value="un">un</option><option value="kg">kg</option>
                              </select>
                            </td>
                            <td>
                              <input type="number" min={1} step={1} value={it.pack_size}
                                onChange={e=>updateItem(it, { pack_size: Math.max(1, Number(e.target.value) || 1) })}
                                className="ps-input" style={{width:60, padding:'4px 8px', fontSize:13, textAlign:'center'}}/>
                            </td>
                            <td>
                              <button onClick={()=>removeItem(it)} title="Remover" className="ps-iconbtn" style={{width:28, height:28, color:'var(--berry)'}}>
                                <Trash2 size={14}/>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              // ===== LISTA DE TABELAS =====
              <>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, marginBottom:14, gap:8, flexWrap:'wrap'}}>
                  <span style={{fontSize:13, color:'var(--ink-soft)'}}>
                    {activeTiers.length} tabela(s) ativa(s)
                    {inactiveTiers.length > 0 && ` · ${inactiveTiers.length} inativa(s)`}
                  </span>
                  <button onClick={()=>setNewTierOpen(true)} className="ps-btn primary">
                    <Plus size={14}/> Nova tabela
                  </button>
                </div>
                {activeTiers.length === 0 ? (
                  <div className="ps-empty">
                    Nenhuma tabela cadastrada. Comece criando a primeira (ex: &quot;Atacado A&quot;, &quot;Eventos&quot;).
                  </div>
                ) : (
                  <div style={{display:'grid', gap:10}}>
                    {activeTiers.map(t => {
                      const count = items.filter(i => i.tier_id === t.id).length
                      return (
                        <div key={t.id} onClick={()=>setSelTierId(t.id)} className="ps-card" style={{borderLeft:`4px solid ${t.active ? 'var(--crust)' : 'var(--ps-line)'}`, cursor:'pointer', opacity:t.active?1:0.6}}>
                          <div className="ps-pname">{t.name}</div>
                          {t.description && <div style={{fontSize:13, color:'var(--ink-soft)'}}>{t.description}</div>}
                          <div style={{fontSize:12, color:'var(--ink-faint)'}}>{count} produto(s)</div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {inactiveTiers.length > 0 && (
                  <div style={{marginTop:18}}>
                    <div style={{fontSize:12, fontWeight:700, color:'var(--ink-soft)', marginBottom:8}}>
                      Inativas / ocultas
                    </div>
                    <div style={{display:'grid', gap:10}}>
                      {inactiveTiers.map(t => {
                        const count = items.filter(i => i.tier_id === t.id).length
                        return (
                          <div key={t.id} onClick={()=>setSelTierId(t.id)} className="ps-card" style={{borderLeft:'4px solid var(--ps-line)', cursor:'pointer', opacity:0.72}}>
                            <div className="ps-pname">
                              {t.name}
                              <span className="ps-store-chip" style={{marginLeft:8}}>inativa</span>
                            </div>
                            {t.description && <div style={{fontSize:13, color:'var(--ink-soft)'}}>{t.description}</div>}
                            <div style={{fontSize:12, color:'var(--ink-faint)'}}>{count} produto(s) · clique para revisar ou reativar</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          ) : (
            // ===== ABA PREÇOS POR CLIENTE =====
            <>
              <div className="ps-fieldgroup" style={{marginTop:14, marginBottom:14}}>
                <div className="ps-fieldlabel">Cliente</div>
                <select value={selCustId || ''} onChange={e=>setSelCustId(e.target.value || null)} className="ps-select">
                  <option value="">— selecionar cliente —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {!selCust ? (
                <div className="ps-empty">Selecione um cliente pra ver/editar os preços efetivos.</div>
              ) : !custTier ? (
                <div className="ps-warning">
                  <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
                  <span>Cliente sem tabela default. Edite o cliente em <strong>/clientes</strong> e atribua uma tabela.</span>
                </div>
              ) : (
                <>
                  <div className="ps-banner honey" style={{marginBottom:14}}>
                    <span>
                      Tabela: <b>{custTier.name}</b>
                      {selCust.discount_pct > 0 && (
                        <span className="ps-store-chip ja" style={{marginLeft:10}}>
                          -{selCust.discount_pct}% global
                        </span>
                      )}
                    </span>
                  </div>

                  {custRows.length === 0 ? (
                    <div className="ps-empty">
                      A tabela <strong>{custTier.name}</strong> ainda não tem produtos. Cadastre na aba Tabelas.
                    </div>
                  ) : (
                    <div className="ps-table-wrap" style={{overflowX:'auto'}}>
                      <table className="ps-table">
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th className="right">Tabela</th>
                            <th className="right">Final</th>
                            <th className="right">Override</th>
                            <th>Un./Pack</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {custRows.map(r => {
                            const finalP = computeFinalPrice(r.tier, r.override, selCust.discount_pct)
                            const isOverride = !!r.override
                            return (
                              <tr key={r.key} style={{background: isOverride ? 'var(--honey-tint)' : undefined}}>
                                <td>
                                  {r.product_name}
                                  {r.product_source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖</span>}
                                </td>
                                <td className="right" style={{color:'var(--ink-faint)', fontSize:12}}>
                                  {r.tier ? `R$ ${r.tier.unit_price.toFixed(2)}` : '—'}
                                </td>
                                <td className="right" style={{fontWeight:700, color:isOverride?'var(--honey-deep)':'var(--ps-ink)', fontVariantNumeric:'tabular-nums'}}>
                                  {finalP ? `R$ ${finalP.price.toFixed(2)}` : '—'}
                                </td>
                                <td className="right">
                                  {r.override ? (
                                    <input type="number" step={0.01} min={0} value={r.override.unit_price}
                                      onChange={e=>updateOverride(r.override!, { unit_price: Number(e.target.value) || 0 })}
                                      className="ps-input" style={{width:80, padding:'4px 8px', fontSize:13, textAlign:'right', borderColor:'var(--honey-deep)', background:'var(--honey-tint)'}}/>
                                  ) : (
                                    <button onClick={()=>createOverride(r)} className="ps-btn ghost sm">
                                      <Plus size={10}/> override
                                    </button>
                                  )}
                                </td>
                                <td style={{fontSize:12, color:'var(--ink-faint)'}}>
                                  {finalP ? `${finalP.unit}/${finalP.pack}` : '—'}
                                </td>
                                <td>
                                  {r.override && (
                                    <button onClick={()=>removeOverride(r.override!)} title="Remover override" className="ps-iconbtn" style={{width:26, height:26, color:'var(--berry)'}}>
                                      <X size={12}/>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal: nova tabela */}
      {newTierOpen && (
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&setNewTierOpen(false)}>
          <div className="ps-sheet confirm" style={{maxWidth:420, borderRadius:'var(--r-card)'}}>
            <h3>+ Nova tabela de preço</h3>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Nome *</div>
              <input value={newTierName} onChange={e=>setNewTierName(e.target.value)} placeholder="ex: Atacado A, Eventos, Distribuidor" autoFocus className="ps-input"/>
            </div>
            <div className="ps-fieldgroup" style={{marginBottom:14}}>
              <div className="ps-fieldlabel">Descrição (opcional)</div>
              <input value={newTierDesc} onChange={e=>setNewTierDesc(e.target.value)} placeholder="Notas internas" className="ps-input"/>
            </div>

            <div className="actions">
              <button onClick={createTier} className="ps-btn primary">
                <Save size={14}/> Criar
              </button>
              <button onClick={()=>setNewTierOpen(false)} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
