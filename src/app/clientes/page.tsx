'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Plus, Pencil, Ban, Check, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface PriceTier { id: string; name: string; active: boolean }

interface Customer {
  id: string
  name: string
  doc: string | null
  contact: string | null
  default_tier_id: string | null
  discount_pct: number
  delivery_hours: number
  active: boolean
  notes: string | null
  created_at: string
}

type FormState = Omit<Customer, 'id' | 'created_at'>

const EMPTY_FORM: FormState = {
  name: '', doc: '', contact: '', default_tier_id: null,
  discount_pct: 0, delivery_hours: 48, active: true, notes: ''
}

export default function ClientesPage() {
  const [user, setUser]           = useState<AppUser | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tiers, setTiers]         = useState<PriceTier[]>([])
  const [search, setSearch]       = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing]     = useState<Customer | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [creating, setCreating]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [cRes, tRes] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase.from('price_tiers').select('id,name,active').eq('active', true).order('name'),
    ])
    setCustomers((cRes.data || []) as Customer[])
    setTiers((tRes.data || []) as PriceTier[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const tierMap = useMemo(() => {
    const m = new Map<string, string>()
    tiers.forEach(t => m.set(t.id, t.name))
    return m
  }, [tiers])

  const filtered = useMemo(() => customers.filter(c => {
    if (!showInactive && !c.active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) ||
      (c.doc || '').toLowerCase().includes(q) ||
      (c.contact || '').toLowerCase().includes(q)
  }), [customers, search, showInactive])

  const startCreate = () => { setEditing(null); setForm(EMPTY_FORM); setCreating(true) }
  const startEdit = (c: Customer) => {
    setEditing(c)
    setForm({
      name: c.name, doc: c.doc || '', contact: c.contact || '',
      default_tier_id: c.default_tier_id, discount_pct: c.discount_pct,
      delivery_hours: c.delivery_hours, active: c.active, notes: c.notes || '',
    })
    setCreating(true)
  }
  const cancelForm = () => { setCreating(false); setEditing(null) }

  const save = async () => {
    if (!form.name.trim()) { showToast('Nome obrigatório'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      doc: form.doc?.trim() || null,
      contact: form.contact?.trim() || null,
      default_tier_id: form.default_tier_id || null,
      discount_pct: Number(form.discount_pct) || 0,
      delivery_hours: Number(form.delivery_hours) || 48,
      active: form.active,
      notes: form.notes?.trim() || null,
    }
    const { error } = editing
      ? await supabase.from('customers').update(payload).eq('id', editing.id)
      : await supabase.from('customers').insert(payload)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast(editing ? '✅ Cliente atualizado' : '✅ Cliente cadastrado')
    cancelForm(); load()
  }

  const toggleActive = async (c: Customer) => {
    const action = c.active ? 'Inativar' : 'Reativar'
    if (!confirm(`${action} "${c.name}"?`)) return
    const { error } = await supabase.from('customers').update({ active: !c.active }).eq('id', c.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast(`✅ ${c.name} ${c.active ? 'inativado' : 'reativado'}`)
    load()
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Clientes PJ</b>
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
          <h1 className="ps-page-title">👥 Clientes PJ</h1>
          <p className="ps-page-lead">
            Cadastro de clientes PJ e clientes recorrentes de encomenda. Cada cliente pode ter uma tabela de preço padrão e um desconto base.
          </p>

          <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
            <div style={{flex:1, minWidth:200, position:'relative'}}>
              <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
              <input placeholder="Buscar nome, CNPJ, contato..." value={search} onChange={e=>setSearch(e.target.value)}
                className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
            </div>
            <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, color:'var(--ink-soft)', cursor:'pointer'}}>
              <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>
              Mostrar inativos
            </label>
            <button onClick={startCreate} className="ps-btn primary">
              <Plus size={14}/> Novo cliente
            </button>
          </div>

          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="ps-empty">
              {customers.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum resultado.'}
            </div>
          ) : (
            <div style={{display:'grid', gap:10}}>
              {filtered.map(c => (
                <div key={c.id} className="ps-card" style={{borderLeft:`4px solid ${c.active ? 'var(--crust)' : 'var(--ps-line)'}`, opacity:c.active?1:0.6}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div className="ps-pname">
                        {c.name}
                        {!c.active && <span className="ps-store-chip" style={{marginLeft:8, background:'var(--line-soft)', color:'var(--ink-faint)'}}>inativo</span>}
                      </div>
                      <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:2, display:'flex', gap:10, flexWrap:'wrap'}}>
                        {c.doc && <span>📄 {c.doc}</span>}
                        {c.contact && <span>📞 {c.contact}</span>}
                      </div>
                    </div>
                    <div style={{display:'flex', gap:4}}>
                      <button onClick={()=>startEdit(c)} title="Editar" className="ps-btn ghost sm">
                        <Pencil size={12}/> Editar
                      </button>
                      <button onClick={()=>toggleActive(c)} title={c.active ? 'Inativar' : 'Reativar'} className={`ps-btn sm ${c.active ? 'danger' : 'success'}`}>
                        {c.active ? <Ban size={12}/> : <Check size={12}/>}
                      </button>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    <span className="ps-store-chip" style={{background:'var(--line-soft)', color:'var(--ink-soft)'}}>
                      📋 {c.default_tier_id ? tierMap.get(c.default_tier_id) || '?' : 'sem tabela'}
                    </span>
                    {c.discount_pct > 0 && (
                      <span className="ps-store-chip ja">-{c.discount_pct}%</span>
                    )}
                    <span className="ps-store-chip" style={{background:'var(--line-soft)', color:'var(--ink-soft)'}}>
                      🚚 {c.delivery_hours}h
                    </span>
                  </div>
                  {c.notes && (
                    <div style={{fontSize:12, color:'var(--ink-faint)', fontStyle:'italic'}}>{c.notes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&cancelForm()}>
          <div className="ps-sheet confirm" style={{maxWidth:520, borderRadius:'var(--r-card)'}}>
            <h3>{editing ? `✏️ Editar — ${editing.name}` : '+ Novo cliente'}</h3>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Nome *</div>
              <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}
                placeholder="Razão social ou nome" className="ps-input"/>
            </div>

            <div className="ps-fieldrow" style={{marginBottom:10}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">CNPJ / CPF</div>
                <input value={form.doc || ''} onChange={e=>setForm({...form, doc:e.target.value})} placeholder="opcional" className="ps-input"/>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Contato</div>
                <input value={form.contact || ''} onChange={e=>setForm({...form, contact:e.target.value})} placeholder="telefone/email" className="ps-input"/>
              </div>
            </div>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Tabela de preço padrão</div>
              <select value={form.default_tier_id || ''} onChange={e=>setForm({...form, default_tier_id: e.target.value || null})} className="ps-select">
                <option value="">(sem tabela — cadastrar em /tabelas-preco)</option>
                {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="ps-fieldrow" style={{marginBottom:10}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Desconto base (%)</div>
                <input type="number" min={0} max={100} step={0.5} value={form.discount_pct}
                  onChange={e=>setForm({...form, discount_pct: Number(e.target.value)})} className="ps-input"/>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Entrega padrão (h)</div>
                <input type="number" min={0} step={1} value={form.delivery_hours}
                  onChange={e=>setForm({...form, delivery_hours: Number(e.target.value)})} className="ps-input"/>
              </div>
            </div>

            <div className="ps-fieldgroup" style={{marginBottom:14}}>
              <div className="ps-fieldlabel">Observações</div>
              <textarea value={form.notes || ''} onChange={e=>setForm({...form, notes:e.target.value})}
                placeholder="Notas internas (opcional)" className="ps-textarea"/>
            </div>

            {editing && (
              <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:'var(--ink-soft)', marginBottom:14, padding:'8px 10px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)', cursor:'pointer'}}>
                <input type="checkbox" checked={form.active} onChange={e=>setForm({...form, active:e.target.checked})}/>
                Ativo
              </label>
            )}

            <div className="actions">
              <button onClick={save} disabled={saving} className="ps-btn primary">
                <Save size={14}/> {saving ? 'Salvando...' : (editing ? 'Atualizar' : 'Cadastrar')}
              </button>
              <button onClick={cancelForm} disabled={saving} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
