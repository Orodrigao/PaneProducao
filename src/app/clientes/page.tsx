'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
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
  const [user, setUser]           = useState<{displayName:string; role:string}|null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tiers, setTiers]         = useState<PriceTier[]>([])
  const [search, setSearch]       = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing]     = useState<Customer | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [creating, setCreating]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName, role: u.role })
  }, [])

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
    <div style={{padding:'20px',maxWidth:900,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:10,flexWrap:'wrap'}}>
        <h1 style={{margin:0,fontSize:'1.3rem',fontWeight:700}}>👥 Clientes PJ</h1>
        {user && (
          <span style={{fontSize:'.78rem',color:'var(--muted)'}}>{user.displayName}</span>
        )}
      </div>

      <p style={{margin:'0 0 16px',color:'var(--muted)',fontSize:'.85rem'}}>
        Cadastro de clientes PJ e clientes recorrentes de encomenda. Cada cliente pode ter uma tabela de preço padrão e um desconto base.
      </p>

      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <input placeholder="🔍 Buscar nome, CNPJ, contato..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{flex:1,minWidth:200,padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:'.85rem',color:'var(--muted)',cursor:'pointer'}}>
          <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>
          Mostrar inativos
        </label>
        <button onClick={startCreate}
          style={{padding:'9px 16px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.85rem',fontWeight:700,whiteSpace:'nowrap'}}>
          + Novo cliente
        </button>
      </div>

      {loading ? (
        <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
      ) : filtered.length === 0 ? (
        <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>
          {customers.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum resultado.'}
        </div>
      ) : (
        <div style={{display:'grid',gap:10}}>
          {filtered.map(c => (
            <div key={c.id} style={{
              background:'white',borderRadius:10,padding:'12px 14px',
              border:'1px solid var(--border)',
              borderLeft: `4px solid ${c.active ? 'var(--primary)' : '#9ca3af'}`,
              opacity: c.active ? 1 : 0.6,
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:6}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:'.95rem'}}>
                    {c.name}
                    {!c.active && <span style={{marginLeft:8,fontSize:'.7rem',color:'#9ca3af'}}>(inativo)</span>}
                  </div>
                  <div style={{fontSize:'.78rem',color:'var(--muted)',marginTop:2,display:'flex',gap:10,flexWrap:'wrap'}}>
                    {c.doc && <span>📄 {c.doc}</span>}
                    {c.contact && <span>📞 {c.contact}</span>}
                  </div>
                </div>
                <div style={{display:'flex',gap:4}}>
                  <button onClick={()=>startEdit(c)} title="Editar"
                    style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:'.78rem'}}>
                    ✏️ Editar
                  </button>
                  <button onClick={()=>toggleActive(c)} title={c.active ? 'Inativar' : 'Reativar'}
                    style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:'.78rem'}}>
                    {c.active ? '🚫' : '✓'}
                  </button>
                </div>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
                <span style={{fontSize:'.72rem',padding:'2px 8px',background:'#f3f4f6',borderRadius:20}}>
                  📋 {c.default_tier_id ? tierMap.get(c.default_tier_id) || '?' : 'sem tabela'}
                </span>
                {c.discount_pct > 0 && (
                  <span style={{fontSize:'.72rem',padding:'2px 8px',background:'#dcfce7',color:'#166534',borderRadius:20,fontWeight:600}}>
                    -{c.discount_pct}%
                  </span>
                )}
                <span style={{fontSize:'.72rem',padding:'2px 8px',background:'#f3f4f6',borderRadius:20}}>
                  🚚 {c.delivery_hours}h
                </span>
              </div>
              {c.notes && (
                <div style={{fontSize:'.75rem',color:'var(--muted)',marginTop:6,fontStyle:'italic'}}>{c.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}
             onClick={e=>e.target===e.currentTarget&&cancelForm()}>
          <div style={{background:'white',borderRadius:12,padding:20,maxWidth:520,width:'100%',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:14}}>
              {editing ? '✏️ Editar cliente' : '+ Novo cliente'}
            </div>

            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Nome *</label>
            <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}
              placeholder="Razão social ou nome"
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10}}/>

            <div style={{display:'flex',gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>CNPJ / CPF</label>
                <input value={form.doc || ''} onChange={e=>setForm({...form, doc:e.target.value})}
                  placeholder="opcional"
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Contato</label>
                <input value={form.contact || ''} onChange={e=>setForm({...form, contact:e.target.value})}
                  placeholder="telefone/email"
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
            </div>

            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Tabela de preço padrão</label>
            <select value={form.default_tier_id || ''} onChange={e=>setForm({...form, default_tier_id: e.target.value || null})}
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10,background:'white'}}>
              <option value="">(sem tabela — cadastrar em /tabelas-preco)</option>
              {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <div style={{display:'flex',gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Desconto base (%)</label>
                <input type="number" min={0} max={100} step={0.5} value={form.discount_pct}
                  onChange={e=>setForm({...form, discount_pct: Number(e.target.value)})}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Entrega padrão (h)</label>
                <input type="number" min={0} step={1} value={form.delivery_hours}
                  onChange={e=>setForm({...form, delivery_hours: Number(e.target.value)})}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
            </div>

            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Observações</label>
            <textarea value={form.notes || ''} onChange={e=>setForm({...form, notes:e.target.value})}
              placeholder="Notas internas (opcional)"
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:14,minHeight:60,resize:'vertical'}}/>

            {editing && (
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'.85rem',marginBottom:14,cursor:'pointer'}}>
                <input type="checkbox" checked={form.active} onChange={e=>setForm({...form, active:e.target.checked})}/>
                Ativo
              </label>
            )}

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={cancelForm} disabled={saving}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                Cancelar
              </button>
              <button onClick={save} disabled={saving}
                style={{padding:'10px 18px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:700,opacity:saving?0.6:1}}>
                {saving ? 'Salvando...' : (editing ? 'Atualizar' : 'Cadastrar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
