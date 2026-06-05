'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Minus, Plus, Save, Package, Trash2, Layers, X, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { todayKey, todayLabel, showToast } from '@/lib/utils'

interface Product { id: string; name: string; category: string; unit: string | null; kind: string | null; is_shelf: boolean }
interface Bread   { id: string; name: string; unit: string | null; is_shelf: boolean }

type Mode = 'sobra' | 'descarte' | 'prateleira' | null
const STORES = ['jc', 'ja', 'ex'] as const
const STORE_LABEL: Record<string, string> = { jc: 'JC — Júlio de Castilhos', ja: 'JA — Júlio de Antonio', ex: 'EX — Exposição' }

function yesterdayKey(): string {
  const d = new Date(todayKey() + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function SobrasPage() {
  const router = useRouter()
  const [user, setUser]         = useState<AppUser | null>(null)
  const [mode, setMode]         = useState<Mode>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [qtys, setQtys]         = useState<Record<string,number>>({})
  const [prevCounts, setPrevCounts] = useState<Record<string,number>>({})
  // Chaves que tinham uma row salva HOJE quando a tela carregou. Permite zerar
  // (atendente corrige "errei, na verdade não tem nenhum") mesmo quando ontem
  // não tinha valor — senão o upsert nunca atualizaria a row positiva pra 0.
  const [todayKeysWithData, setTodayKeysWithData] = useState<Set<string>>(new Set())
  // Candidatos pro botão "Incluir" no modo Prateleira: produtos/pães que ainda
  // não são is_shelf. Carregados em paralelo só quando entra no modo.
  const [candidateProducts, setCandidateProducts] = useState<Product[]>([])
  const [candidateBreads, setCandidateBreads] = useState<Bread[]>([])
  const [includeOpen, setIncludeOpen] = useState(false)
  const [includeSearch, setIncludeSearch] = useState('')
  const [selectedStore, setSelectedStore] = useState<string>('jc')
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
    if (u.store && (STORES as readonly string[]).includes(u.store)) setSelectedStore(u.store)
  }, [router])

  const loadData = useCallback(async () => {
    if (!user) return

    // Catálogo: products e breads. Pra sobra/descarte mantém comportamento antigo
    // (orders do dia filtra pães vendidos). Pra prateleira NÃO filtra por orders
    // — todo shelf da loja precisa aparecer.
    const [{ data: prodsRaw }, { data: bdsRaw }, { data: orders }] = await Promise.all([
      supabase.from('products').select('id,name,category,unit,kind,is_shelf').eq('active', true).neq('category','INSUMOS').order('category').order('name'),
      supabase.from('breads').select('id,name,unit,is_shelf').eq('active', true).eq('is_pj', false).order('name'),
      mode === 'prateleira'
        ? Promise.resolve({ data: [] })
        : supabase.from('orders').select('bread_id').eq('order_date', todayKey()).gt('quantity', 0),
    ])
    const todayBreadIds = new Set((orders || []).map((o: any) => o.bread_id).filter(Boolean))

    let prods = (prodsRaw || []) as Product[]
    let bds = (bdsRaw || []) as Bread[]

    if (mode === 'sobra') {
      // Sobra = pão fresco do dia. Filtra shelf out (não tem por que lançar
      // pão de forma como sobra todo dia — ele vai pro modo Prateleira).
      prods = prods.filter(p => !p.is_shelf)
      bds = bds.filter(b => !b.is_shelf && todayBreadIds.has(b.id))
    } else if (mode === 'descarte') {
      // Descarte aceita qualquer item (fresco ou shelf — pão de forma vencido é descarte).
      // Mantém o filtro por orders só pros frescos (não-shelf) — shelf sempre aparece.
      bds = bds.filter(b => b.is_shelf || todayBreadIds.has(b.id))
    } else if (mode === 'prateleira') {
      // Lista principal: já são shelf
      const allProds = prods
      const allBds = bds
      prods = allProds.filter(p => p.is_shelf)
      bds = allBds.filter(b => b.is_shelf)
      // Candidatos pro botão "Incluir": não-shelf, pra atendente puxar pra prateleira
      // se viu algo no balcão que ninguém marcou ainda
      setCandidateProducts(allProds.filter(p => !p.is_shelf))
      setCandidateBreads(allBds.filter(b => !b.is_shelf))
    } else {
      setCandidateProducts([])
      setCandidateBreads([])
    }

    setProducts(prods)
    setBreads(bds)

    // Pré-carrega valores já salvos
    if (mode === 'prateleira') {
      const [{ data: today }, { data: prev }] = await Promise.all([
        supabase.from('shelf_counts').select('*')
          .eq('record_date', todayKey()).eq('store', selectedStore),
        supabase.from('shelf_counts').select('*')
          .eq('record_date', yesterdayKey()).eq('store', selectedStore),
      ])
      const vals: Record<string,number> = {}
      const todayKeys = new Set<string>()
      ;(today || []).forEach((r: any) => {
        const key = r.product_source === 'bread' ? 'bread_'+r.product_id : r.product_id
        vals[key] = Number(r.quantity)
        todayKeys.add(key)
      })
      const prevVals: Record<string,number> = {}
      ;(prev || []).forEach((r: any) => {
        const key = r.product_source === 'bread' ? 'bread_'+r.product_id : r.product_id
        prevVals[key] = Number(r.quantity)
      })
      setQtys(vals)
      setPrevCounts(prevVals)
      setTodayKeysWithData(todayKeys)
    } else {
      const table = mode === 'sobra' ? 'sobras' : 'descartes'
      const { data: saved } = await supabase.from(table).select('*')
        .eq('record_date', todayKey()).eq('responsible', user.displayName)
      const vals: Record<string,number> = {}
      ;(saved||[]).forEach((r: any) => {
        const key = r.product_source === 'bread' ? 'bread_'+r.product_id : r.product_id
        vals[key] = r.quantity
      })
      setQtys(vals)
      setPrevCounts({})
      setTodayKeysWithData(new Set())
    }
  }, [mode, user, selectedStore])

  useEffect(() => { if (user && mode) loadData() }, [user, mode, selectedStore, loadData])

  const setQty = (id: string, val: number) => setQtys(prev => ({ ...prev, [id]: Math.max(0, val) }))

  async function includeBread(b: Bread) {
    const { error } = await supabase.from('breads').update({ is_shelf: true }).eq('id', b.id)
    if (error) { showToast('Erro: '+error.message); return }
    setBreads(prev => [...prev, { ...b, is_shelf: true }].sort((a, c) => a.name.localeCompare(c.name)))
    setCandidateBreads(prev => prev.filter(x => x.id !== b.id))
    showToast(`📦 ${b.name} incluído na Prateleira`)
  }
  async function includeProduct(p: Product) {
    const { error } = await supabase.from('products').update({ is_shelf: true }).eq('id', p.id)
    if (error) { showToast('Erro: '+error.message); return }
    setProducts(prev => [...prev, { ...p, is_shelf: true }].sort((a, c) => (a.category+a.name).localeCompare(c.category+c.name)))
    setCandidateProducts(prev => prev.filter(x => x.id !== p.id))
    showToast(`📦 ${p.name} incluído na Prateleira`)
  }

  const save = async () => {
    if (!user) return
    const date = todayKey()
    setSaving(true)
    try {
      if (mode === 'prateleira') {
        // Snapshot do balcão. Upsert por (date, store, product_id, product_source) — re-salvar atualiza.
        // Inclui itens com qty=0 também (atendente declara "esgotou na prateleira"), exceto se
        // nunca tiveram entrada hoje E nem ontem (ruído). todayKeysWithData cobre o cenário de
        // correção no mesmo dia: salvou 5 cedo, agora corrige pra 0 — sem isso, o 5 ficaria salvo.
        const rowsToUpsert: any[] = []
        for (const [id, q] of Object.entries(qtys)) {
          const isBread = id.startsWith('bread_')
          const productId = isBread ? id.replace('bread_', '') : id
          const productSource = isBread ? 'bread' : 'product'
          const hadValueRecently = prevCounts[id] != null || todayKeysWithData.has(id)
          if (q > 0 || hadValueRecently) {
            rowsToUpsert.push({
              record_date: date,
              store: selectedStore,
              product_id: productId,
              product_source: productSource,
              quantity: q,
              counted_by: user.displayName,
            })
          }
        }
        if (rowsToUpsert.length === 0) { showToast('Nenhuma contagem pra salvar'); return }
        const { error } = await supabase
          .from('shelf_counts')
          .upsert(rowsToUpsert, { onConflict: 'record_date,store,product_id,product_source' })
        if (error) throw error
        showToast(`✅ Prateleira ${STORE_LABEL[selectedStore]?.split(' ')[0] || selectedStore} salva (${rowsToUpsert.length} ${rowsToUpsert.length === 1 ? 'item' : 'itens'})`)
        setMode(null); setQtys({}); setPrevCounts({})
        return
      }

      // Sobra ou Descarte — comportamento original (preservado)
      const items = Object.entries(qtys).filter(([,v]) => v > 0)
      if (!items.length) { showToast('Nenhuma quantidade preenchida'); return }
      const table = mode === 'sobra' ? 'sobras' : 'descartes'

      // Idempotência: pra descarte, apaga bread_movements antigos (diretos + cascade de kit)
      // antes de re-inserir os descartes
      if (mode === 'descarte') {
        const { data: oldRecords } = await supabase.from('descartes').select('id')
          .eq('record_date', date).eq('responsible', user.displayName)
        const oldIds = (oldRecords||[]).map((r:any)=>r.id)
        if (oldIds.length > 0) {
          await supabase.from('bread_movements').delete()
            .in('reference_id', oldIds).in('reference_type', ['descarte','descarte_kit'])
        }
      }
      await supabase.from(table).delete().eq('record_date', date).eq('responsible', user.displayName)

      const rows = items.map(([id, quantity]) => {
        const isBread = id.startsWith('bread_')
        return {
          record_date: date, responsible: user.displayName,
          product_id: isBread ? id.replace('bread_','') : id,
          product_source: isBread ? 'bread' : 'catalog',
          quantity
        }
      })
      const { data: inserted, error } = await supabase.from(table).insert(rows).select('id, product_id, product_source, quantity')
      if (error) throw error

      // Stock movements pra DESCARTE (precisa de loja atribuída ao user)
      let cascadeBreadCount = 0
      if (mode === 'descarte' && user.store && inserted) {
        const directMovements = (inserted as any[])
          .filter(r => r.product_source === 'bread' && Number(r.quantity) > 0)
          .map(r => ({
            movement_type: 'descarte_loja',
            bread_id: r.product_id,
            location: user.store,
            quantity: -Number(r.quantity),
            reference_id: r.id,
            reference_type: 'descarte',
            recorded_by: user.displayName,
          }))
        if (directMovements.length > 0) {
          await supabase.from('bread_movements').insert(directMovements)
        }

        // Cascade de kit (mesma lógica do C1)
        const kitIds = new Set(products.filter(p => p.kind === 'kit').map(p => p.id))
        const kitRows = (inserted as any[]).filter(r =>
          r.product_source === 'catalog' && Number(r.quantity) > 0 && kitIds.has(r.product_id)
        )
        if (kitRows.length > 0) {
          const kitProductIds = kitRows.map(r => r.product_id)
          const { data: comps } = await supabase
            .from('product_components')
            .select('parent_product_id,component_source,component_id,quantity')
            .in('parent_product_id', kitProductIds)
            .eq('component_source', 'bread')
          const cascadeMovements: any[] = []
          for (const kit of kitRows) {
            const kitQty = Number(kit.quantity)
            const breadComps = (comps || []).filter((c: any) => c.parent_product_id === kit.product_id)
            for (const c of breadComps as any[]) {
              cascadeMovements.push({
                movement_type: 'descarte_loja',
                bread_id: c.component_id,
                location: user.store,
                quantity: -(Number(c.quantity) * kitQty),
                reference_id: kit.id,
                reference_type: 'descarte_kit',
                recorded_by: user.displayName,
              })
            }
          }
          if (cascadeMovements.length > 0) {
            await supabase.from('bread_movements').insert(cascadeMovements)
            cascadeBreadCount = cascadeMovements.length
          }
        }
      }

      const cascadeNote = cascadeBreadCount > 0 ? ` (+${cascadeBreadCount} pães debitados via kit)` : ''
      showToast(`✅ ${mode==='sobra'?'Sobras':'Descartes'} salvo${mode==='sobra'?'s':'s'}!${cascadeNote}`)
      setMode(null); setQtys({})
    } catch(e:any) { showToast('Erro: '+e.message) }
    finally { setSaving(false) }
  }

  const grouped = products.reduce((acc:Record<string,Product[]>, p) => {
    ;(acc[p.category]??=[]).push(p); return acc
  }, {})
  // Pra "filled" no modo prateleira não conta zeros — só contagens > 0.
  // Mas no save, mandamos rows zeradas se ontem tinha (pra declarar "esgotou").
  const filled = Object.values(qtys).filter(v => v > 0).length

  if (!user) return (
    <div className="ps-loading">
      <div className="ps-spinner"/>
      <p>Carregando...</p>
    </div>
  )

  const userDisplay = user.displayName

  // ── SELECT MODE ──
  if (!mode) return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Sobras &amp; Descartes</b>
              <span>{todayLabel()}</span>
            </div>
          </div>
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(user.role)}}>{userDisplay.charAt(0).toUpperCase()}</div>
            <b>{userDisplay}{user.store ? ` / ${user.store.toUpperCase()}` : ''}</b>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          <h1 className="ps-page-title">♻️ O que registrar?</h1>
          <p className="ps-page-lead">Sobras de pão fresco · Prateleira (contagem do balcão) · Descarte real.</p>

          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <button onClick={()=>setMode('sobra')} className="ps-report-card" style={{textAlign:'left'}}>
              <div className="icon"><Package size={28}/></div>
              <h3>Registrar Sobras</h3>
              <p>Pão fresco do dia que sobrou no fechamento. Não move estoque. Itens de prateleira (pão de forma, kits) não aparecem aqui.</p>
            </button>
            <button onClick={()=>setMode('prateleira')} className="ps-report-card" style={{textAlign:'left'}}>
              <div className="icon"><Layers size={28}/></div>
              <h3>Prateleira (fim do dia)</h3>
              <p>Contagem do que tem no balcão pra produtos durados (pão de forma, hamburguer, kits). Salva o saldo do dia por loja.</p>
            </button>
            <button onClick={()=>setMode('descarte')} className="ps-report-card" style={{textAlign:'left'}}>
              <div className="icon"><Trash2 size={26}/></div>
              <h3>Registrar Descarte</h3>
              <p>
                O que foi descartado. {user.store
                  ? `Pães debitam do estoque da loja ${user.store.toUpperCase()}.`
                  : 'Sem loja atribuída — não move estoque (admin/teste).'}
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── FORM ──
  const headerTitle = mode === 'sobra' ? 'Sobras' : mode === 'descarte' ? 'Descartes' : 'Prateleira'

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={()=>{setMode(null);setQtys({})}} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>{headerTitle}</b>
              <span>{todayLabel()}</span>
            </div>
          </div>
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(user.role)}}>{userDisplay.charAt(0).toUpperCase()}</div>
            <b>{userDisplay}{user.store ? ` / ${user.store.toUpperCase()}` : ''}</b>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          {mode === 'prateleira' && (() => {
            // Atendentes (user.store setado) ficam travados na própria loja —
            // evita JC sobrescrever o snapshot de JA/EX por engano. Admin tem
            // user.store=null e mantém a escolha livre.
            const locked = !!user.store && (STORES as readonly string[]).includes(user.store)
            return (
              <div className="ps-card" style={{padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10}}>
                <div style={{fontSize:13, color:'var(--ink-soft)', fontWeight:600}}>Loja:</div>
                {locked ? (
                  <div style={{flex:1, padding:'6px 10px', fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>
                    {STORE_LABEL[selectedStore] || selectedStore.toUpperCase()}
                    <span style={{fontSize:11, color:'var(--ink-faint)', fontWeight:400, marginLeft:6}}>
                      · sua loja
                    </span>
                  </div>
                ) : (
                  <select
                    value={selectedStore}
                    onChange={e => setSelectedStore(e.target.value)}
                    className="ps-select"
                    style={{flex:1, padding:'6px 10px', fontSize:13}}
                  >
                    {STORES.map(s => <option key={s} value={s}>{STORE_LABEL[s]}</option>)}
                  </select>
                )}
              </div>
            )
          })()}

          {breads.length > 0 && (
            <>
              <div className="ps-label">🍞 Pães{mode === 'prateleira' ? ' de prateleira' : ' do dia'}</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {breads.map(b=>{
                  const k = 'bread_'+b.id
                  return (
                    <ItemRow key={k} id={k} name={b.name} unit={b.unit}
                      qty={qtys[k]||0} prev={mode==='prateleira' ? prevCounts[k] : undefined}
                      onChange={setQty}/>
                  )
                })}
              </div>
            </>
          )}

          {Object.entries(grouped).map(([cat, items])=>(
            <div key={cat}>
              <div className="ps-label">{cat}</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {items.map(p=>(
                  <ItemRow key={p.id} id={p.id} name={p.name} unit={p.unit}
                    qty={qtys[p.id]||0} prev={mode==='prateleira' ? prevCounts[p.id] : undefined}
                    onChange={setQty}/>
                ))}
              </div>
            </div>
          ))}

          {breads.length === 0 && Object.keys(grouped).length === 0 && mode !== 'prateleira' && (
            <div className="ps-empty">Sem itens pra registrar hoje.</div>
          )}

          {mode === 'prateleira' && (
            <>
              {breads.length === 0 && Object.keys(grouped).length === 0 && (
                <div className="ps-empty">
                  Nenhum produto marcado como Prateleira ainda. Usa o botão abaixo pra incluir.
                </div>
              )}
              <button
                onClick={() => { setIncludeOpen(true); setIncludeSearch('') }}
                className="ps-btn ghost block"
                style={{marginTop:14, borderStyle:'dashed'}}
              >
                <Plus size={14}/> Incluir produto/pão na prateleira
              </button>
            </>
          )}
        </div>

        <div className="ps-totalbar">
          <div className="ps-total-num">
            <b>{filled}</b>
            <span>{mode === 'prateleira' ? 'contagem' : 'item'}{filled!==1?'s':''}{mode === 'prateleira' ? ' > 0' : ' preenchido'+(filled!==1?'s':'')}</span>
          </div>
          <button className="ps-save" onClick={save} disabled={saving}>
            {saving ? <span className="ps-spinner" style={{width:16,height:16,borderWidth:2}}/> : <><Save size={16}/> Salvar</>}
          </button>
        </div>
      </div>

      {/* Sheet: incluir produto/pão na prateleira */}
      {includeOpen && (() => {
        const q = includeSearch.trim().toLowerCase()
        const filteredBreads = q.length < 2 ? [] : candidateBreads
          .filter(b => b.name.toLowerCase().includes(q)).slice(0, 15)
        const filteredProducts = q.length < 2 ? [] : candidateProducts
          .filter(p => p.name.toLowerCase().includes(q)).slice(0, 25)
        const total = filteredBreads.length + filteredProducts.length
        return (
          <div className="ps-sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setIncludeOpen(false) }}>
            <div className="ps-sheet" style={{maxHeight:'85vh', overflowY:'auto'}}>
              <div className="ps-sheet-grab"/>
              <h3>Incluir na Prateleira</h3>
              <p style={{fontSize:12, color:'var(--ink-soft)', marginBottom:14}}>
                Marca o item como produto durado. Aparece em todas as contagens de Prateleira (todas as lojas).
                Pode reverter em /produtos.
              </p>

              <div className="ps-fieldgroup" style={{marginBottom:8}}>
                <div style={{position:'relative'}}>
                  <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                  <input
                    value={includeSearch}
                    autoFocus
                    onChange={e => setIncludeSearch(e.target.value)}
                    placeholder="Buscar pão ou produto…"
                    className="ps-input"
                    style={{paddingLeft:30}}
                  />
                </div>
              </div>

              {q.length > 0 && q.length < 2 && (
                <div style={{padding:10, fontSize:12, color:'var(--ink-faint)'}}>Digite ao menos 2 caracteres…</div>
              )}
              {q.length >= 2 && (
                <div style={{maxHeight:380, overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:8, marginBottom:12}}>
                  {total === 0 ? (
                    <div style={{padding:14, textAlign:'center', color:'var(--ink-faint)', fontSize:12}}>
                      Nada encontrado. (Itens já na prateleira são filtrados.)
                    </div>
                  ) : (
                    <>
                      {filteredBreads.map(b => (
                        <button
                          key={'cand-bread-'+b.id}
                          onClick={() => { includeBread(b); setIncludeSearch('') }}
                          style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer'}}
                        >
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>
                              {b.name} <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖 PÃO</span>
                            </div>
                            <div style={{fontSize:11, color:'var(--ink-faint)'}}>{b.unit || 'un'}</div>
                          </div>
                          <Plus size={14} style={{color:'var(--honey-deep)'}}/>
                        </button>
                      ))}
                      {filteredProducts.map(p => (
                        <button
                          key={'cand-prod-'+p.id}
                          onClick={() => { includeProduct(p); setIncludeSearch('') }}
                          style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer'}}
                        >
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>
                              {p.name} <span className="ps-store-chip ja" style={{marginLeft:6}}>{p.category}</span>
                            </div>
                            <div style={{fontSize:11, color:'var(--ink-faint)'}}>{p.unit || '—'}</div>
                          </div>
                          <Plus size={14} style={{color:'var(--honey-deep)'}}/>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              <button onClick={() => setIncludeOpen(false)} className="ps-btn primary block">
                <X size={14}/> Fechar
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function ItemRow({ id, name, unit, qty, prev, onChange }: { id:string; name:string; unit:string|null; qty:number; prev?:number; onChange:(id:string,v:number)=>void }) {
  return (
    <div className={`ps-card ${qty>0?'active':''}`} style={{padding:'12px 14px', gap:8}}>
      <div className="ps-card-head" style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:10}}>
        <div style={{flex:1, minWidth:0}}>
          <div className="ps-pname" style={{fontSize:14.5}}>{name}</div>
          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2, display:'flex', gap:8}}>
            {unit && <span>{unit}</span>}
            {prev != null && <span style={{color:'var(--ink-soft)'}}>ontem: <b>{prev}</b></span>}
          </div>
        </div>
        <div className="ps-stepper" style={{flex:'none'}}>
          <button className="ps-step" style={{width:36, height:36}} onClick={()=>onChange(id, qty-1)} disabled={qty<=0} aria-label="Diminuir">
            <Minus size={16}/>
          </button>
          <input className={`ps-qty ${qty===0?'zero':''}`} style={{width:64, height:36, fontSize:15}}
            type="number" value={qty||''} min={0} step={0.1} placeholder="0"
            onChange={e=>onChange(id, parseFloat(e.target.value)||0)}/>
          <button className="ps-step" style={{width:36, height:36}} onClick={()=>onChange(id, qty+1)} aria-label="Aumentar">
            <Plus size={16}/>
          </button>
        </div>
      </div>
    </div>
  )
}
