'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Plus, Search, Pencil, Save, X, Package, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface Supplier {
  id: string; name: string; cnpj: string | null; phone: string | null
  email: string | null; notes: string | null; active: boolean
  whatsapp_e164: string | null; telegram_handle: string | null
}
interface CatalogProduct { id: string; name: string; category: string; unit: string | null; kind: string | null; is_revenda: boolean }
interface SupplierProduct { id: string; supplier_id: string; product_id: string; default_unit: string | null; supplier_code: string | null }

const emptyForm = { name: '', cnpj: '', phone: '', email: '', notes: '', whatsapp_e164: '', telegram_handle: '' }

export default function FornecedoresPage() {
  const router = useRouter()
  const [user, setUser]         = useState<AppUser | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Supplier | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [saving, setSaving]     = useState(false)
  const [search, setSearch]     = useState('')
  const [productsModalFor, setProductsModalFor] = useState<Supplier | null>(null)
  const [catalog, setCatalog]   = useState<CatalogProduct[]>([])
  const [mappings, setMappings] = useState<SupplierProduct[]>([])
  const [productSearch, setProductSearch] = useState('')

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const load = async () => {
    const [{ data: sup }, { data: prods }, { data: maps }] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id,name,category,unit,kind,is_revenda').eq('active', true).or('kind.eq.insumo,is_revenda.eq.true').order('name'),
      supabase.from('supplier_products').select('*').eq('active', true),
    ])
    setSuppliers((sup as Supplier[]) || [])
    setCatalog((prods as CatalogProduct[]) || [])
    setMappings((maps as SupplierProduct[]) || [])
  }

  useEffect(() => { load() }, [])

  const mappedCountBySupplier = mappings.reduce<Record<string, number>>((acc, m) => {
    acc[m.supplier_id] = (acc[m.supplier_id] || 0) + 1
    return acc
  }, {})

  const addMapping = async (supplierId: string, product: CatalogProduct) => {
    const { data, error } = await supabase
      .from('supplier_products')
      .insert({ supplier_id: supplierId, product_id: product.id, default_unit: product.unit })
      .select()
      .single()
    if (error) { showToast('Erro: '+error.message); return }
    setMappings(prev => [...prev, data as SupplierProduct])
  }

  const removeMapping = async (mappingId: string) => {
    const { error } = await supabase.from('supplier_products').delete().eq('id', mappingId)
    if (error) { showToast('Erro: '+error.message); return }
    setMappings(prev => prev.filter(m => m.id !== mappingId))
  }

  const openNew = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (s: Supplier) => {
    setEditing(s)
    setForm({
      name: s.name, cnpj: s.cnpj || '', phone: s.phone || '',
      email: s.email || '', notes: s.notes || '',
      whatsapp_e164: s.whatsapp_e164 || '', telegram_handle: s.telegram_handle || ''
    })
    setShowForm(true)
  }

  const saveSupplier = async () => {
    if (!form.name.trim()) { showToast('Nome é obrigatório'); return }
    setSaving(true)
    if (editing) {
      const { error } = await supabase.from('suppliers').update({ ...form }).eq('id', editing.id)
      if (error) { showToast('Erro ao atualizar'); setSaving(false); return }
      showToast('✅ Fornecedor atualizado')
    } else {
      const { error } = await supabase.from('suppliers').insert({ ...form })
      if (error) { showToast('Erro ao cadastrar'); setSaving(false); return }
      showToast('✅ Fornecedor cadastrado')
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  const toggleActive = async (s: Supplier) => {
    await supabase.from('suppliers').update({ active: !s.active }).eq('id', s.id)
    setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active } : x))
  }

  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const active   = filtered.filter(s => s.active)
  const inactive = filtered.filter(s => !s.active)

  const fields = [
    { key: 'name',           label: 'Nome *',                   type: 'text',  placeholder: 'Nome do fornecedor' },
    { key: 'cnpj',           label: 'CNPJ',                     type: 'text',  placeholder: '00.000.000/0001-00' },
    { key: 'phone',          label: 'Telefone',                 type: 'tel',   placeholder: '(54) 9 9999-9999' },
    { key: 'whatsapp_e164',  label: 'WhatsApp (E.164)',         type: 'tel',   placeholder: '+5554999999999 (com + e código do país)' },
    { key: 'telegram_handle',label: 'Telegram',                 type: 'text',  placeholder: '@usuario_telegram' },
    { key: 'email',          label: 'E-mail',                   type: 'email', placeholder: 'contato@fornecedor.com.br' },
    { key: 'notes',          label: 'Observações',              type: 'text',  placeholder: 'Condições de pagamento, prazo...' },
  ] as const

  const SupplierCard = ({ s }: { s: Supplier }) => (
    <div className="ps-card" style={{opacity: s.active ? 1 : 0.55, padding:'12px 14px'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
        <div style={{flex:1, minWidth:0}}>
          <div className="ps-pname" style={{fontSize:15}}>{s.name}</div>
          {s.cnpj  && <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:3}}>CNPJ: {s.cnpj}</div>}
          {s.phone && <div style={{fontSize:12, color:'var(--ink-soft)'}}>📞 {s.phone}</div>}
          {s.email && <div style={{fontSize:12, color:'var(--ink-soft)'}}>✉️ {s.email}</div>}
          {s.notes && <div style={{fontSize:12, color:'var(--ink-faint)', fontStyle:'italic', marginTop:3}}>{s.notes}</div>}
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:6, flexShrink:0}}>
          <button onClick={() => openEdit(s)} className="ps-btn ghost sm">
            <Pencil size={12}/> Editar
          </button>
          <button onClick={() => { setProductsModalFor(s); setProductSearch('') }} className="ps-btn ghost sm">
            <Package size={12}/> Produtos ({mappedCountBySupplier[s.id] || 0})
          </button>
          <button onClick={() => toggleActive(s)} className={`ps-btn sm ${s.active ? 'danger' : 'success'}`}>
            {s.active ? 'Inativar' : 'Ativar'}
          </button>
        </div>
      </div>
    </div>
  )

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
              <b>Fornecedores</b>
              <span>Cadastro</span>
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
          <div style={{marginTop:14, marginBottom:12, position:'relative'}}>
            <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
            <input type="text" placeholder="Buscar fornecedor..." value={search} onChange={e => setSearch(e.target.value)}
              className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
          </div>

          <button onClick={openNew} className="ps-btn primary block" style={{marginBottom:16}}>
            <Plus size={16}/> Novo fornecedor
          </button>

          {filtered.length === 0 ? (
            <div className="ps-empty">
              {suppliers.length === 0 ? 'Nenhum fornecedor cadastrado.' : 'Nenhum resultado.'}
            </div>
          ) : (
            <>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {active.map(s => <SupplierCard key={s.id} s={s} />)}
              </div>
              {inactive.length > 0 && (
                <>
                  <div className="ps-label">Inativos</div>
                  <div style={{display:'flex', flexDirection:'column', gap:8}}>
                    {inactive.map(s => <SupplierCard key={s.id} s={s} />)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {productsModalFor && (() => {
        const myMappings = mappings.filter(m => m.supplier_id === productsModalFor.id)
        const mappedProductIds = new Set(myMappings.map(m => m.product_id))
        const q = productSearch.trim().toLowerCase()
        const candidates = q.length < 2 ? [] : catalog
          .filter(p => !mappedProductIds.has(p.id) && p.name.toLowerCase().includes(q))
          .slice(0, 25)

        return (
          <div className="ps-sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setProductsModalFor(null) }}>
            <div className="ps-sheet" style={{maxHeight:'85vh', overflowY:'auto'}}>
              <div className="ps-sheet-grab"/>
              <h3>{productsModalFor.name} — Produtos</h3>
              <p style={{fontSize:12, color:'var(--ink-soft)', marginBottom:14}}>
                O que esse fornecedor vende. Só aparece insumo + revenda (Fase E).
              </p>

              {/* Já mapeados */}
              <div style={{marginBottom:14}}>
                <div className="ps-flabel" style={{marginBottom:6}}>Cadastrados ({myMappings.length})</div>
                {myMappings.length === 0 ? (
                  <div style={{padding:'12px 4px', fontSize:12, color:'var(--ink-faint)', textAlign:'center'}}>
                    Nenhum produto cadastrado pra esse fornecedor ainda.
                  </div>
                ) : (
                  myMappings.map(m => {
                    const prod = catalog.find(p => p.id === m.product_id)
                    return (
                      <div key={m.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'1px solid var(--line-soft)'}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>{prod?.name || '(produto removido)'}</div>
                          <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                            {m.default_unit || prod?.unit || '—'}
                            {prod?.is_revenda && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--crust-tint)', color:'var(--crust)'}}>REVENDA</span>}
                          </div>
                        </div>
                        <button onClick={() => removeMapping(m.id)} className="ps-iconbtn" style={{width:28, height:28}} title="Remover">
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Buscar pra adicionar */}
              <div className="ps-fieldgroup" style={{marginBottom:8}}>
                <div className="ps-fieldlabel">Adicionar produto</div>
                <div style={{position:'relative'}}>
                  <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                  <input
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Buscar produto (insumo ou revenda)..."
                    className="ps-input"
                    style={{paddingLeft:30}}
                  />
                </div>
              </div>

              {q.length > 0 && q.length < 2 && (
                <div style={{padding:10, fontSize:12, color:'var(--ink-faint)'}}>Digite ao menos 2 caracteres…</div>
              )}
              {q.length >= 2 && (
                <div style={{maxHeight:300, overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:8, marginBottom:12}}>
                  {candidates.length === 0 ? (
                    <div style={{padding:14, textAlign:'center', color:'var(--ink-faint)', fontSize:12}}>
                      Nenhum candidato. (Produtos já cadastrados são filtrados.)
                    </div>
                  ) : candidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { addMapping(productsModalFor.id, c); setProductSearch('') }}
                      style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer'}}
                    >
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>{c.name}</div>
                        <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                          {c.category} · {c.unit || '—'}
                          {c.is_revenda && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--crust-tint)', color:'var(--crust)'}}>REVENDA</span>}
                        </div>
                      </div>
                      <Plus size={14} style={{color:'var(--honey-deep)'}}/>
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => setProductsModalFor(null)} className="ps-btn primary block">
                <X size={14}/> Fechar
              </button>
            </div>
          </div>
        )
      })()}

      {showForm && (
        <div className="ps-sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>{editing ? `Editar — ${editing.name}` : 'Novo fornecedor'}</h3>

            <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:14}}>
              {fields.map(f => (
                <div key={f.key} className="ps-fieldgroup">
                  <div className="ps-fieldlabel">{f.label}</div>
                  <input
                    type={f.type} placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="ps-input"
                  />
                </div>
              ))}
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <button onClick={() => setShowForm(false)} className="ps-btn ghost">
                <X size={14}/> Cancelar
              </button>
              <button onClick={saveSupplier} disabled={saving} className="ps-btn primary">
                <Save size={14}/> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
