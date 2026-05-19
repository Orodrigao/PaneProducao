'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'
import Link from 'next/link'

const ADMIN_PWD = 'pane2025'

interface Supplier {
  id: string; name: string; cnpj: string | null; phone: string | null
  email: string | null; notes: string | null; active: boolean
}

const emptyForm = { name: '', cnpj: '', phone: '', email: '', notes: '' }

export default function FornecedoresPage() {
  const [auth, setAuth]         = useState(false)
  const [pwd, setPwd]           = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Supplier | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [saving, setSaving]     = useState(false)
  const [search, setSearch]     = useState('')

  const login = () => {
    if (pwd === ADMIN_PWD) setAuth(true)
    else { showToast('Senha incorreta'); setPwd('') }
  }

  const load = async () => {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers(data || [])
  }

  useEffect(() => { if (auth) load() }, [auth])

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
    { key: 'phone', label: 'Telefone',      type: 'tel',   placeholder: '(54) 9 9999-9999' },
    { key: 'email', label: 'E-mail',        type: 'email', placeholder: 'contato@fornecedor.com.br' },
    { key: 'notes', label: 'Observações',   type: 'text',  placeholder: 'Condições de pagamento, prazo...' },
  ] as const

  if (!auth) {
    return (
      <div className="login-page">
        <div className="login-logo">
          <h1>Pane &amp; Salute</h1>
          <p style={{ fontSize: '11px', color: 'var(--text-hint)', letterSpacing: '3px', textTransform: 'uppercase', marginTop: '6px' }}>FORNECEDORES</p>
        </div>
        <div className="login-card" style={{ padding: '24px' }}>
          <input
            type="password" placeholder="Senha de acesso" value={pwd}
            onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()}
            style={{ width: '100%', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '15px', marginBottom: '12px', outline: 'none' }}
          />
          <button onClick={login} style={{ width: '100%', padding: '13px', background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
            Entrar
          </button>
        </div>
      </div>
    )
  }

  const SupplierCard = ({ s }: { s: Supplier }) => (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '14px', marginBottom: '8px', opacity: s.active ? 1 : 0.55,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{s.name}</div>
          {s.cnpj  && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>CNPJ: {s.cnpj}</div>}
          {s.phone && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📞 {s.phone}</div>}
          {s.email && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>✉️ {s.email}</div>}
          {s.notes && <div style={{ fontSize: '12px', color: 'var(--text-hint)', fontStyle: 'italic', marginTop: '3px' }}>{s.notes}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0 }}>
          <button onClick={() => openEdit(s)}
            style={{ fontSize: '12px', padding: '5px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>
            Editar
          </button>
          <button onClick={() => toggleActive(s)}
            style={{ fontSize: '12px', padding: '5px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', color: s.active ? 'var(--coral)' : 'var(--teal)' }}>
            {s.active ? 'Inativar' : 'Ativar'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div id="app">
      <div className="topbar">
        <Link href="/estoque" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--text-muted)', padding: '0 8px 0 0', lineHeight: 1, textDecoration: 'none' }}>←</Link>
        <span className="topbar-logo">Fornecedores</span>
        <button className="btn-logout" onClick={() => setAuth(false)}>Sair</button>
      </div>

      <div style={{ padding: '16px' }}>
        <input
          type="text" placeholder="🔍 Buscar fornecedor..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px', marginBottom: '12px', outline: 'none' }}
        />

        <button onClick={openNew} style={{ width: '100%', padding: '12px', background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', marginBottom: '16px' }}>
          + Novo fornecedor
        </button>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            {suppliers.length === 0 ? 'Nenhum fornecedor cadastrado.' : 'Nenhum resultado.'}
          </div>
        ) : (
          <>
            {active.map(s => <SupplierCard key={s.id} s={s} />)}
            {inactive.length > 0 && (
              <>
                <div style={{ fontSize: '11px', color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '16px', marginBottom: '8px' }}>Inativos</div>
                {inactive.map(s => <SupplierCard key={s.id} s={s} />)}
              </>
            )}
          </>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius) var(--radius) 0 0', padding: '20px 16px 28px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '16px' }}>
              {editing ? `Editar — ${editing.name}` : 'Novo fornecedor'}
            </div>
            {fields.map(f => (
              <div key={f.key} style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{f.label}</label>
                <input
                  type={f.type} placeholder={f.placeholder} value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px', outline: 'none' }}
                />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setShowForm(false)}
                style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', fontWeight: 500, fontSize: '14px' }}>
                Cancelar
              </button>
              <button onClick={saveSupplier} disabled={saving}
                style={{ padding: '12px', background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600, fontSize: '14px', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
