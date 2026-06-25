'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Search, Pencil, Save, AlertTriangle, RotateCw, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

type Kind = 'kit' | 'insumo' | 'final'

interface Product {
  id: string; name: string; category: string; unit: string|null
  cost_price: number|null; active: boolean; sort_order: number
  kind: Kind | null
  is_revenda: boolean
  is_shelf: boolean
  is_fabricacao_propria: boolean
  is_pj: boolean
  production_days: number[]
  production_area: string | null
  legacy_bread_id: string | null
}

type EditableProduct = Partial<Omit<Product, 'cost_price'>> & {
  cost_price?: number | string | null
}

const KIND_LABELS: Record<Kind, string> = { kit: 'KIT', insumo: 'INSUMO', final: 'FINAL' }
// Mapeia pro chip ps-store-chip (jc=honey/kit, ja=sage/insumo). 'final' fica neutro.
const KIND_CHIP_CLS: Record<Kind, string> = { kit: 'jc', insumo: 'ja', final: '' }
const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const PRODUCTION_AREAS = [
  { value: '', label: 'Sem área' },
  { value: 'padaria', label: 'Padaria' },
  { value: 'cozinha', label: 'Cozinha' },
  { value: 'confeitaria', label: 'Confeitaria' },
  { value: 'expedicao', label: 'Expedição' },
  { value: 'outros', label: 'Outros' },
]

function canUseTechnicalSheet(product: Product): boolean {
  return !product.is_revenda && product.kind !== 'insumo'
}

function formatProductionDays(days: number[] | null | undefined): string {
  if (!days || days.length === 0) return 'sem dias definidos'
  return [...days].sort((a, b) => a - b).map(day => WEEK_DAYS[day] ?? String(day)).join(', ')
}

function toggleDay(days: number[] | undefined, day: number): number[] {
  const current = new Set(days ?? [])
  if (current.has(day)) current.delete(day)
  else current.add(day)
  return [...current].sort((a, b) => a - b)
}

