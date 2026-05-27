'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
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

export default function TabelasPrecoPage() {
  const [user, setUser] = useState<{displayName:string}|null>(null)
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

  // Drafts dos inputs nome/descrição da tabela — salvam onBlur/Enter,
  // não a cada keystroke (evita PATCH + toast por tecla).
  const [tierNameDraft, setTierNameDraft] = useState('')
  const [tierDescDraft, setTierDescDraft] = useState('')

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName })
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [tRes, iRes, cRes, oRes, bRes, pRes] = await Promise.all([
      supabase.from('price_tiers').select('*').order('name'),
      supabase.from('price_tier_items').select('*').eq('active', true),
      supabase.from('customers').select('id,name,default_tier_id,discount_pct,active').eq('active',true).order('name'),
      supabase.from('customer_price_overrides').select('*').eq('active', true),
      supabase.from('breads').select('id,name,unit').eq('active', true),
      supabase.from('products').select('id,name,unit').eq('active', true).neq('category', 'INSUMOS'),
    ])
    setTiers((tRes.data || []) as PriceTier[])
    setItems((iRes.data || []) as TierItem[])
    setCustomers((cRes.data || []) as Customer[])
    setOverrides((oRes.data || []) as Override[])
    const breads:   CatalogItem[] = (bRes.data || []).map((b:any) => ({ id:b.id, name:b.name, unit:b.unit, _source:'bread' }))
    const prods:    CatalogItem[] = (pRes.data || []).map((p:any) => ({ id:p.id, name:p.name, unit:p.unit, _source:'product' }))
    setCatalog([...breads, ...prods].sort((a,b) => a.name.localeCompare(b.name)))
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // ========== TABELAS ==========

  const selTier = tiers.find(t => t.id === selTierId) || null

  // Sincroniza drafts quando troca a tabela selecionada
  useEffect(() => {
    if (selTier) {
      setTierNameDraft(selTier.name)
      setTierDescDraft(selTier.description ?? '')
    }
  }, [selTier?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const commitTierName = () => {
    if (!selTier) return
    const v = tierNameDraft.trim()
    if (!v) { setTierNameDraft(selTier.name); showToast('Nome obrigatório'); return }
    if (v === selTier.name) return
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
    if (!newTierName.trim()) { showToast('Nome obrigatório'); return }
    const { data, error } = await supabase.from('price_tiers').insert({
      name: newTierName.trim(),
      description: newTierDesc.trim() || null,
    }).select().single()
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('✅ Tabela criada')
    setNewTierName(''); setNewTierDesc(''); setNewTierOpen(false)
    await loadAll()
    if (data) setSelTierId(data.id)
  }

  const updateTier = async (patch: Partial<PriceTier>) => {
    if (!selTierId) return
    const { error } = await supabase.from('price_tiers').update(patch).eq('id', selTierId)
    if (error) { showToast('Erro: ' + error.message); return }
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
    if (!newName?.trim()) return
    const { data: newT, error: e1 } = await supabase.from('price_tiers').insert({
      name: newName.trim(),
      description: selTier.description,
    }).select().single()
    if (e1 || !newT) { showToast('Erro: ' + (e1?.message||'?')); return }
    // Copia itens
    if (itemsOfSel.length > 0) {
      const rows = itemsOfSel.map(i => ({
        tier_id: newT.id, product_id: i.product_id, product_source: i.product_source,
        product_name: i.product_name, unit_price: i.unit_price,
        pricing_unit: i.pricing_unit, pack_size: i.pack_size, active: true,
      }))
      const { error: e2 } = await supabase.from('price_tier_items').insert(rows)
      if (e2) { showToast('Tabela criada, mas erro nos itens: ' + e2.message); return }
    }
    showToast(`✅ Cópia "${newName}" criada`)
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
    // Otimismo: atualiza local sem reload
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

  // Linhas exibidas: união de items do tier + overrides do cliente (override pode existir mesmo sem item no tier)
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
    const q = search.toLowerCase()
    return catalog.filter(c => !itemsKeySet.has(`${c._source}_${c.id}`) && c.name.toLowerCase().includes(q)).slice(0, 15)
  }, [catalog, search, itemsKeySet])

  return (
    <div style={{maxWidth:900,margin:'0 auto'}}>
      <div style={{padding:'14px 16px',background:'var(--primary)',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <span style={{fontWeight:700}}>📋 Tabelas de Preço</span>
        {user && <span style={{fontSize:'.78rem',opacity:.85}}>{user.displayName}</span>}
      </div>

      <div style={{display:'flex',borderBottom:'2px solid var(--border)'}}>
        {(['tabelas','precos'] as const).map(t => (
          <button key={t} onClick={()=>{ setTab(t); setSelTierId(null); setSelCustId(null) }}
            style={{flex:1,padding:'10px',border:'none',background:'none',cursor:'pointer',
              fontWeight:tab===t?700:400,color:tab===t?'var(--primary)':'var(--muted)',
              borderBottom:tab===t?'2px solid var(--primary)':'2px solid transparent',marginBottom:-2,fontSize:'.88rem'}}>
            {t==='tabelas' ? '📋 Tabelas' : '👤 Preços por cliente'}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
        ) : tab === 'tabelas' ? (
          selTier ? (
            // ===== EDITOR DE TABELA =====
            <>
              <button onClick={()=>setSelTierId(null)}
                style={{background:'none',border:'none',color:'var(--primary)',cursor:'pointer',fontSize:'.88rem',padding:0,marginBottom:12,fontWeight:600}}>
                ← Voltar pra lista
              </button>

              <div className="card" style={{marginBottom:14}}>
                <input value={tierNameDraft}
                  onChange={e=>setTierNameDraft(e.target.value)}
                  onBlur={commitTierName}
                  onKeyDown={e=>{ if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{width:'100%',padding:'8px 10px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'1rem',fontWeight:700,marginBottom:8}}/>
                <input value={tierDescDraft}
                  onChange={e=>setTierDescDraft(e.target.value)}
                  onBlur={commitTierDesc}
                  onKeyDown={e=>{ if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  placeholder="Descrição (opcional)"
                  style={{width:'100%',padding:'8px 10px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.85rem',marginBottom:10}}/>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <button onClick={duplicateTier}
                    style={{padding:'6px 12px',background:'#f3f4f6',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:'.8rem',fontWeight:600}}>
                    📋 Copiar tabela
                  </button>
                  <button onClick={deleteTier}
                    style={{padding:'6px 12px',background:'#fee2e2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:6,cursor:'pointer',fontSize:'.8rem',fontWeight:600}}>
                    🗑 Excluir tabela
                  </button>
                  <label style={{display:'flex',alignItems:'center',gap:6,fontSize:'.82rem',color:'var(--muted)',cursor:'pointer',marginLeft:'auto'}}>
                    <input type="checkbox" checked={selTier.active} onChange={e=>updateTier({active:e.target.checked})}/>
                    Tabela ativa
                  </label>
                </div>
              </div>

              <div className="card" style={{marginBottom:14,position:'relative'}}>
                <div className="card-title">+ Adicionar produto</div>
                <input placeholder="Buscar pão ou produto..." value={search} onChange={e=>setSearch(e.target.value)}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                {filteredCatalog.length > 0 && (
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:240,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}>
                    {filteredCatalog.map(p => (
                      <div key={`${p._source}_${p.id}`} onClick={()=>addItem(p)}
                        style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>
                        {p.name}
                        {p._source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>🥖 PÃO</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {itemsOfSel.length === 0 ? (
                <div style={{padding:30,textAlign:'center',color:'var(--muted)',background:'white',borderRadius:10,border:'1px solid var(--border)'}}>
                  Nenhum produto nesta tabela ainda. Use o campo acima pra adicionar.
                </div>
              ) : (
                <div style={{background:'white',borderRadius:10,border:'1px solid var(--border)',overflow:'hidden'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 90px 60px 70px 32px',gap:6,padding:'8px 10px',background:'#f9fafb',fontSize:'.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                    <span>Produto</span><span style={{textAlign:'right'}}>Preço</span><span>Un.</span><span>Pack</span><span></span>
                  </div>
                  {itemsOfSel.map(it => (
                    <div key={it.id} style={{display:'grid',gridTemplateColumns:'1fr 90px 60px 70px 32px',gap:6,padding:'8px 10px',borderBottom:'1px solid #f0f0f0',alignItems:'center',fontSize:'.88rem'}}>
                      <span>
                        {it.product_name}
                        {it.product_source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖</span>}
                      </span>
                      <input type="number" step={0.01} min={0} value={it.unit_price}
                        onChange={e=>updateItem(it, { unit_price: Number(e.target.value) || 0 })}
                        style={{padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'right'}}/>
                      <select value={it.pricing_unit} onChange={e=>updateItem(it, { pricing_unit: e.target.value as 'un'|'kg' })}
                        style={{padding:'4px 4px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.8rem'}}>
                        <option value="un">un</option><option value="kg">kg</option>
                      </select>
                      <input type="number" min={1} step={1} value={it.pack_size}
                        onChange={e=>updateItem(it, { pack_size: Math.max(1, Number(e.target.value) || 1) })}
                        style={{padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'center'}}/>
                      <button onClick={()=>removeItem(it)} title="Remover"
                        style={{background:'none',border:'none',cursor:'pointer',padding:0,fontSize:'1rem',color:'#dc2626'}}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            // ===== LISTA DE TABELAS =====
            <>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,gap:8,flexWrap:'wrap'}}>
                <span style={{fontSize:'.85rem',color:'var(--muted)'}}>
                  {tiers.filter(t=>t.active).length} tabela(s) cadastrada(s)
                </span>
                <button onClick={()=>setNewTierOpen(true)}
                  style={{padding:'8px 14px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.85rem',fontWeight:700}}>
                  + Nova tabela
                </button>
              </div>
              {tiers.filter(t=>t.active).length === 0 ? (
                <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>
                  Nenhuma tabela cadastrada. Comece criando a primeira (ex: "Atacado A", "Eventos").
                </div>
              ) : (
                <div style={{display:'grid',gap:10}}>
                  {tiers.filter(t=>t.active).map(t => {
                    const count = items.filter(i => i.tier_id === t.id).length
                    return (
                      <div key={t.id} onClick={()=>setSelTierId(t.id)}
                        style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--border)',
                          borderLeft:`4px solid ${t.active ? 'var(--primary)' : '#9ca3af'}`,cursor:'pointer',opacity:t.active?1:.6}}>
                        <div style={{fontWeight:700,fontSize:'.95rem'}}>
                          {t.name}
                          {!t.active && <span style={{marginLeft:8,fontSize:'.7rem',color:'#9ca3af'}}>(inativa)</span>}
                        </div>
                        {t.description && <div style={{fontSize:'.8rem',color:'var(--muted)',marginTop:2}}>{t.description}</div>}
                        <div style={{fontSize:'.75rem',color:'var(--muted)',marginTop:6}}>
                          {count} produto(s)
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )
        ) : (
          // ===== ABA PREÇOS POR CLIENTE =====
          <>
            <label style={{display:'block',fontSize:'.8rem',color:'var(--muted)',marginBottom:6,fontWeight:600}}>Cliente</label>
            <select value={selCustId || ''} onChange={e=>setSelCustId(e.target.value || null)}
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',background:'white',marginBottom:14}}>
              <option value="">— selecionar cliente —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {!selCust ? (
              <div style={{padding:30,textAlign:'center',color:'var(--muted)'}}>
                Selecione um cliente pra ver/editar os preços efetivos.
              </div>
            ) : !custTier ? (
              <div style={{padding:20,background:'#fef3c7',color:'#92400e',borderRadius:8,fontSize:'.88rem'}}>
                ⚠️ Cliente sem tabela default. Edite o cliente em <strong>/clientes</strong> e atribua uma tabela.
              </div>
            ) : (
              <>
                <div style={{padding:'10px 14px',background:'#eff6ff',borderRadius:8,marginBottom:14,fontSize:'.85rem'}}>
                  Tabela: <strong>{custTier.name}</strong>
                  {selCust.discount_pct > 0 && (
                    <span style={{marginLeft:10,padding:'2px 8px',background:'#dcfce7',color:'#166534',borderRadius:4,fontWeight:600,fontSize:'.8rem'}}>
                      -{selCust.discount_pct}% global
                    </span>
                  )}
                </div>

                {custRows.length === 0 ? (
                  <div style={{padding:30,textAlign:'center',color:'var(--muted)'}}>
                    A tabela <strong>{custTier.name}</strong> ainda não tem produtos. Cadastre na aba Tabelas.
                  </div>
                ) : (
                  <div style={{background:'white',borderRadius:10,border:'1px solid var(--border)',overflow:'hidden'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 80px 80px 90px 80px 32px',gap:6,padding:'8px 10px',background:'#f9fafb',fontSize:'.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                      <span>Produto</span>
                      <span style={{textAlign:'right'}}>Tabela</span>
                      <span style={{textAlign:'right'}}>Final</span>
                      <span style={{textAlign:'right'}}>Override</span>
                      <span>Un./Pack</span>
                      <span></span>
                    </div>
                    {custRows.map(r => {
                      const finalP = computeFinalPrice(r.tier, r.override, selCust.discount_pct)
                      const isOverride = !!r.override
                      return (
                        <div key={r.key} style={{display:'grid',gridTemplateColumns:'1fr 80px 80px 90px 80px 32px',gap:6,padding:'8px 10px',borderBottom:'1px solid #f0f0f0',alignItems:'center',fontSize:'.84rem',background: isOverride?'#fef9c3':'transparent'}}>
                          <span>
                            {r.product_name}
                            {r.product_source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖</span>}
                          </span>
                          <span style={{textAlign:'right',color:'var(--muted)',fontSize:'.78rem'}}>
                            {r.tier ? `R$ ${r.tier.unit_price.toFixed(2)}` : '—'}
                          </span>
                          <span style={{textAlign:'right',fontWeight:700,color: isOverride?'#92400e':'inherit'}}>
                            {finalP ? `R$ ${finalP.price.toFixed(2)}` : '—'}
                          </span>
                          {r.override ? (
                            <input type="number" step={0.01} min={0} value={r.override.unit_price}
                              onChange={e=>updateOverride(r.override!, { unit_price: Number(e.target.value) || 0 })}
                              style={{padding:'4px 6px',border:'1.5px solid #f59e0b',borderRadius:4,fontSize:'.8rem',textAlign:'right',background:'#fffbeb'}}/>
                          ) : (
                            <button onClick={()=>createOverride(r)}
                              style={{padding:'4px',background:'#f3f4f6',border:'1px dashed var(--border)',borderRadius:4,cursor:'pointer',fontSize:'.7rem',color:'var(--muted)'}}>
                              + override
                            </button>
                          )}
                          <span style={{fontSize:'.75rem',color:'var(--muted)'}}>
                            {finalP ? `${finalP.unit}/${finalP.pack}` : '—'}
                          </span>
                          {r.override && (
                            <button onClick={()=>removeOverride(r.override!)} title="Remover override"
                              style={{background:'none',border:'none',cursor:'pointer',padding:0,fontSize:'1rem',color:'#dc2626'}}>×</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Modal: nova tabela */}
      {newTierOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}
             onClick={e=>e.target===e.currentTarget&&setNewTierOpen(false)}>
          <div style={{background:'white',borderRadius:12,padding:20,maxWidth:420,width:'100%'}}>
            <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:14}}>+ Nova tabela de preço</div>
            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Nome *</label>
            <input value={newTierName} onChange={e=>setNewTierName(e.target.value)} placeholder="ex: Atacado A, Eventos, Distribuidor"
              autoFocus
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10}}/>
            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Descrição (opcional)</label>
            <input value={newTierDesc} onChange={e=>setNewTierDesc(e.target.value)} placeholder="Notas internas"
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:14}}/>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setNewTierOpen(false)}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>Cancelar</button>
              <button onClick={createTier}
                style={{padding:'10px 18px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:700}}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
