'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Plus, Search, Pencil, Save, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface Supplier {
  id: string; name: string; cnpj: string | null; phone: string | null
  email: string | null; notes: string | null; active: boolean
}

const emptyForm = { name: '', cnpj: '', phone: '', email: '', notes: '' }

export default function FornecedoresPage() {
  const router = useRouter()
  const [user, setUser]         = useState<AppUser | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Supplier | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [saving, setSaving]     = useState(false)
  const [search, setSearch]     = useState('')

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const load = async () => {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers(data || [])
  }

  useEffect(() => { load() }, [])

  const openNew = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (s: Supplier) => {
    setEditing(s)
    setForm({ name: s.name, cnpj: s.cnpj || '', phone: s.phone || '', email: s.email || '', notes: s.notes || '' })
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
    { key: 'name',  label: 'Nome *',       type: 'text',  placeholder: 'Nome do fornecedor' },
    { key: 'cnpj',  label: 'CNPJ',         type: 'text',  placeholder: '00.000.000/0001-00' },
    { key: 'phone', label: 'Telefone',     type: 'tel',   placeholder: '(54) 9 9999-9999' },
    { key: 'email', label: 'E-mail',       type: 'email', placeholder: 'contato@fornecedor.com.br' },
    { key: 'notes', label: 'Observações',  type: 'text',  placeholder: 'Condições de pagamento, prazo...' },
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