function normalizeCostPrice(value: number | string | null | undefined): number | null {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

interface Bread {
  id: string; name: string; unit: string|null
  cost_price: number|null; active: boolean; is_pj: boolean
  is_shelf: boolean
}

interface Component {
  parent_product_id: string
  component_source: string
  component_id: string
  quantity: number
}

const CATEGORIES = ['Bolos','Brownie','Bruschettas','Confeitaria','Cookies','Croissant','Doce',
  'Focaccias','Folhados & Doces','Lanches','Muffins','Pastas & Pesto','Pizza Redonda',
  'Pizza Romana','Pães - Migrado','Pães Branco','Pães Integ.','Pães Rech.','Pães Recheados','Salgados','Sopas & Cremes','INSUMOS']

export default function ProdutosPage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [tab, setTab]           = useState<'produtos'|'fabricacao'>('produtos')
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string|null>(null)
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('Todos')
  const [kindFilter, setKindFilter] = useState<'all'|Kind|'revenda'>('all')
  const [editItem, setEditItem] = useState<EditableProduct|null>(null)
  const [isNew, setIsNew]       = useState(false)

  useEffect(()=>{ setUser(getCurrentUser()); load() },[])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [pRes, bRes, cRes] = await Promise.all([
        supabase.from('products').select('*').order('category').order('name'),
        supabase.from('breads').select('*').order('name'),
        supabase.from('product_components').select('parent_product_id,component_source,component_id,quantity'),
      ])
      if (pRes.error) throw pRes.error
      if (bRes.error) throw bRes.error
      if (cRes.error) throw cRes.error
      setProducts(pRes.data||[])
      setBreads(bRes.data||[])
      setComponents((cRes.data||[]) as Component[])
    } catch(error: unknown) {
      setLoadError(getErrorMessage(error, 'Falha ao carregar os dados.'))
    } finally {
      setLoading(false)
    }
  }

  function switchTab(nextTab: 'produtos' | 'fabricacao') {
    setTab(nextTab)
    setCat('Todos')
    setKindFilter('all')
  }

  async function save() {
    if (!editItem?.name?.trim()) { showToast('Nome obrigatório'); return }
    const { cost_price: rawCostPrice, ...rest } = editItem
    const body: Partial<Product> = {
      ...rest,
      cost_price: normalizeCostPrice(rawCostPrice),
    }
    try {
      if (isNew) {
        const { error } = await supabase.from('products').insert({ ...body, active: true })
        if (error) throw error
        showToast('✅ Produto criado')
      } else {
        const { error } = await supabase.from('products').update(body).eq('id', editItem.id!)
        if (error) throw error
        showToast('✅ Salvo')
      }
      setEditItem(null); load()
    } catch(error: unknown) { showToast('Erro: '+getErrorMessage(error, 'não foi possível salvar')) }
  }

  async function toggleActive(p: Product) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id)
    setProducts(prev => prev.map(x => x.id===p.id ? {...x,active:!p.active} : x))
  }

  function newProductDefaults(fabricacaoPropria: boolean): EditableProduct {
    return {
      active: true,
      category: fabricacaoPropria ? 'Pães - Migrado' : CATEGORIES[0],
      unit: 'un',
      kind: 'final',
      is_revenda: false,
      is_shelf: false,
      is_fabricacao_propria: fabricacaoPropria,
      is_pj: false,
      production_days: [],
      production_area: fabricacaoPropria ? 'padaria' : null,
      legacy_bread_id: null,
    }
  }

  const productsForTab = tab === 'fabricacao'
    ? products.filter(p => p.is_fabricacao_propria)
    : products
  const cats = ['Todos',...new Set(productsForTab.map(p=>p.category).filter(Boolean))]
  const allCategories = [...new Set([...CATEGORIES, ...products.map(p=>p.category).filter(Boolean)])]
  const filtered = productsForTab.filter(p=>{
    const matchCat = catFilter==='Todos' || p.category===catFilter
    const matchKind = kindFilter==='all'
      || (kindFilter==='revenda' ? p.is_revenda : p.kind===kindFilter)
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchKind && matchSearch
  })
  // CMV teorico por produto com ficha tecnica: soma (custo do componente × quantidade).
  // Se algum componente não tem custo cadastrado, marca como parcial.
  const cmvByProduct: Record<string, { total: number; partial: boolean; count: number }> = {}
  for (const c of components) {
    const cost = c.component_source === 'bread'
      ? (breads.find(b => b.id === c.component_id)?.cost_price ?? null)
      : (products.find(p => p.id === c.component_id)?.cost_price ?? null)
    const entry = cmvByProduct[c.parent_product_id] ??= { total: 0, partial: false, count: 0 }
    entry.count++
    if (cost === null || Number(cost) === 0) entry.partial = true
    else entry.total += Number(cost) * Number(c.quantity)
  }

  const kindCounts = { kit: 0, insumo: 0, final: 0, revenda: 0 }
  for (const p of productsForTab) {
    if (p.kind === 'kit') kindCounts.kit++
    else if (p.kind === 'insumo') kindCounts.insumo++
    else if (p.kind === 'final') kindCounts.final++
    if (p.is_revenda) kindCounts.revenda++
  }
  const grouped = filtered.reduce((acc:Record<string,Product[]>,p)=>{ (acc[p.category]??=[]).push(p); return acc },{})

  const fabricacaoActiveCount = products.filter(p => p.is_fabricacao_propria && p.active).length
  const fabricacaoWithoutCost = products.filter(p =>
    p.is_fabricacao_propria && p.active && (p.cost_price === null || Number(p.cost_price) === 0)
  ).length

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Catálogo</b>
              <span>Produtos &amp; Pães</span>
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
            <button role="tab" aria-selected={tab==='produtos'} onClick={()=>switchTab('produtos')} className="ps-tab">
              🥐 Produtos ({products.filter(p=>p.active).length})
            </button>
            <button role="tab" aria-selected={tab==='fabricacao'} onClick={()=>switchTab('fabricacao')} className="ps-tab">
              🍞 Fabricação própria ({fabricacaoActiveCount})
            </button>
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {/* Action row: search + new */}
          <div style={{display:'flex', gap:8, marginTop:14, marginBottom:12}}>
            <div style={{flex:1, position:'relative'}}>
              <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
              <input placeholder={tab==='produtos' ? "Buscar produto..." : "Buscar fabricação própria..."} value={search} onChange={e=>setSearch(e.target.value)}
                className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
            </div>
            {tab==='produtos' ? (
              <button onClick={()=>{setIsNew(true);setEditItem(newProductDefaults(false))}} className="ps-btn primary">
                <Plus size={14}/> Novo
              </button>
            ) : (
              <button onClick={()=>{setIsNew(true);setEditItem(newProductDefaults(true))}} className="ps-btn primary">
                <Plus size={14}/> Novo
              </button>
            )}
          </div>

          {/* Kind filter */}
          <div className="ps-presets" style={{paddingBottom:6, marginBottom:8, flexWrap:'wrap'}}>
            <button onClick={()=>setKindFilter('all')} className={`ps-preset ${kindFilter==='all'?'active':''}`}>
              Todos
            </button>
            <button onClick={()=>setKindFilter('kit')} className={`ps-preset ${kindFilter==='kit'?'active':''}`}>
              🍞 Kits ({kindCounts.kit})
            </button>
            <button onClick={()=>setKindFilter('insumo')} className={`ps-preset ${kindFilter==='insumo'?'active':''}`}>
              🥚 Insumos ({kindCounts.insumo})
            </button>
            <button onClick={()=>setKindFilter('final')} className={`ps-preset ${kindFilter==='final'?'active':''}`}>
              ✨ Finais ({kindCounts.final})
            </button>
            <button onClick={()=>setKindFilter('revenda')} className={`ps-preset ${kindFilter==='revenda'?'active':''}`}>
              🛒 Revenda ({kindCounts.revenda})
            </button>
          </div>

          {/* Category filter */}
          <div className="ps-presets" style={{marginBottom:12}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setCat(c)} className={`ps-preset ${catFilter===c?'active':''}`}>
                {c}
              </button>
            ))}
          </div>

          {tab==='fabricacao' && fabricacaoWithoutCost > 0 && (
            <div className="ps-warning">
              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
              <span>
                <strong>{fabricacaoWithoutCost}</strong> {fabricacaoWithoutCost === 1 ? 'produto de fabricação própria ativo sem custo cadastrado' : 'produtos de fabricação própria ativos sem custo cadastrado'}.
              </span>
            </div>
          )}

          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : loadError ? (
            <div className="ps-empty">
              <AlertTriangle size={36} style={{display:'block', margin:'0 auto 8px', color:'var(--berry)', opacity:.6}}/>
              <div style={{color:'var(--berry)', fontSize:14, fontWeight:600, marginBottom:8}}>Não foi possível carregar os dados.</div>
              <div style={{color:'var(--ink-faint)', fontSize:12, marginBottom:14}}>{loadError}</div>
              <button onClick={()=>load()} className="ps-btn primary">
                <RotateCw size={14}/> Tentar de novo
              </button>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:12}}>
              {Object.entries(grouped).map(([cat, items])=>(
                <div key={cat} className="ps-card" style={{padding:'4px 14px'}}>
                  <div className="ps-flabel" style={{paddingTop:10}}>{cat} ({items.length})</div>
                  {items.map(p=>(
                    <div key={p.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)', opacity:p.active?1:0.5}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                          {p.name}
                          {p.kind && p.kind !== 'final' && (
                            <span className={`ps-store-chip ${KIND_CHIP_CLS[p.kind]}`}>{KIND_LABELS[p.kind]}</span>
                          )}
                          {p.is_revenda && (
                            <span className="ps-store-chip" style={{background:'var(--crust-tint)', color:'var(--crust)'}}>🛒 REVENDA</span>
                          )}
                          {p.is_fabricacao_propria && (
                            <span className="ps-store-chip jc">FABRICAÇÃO</span>
                          )}
                          {p.is_pj && (
                            <span className="ps-store-chip ja">PJ</span>
                          )}
                          {p.is_shelf && (
                            <span className="ps-store-chip ex">📦 PRATELEIRA</span>
                          )}
                          {p.legacy_bread_id && (
                            <span className="ps-store-chip" style={{background:'var(--line-soft)', color:'var(--ink-soft)'}}>MIGRADO</span>
                          )}
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {p.unit||''}{p.cost_price?` · R$ ${Number(p.cost_price).toFixed(2)}`:''}
                        </div>
                        {p.is_fabricacao_propria && (
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            {p.production_area || 'sem área'} · {formatProductionDays(p.production_days)}
                          </div>
                        )}
                        {canUseTechnicalSheet(p) && cmvByProduct[p.id] && (
                          <div style={{fontSize:11, color:'var(--sage)', marginTop:2, fontWeight:600}}>
                            CMV teórico: R$ {cmvByProduct[p.id].total.toFixed(2)}
                            {cmvByProduct[p.id].partial && <span style={{color:'var(--berry)', fontWeight:500}}> (parcial)</span>}
                            <span style={{color:'var(--ink-faint)', fontWeight:400}}> · {cmvByProduct[p.id].count} comp.</span>
                          </div>
                        )}
                      </div>
                      {canUseTechnicalSheet(p) && (
                        <Link href={`/produtos/composicao?id=${p.id}`} title="Ficha técnica / CMV teórico" className="ps-btn" style={{height:34, padding:'0 10px', fontSize:12, flexShrink:0}}>
                          <ClipboardList size={14}/>
                          Ficha
                        </Link>
                      )}
                      <button onClick={()=>toggleActive(p)} className={`ps-status ${p.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer'}}>
                        {p.active?'✓ Ativo':'Inativo'}
                      </button>
                      <button onClick={()=>{setIsNew(false);setEditItem({...p})}} className="ps-iconbtn" style={{width:30, height:30}}>
                        <Pencil size={14}/>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="ps-empty">
                  Nenhum item encontrado.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL — Produto */}
      {editItem && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>{isNew?'Novo Produto':'Editar Produto'}</h3>

            <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:14}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Nome</div>
                <input
                  type="text"
                  value={editItem.name || ''}
                  onChange={e=>setEditItem(prev=>({...prev, name:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Unidade</div>
                <input
                  type="text"
                  value={editItem.unit || ''}
                  onChange={e=>setEditItem(prev=>({...prev, unit:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Custo (R$)</div>
                <input
                  type="number"
                  value={editItem.cost_price ?? ''}
                  onChange={e=>setEditItem(prev=>({...prev, cost_price:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Categoria</div>
                <select value={editItem.category||''} onChange={e=>setEditItem(prev=>({...prev,category:e.target.value}))} className="ps-select">
                  {allCategories.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Tipo</div>
                <select value={editItem.kind || 'final'} onChange={e=>setEditItem(prev=>({...prev, kind: e.target.value as Kind}))} className="ps-select">
                  <option value="final">✨ Produto final (venda direta)</option>
                  <option value="kit">🍞 Kit (composto por pães/insumos)</option>
                  <option value="insumo">🥚 Insumo (matéria-prima)</option>
                </select>
              </div>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_revenda}
                  onChange={e => setEditItem(prev => ({...prev, is_revenda: e.target.checked}))}
                  style={{width:18, height:18, cursor:'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  🛒 <b>Revenda</b> — comprado pronto pra revender (aparece em /compras)
                </span>
              </label>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_shelf}
                  onChange={e => setEditItem(prev => ({...prev, is_shelf: e.target.checked}))}
                  style={{width:18, height:18, cursor:'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  📦 <b>Prateleira</b> — produto durado (≥ 2 dias). Atendente conta o saldo no fim do dia em /sobras → Prateleira, em vez de lançar como sobra todo dia.
                </span>
              </label>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_fabricacao_propria}
                  onChange={e => setEditItem(prev => ({
                    ...prev,
                    is_fabricacao_propria: e.target.checked,
                    production_area: e.target.checked ? (prev?.production_area || 'padaria') : prev?.production_area || null,
                  }))}
                  style={{width:18, height:18, cursor:'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  🍞 <b>Fabricação própria</b>
                </span>
              </label>
              {editItem.is_fabricacao_propria && (
                <>
                  <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                    <input
                      type="checkbox"
                      checked={!!editItem.is_pj}
                      onChange={e => setEditItem(prev => ({...prev, is_pj: e.target.checked}))}
                      style={{width:18, height:18, cursor:'pointer'}}
                    />
                    <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                      PJ
                    </span>
                  </label>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Área</div>
                    <select
                      value={editItem.production_area || ''}
                      onChange={e=>setEditItem(prev=>({...prev, production_area: e.target.value || null}))}
                      className="ps-select"
                    >
                      {PRODUCTION_AREAS.map(area => <option key={area.value} value={area.value}>{area.label}</option>)}
                    </select>
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Dias de produção</div>
                    <div className="ps-presets" style={{flexWrap:'wrap', marginBottom:0}}>
                      {WEEK_DAYS.map((label, day) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setEditItem(prev => ({...prev, production_days: toggleDay(prev?.production_days, day)}))}
                          className={`ps-preset ${(editItem.production_days || []).includes(day) ? 'active' : ''}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{display:'flex', gap:8}}>
              <button onClick={save} className="ps-btn primary" style={{flex:1}}>
                <Save size={14}/> Salvar
              </button>
              <button onClick={()=>setEditItem(null)} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
