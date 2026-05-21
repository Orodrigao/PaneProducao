'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AppUser, Role,
  fetchUsersFromSupabase, cacheUsers, getCachedUsers,
  createUserInSupabase, updateUserInSupabase,
  getCurrentUser, roleLabel, roleColor,
  DEFAULT_ROUTES_BY_ROLE,
} from '@/lib/auth'

const ALL_ROLES: Role[] = ['admin', 'producao', 'vendas', 'estoque', 'compras', 'romaneio', 'financeiro', 'expedicao']

const ROUTE_OPTIONS = [
  { href: '/',                  label: 'Produção',          icon: '🍞' },
  { href: '/sobras',            label: 'Sobras',            icon: '♻️' },
  { href: '/romaneio',          label: 'Romaneio',          icon: '🚚' },
  { href: '/estoque-congelado', label: 'Congelado',         icon: '🧊' },
  { href: '/compras',           label: 'Lista de Compras',  icon: '🛒' },
  { href: '/estoque',           label: 'Estoque',           icon: '📊' },
  { href: '/produtos',          label: 'Produtos',          icon: '📦' },
  { href: '/admin/usuarios',    label: 'Admin (usuários)',  icon: '⚙️' },
  { href: '/relatorios',                  label: 'Relatórios (acesso)',  icon: '📈' },
  { href: '/relatorios/sobras-descartes', label: '└ Sobras & Descartes', icon: '♻️' },
]

// ---- Modal de PIN ----
function PinModal({ user, onClose, onSave }: { user: AppUser; onClose: () => void; onSave: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')

  function handleSave() {
    if (pin.length < 4) return setErr('PIN deve ter 4 dígitos')
    if (pin !== confirm) return setErr('PINs não conferem')
    onSave(pin)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '300px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>Trocar PIN — {user.displayName}</h3>
        <input type="password" inputMode="numeric" maxLength={4} placeholder="Novo PIN (4 dígitos)" value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g,'')); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px', boxSizing: 'border-box', fontSize: '1rem' }} />
        <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirmar PIN" value={confirm}
          onChange={e => { setConfirm(e.target.value.replace(/\D/g,'')); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px', boxSizing: 'border-box', fontSize: '1rem' }} />
        {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: '0 0 10px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSave} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ---- Modal de novo usuário ----
function NewUserModal({ onClose, onSave }: { onClose: () => void; onSave: (u: Omit<AppUser, 'id'> & { allowedRoutes: string[] }) => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', pin: '', role: 'producao' as Role, active: true })
  const [routes, setRoutes] = useState<string[]>(DEFAULT_ROUTES_BY_ROLE.producao)
  const [err, setErr] = useState('')

  function setRole(r: Role) {
    setForm(f => ({ ...f, role: r }))
    setRoutes(DEFAULT_ROUTES_BY_ROLE[r] ?? [])
    setErr('')
  }

  function toggleRoute(r: string) {
    setRoutes(curr => curr.includes(r) ? curr.filter(x => x !== r) : [...curr, r])
  }

  function handleSave() {
    if (!form.username || !form.displayName) return setErr('Preencha nome de usuário e nome de exibição')
    if (form.pin.length < 4) return setErr('PIN deve ter 4 dígitos')
    if (routes.length === 0) return setErr('Selecione pelo menos uma rota')
    onSave({ ...form, allowedRoutes: routes })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', width: '360px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>Novo Usuário</h3>

        <input type="text" placeholder="Username (login)" value={form.username}
          onChange={e => { setForm(f => ({ ...f, username: e.target.value })); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px', boxSizing: 'border-box' }} />
        <input type="text" placeholder="Nome de exibição" value={form.displayName}
          onChange={e => { setForm(f => ({ ...f, displayName: e.target.value })); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px', boxSizing: 'border-box' }} />
        <input type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 dígitos)" value={form.pin}
          onChange={e => { setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') })); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '12px', boxSizing: 'border-box' }} />

        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cargo</label>
        <select value={form.role} onChange={e => setRole(e.target.value as Role)}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '12px' }}>
          {ALL_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>

        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Acesso a módulos (pré-marcado pelos defaults da role)</label>
        <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '8px 10px', marginBottom: '12px' }}>
          {ROUTE_OPTIONS.map(opt => (
            <label key={opt.href} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={routes.includes(opt.href)} onChange={() => toggleRoute(opt.href)} />
              <span>{opt.icon} {opt.label}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem' }}>{opt.href}</span>
            </label>
          ))}
        </div>

        {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: '0 0 10px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSave} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Criar</button>
        </div>
      </div>
    </div>
  )
}

// ---- Modal de edição ----
function EditUserModal({ user, onClose, onSave }: { user: AppUser; onClose: () => void; onSave: (updates: { role: Role; displayName: string; allowedRoutes: string[] }) => void }) {
  const [role, setRole] = useState<Role>(user.role)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [routes, setRoutes] = useState<string[]>(user.allowedRoutes)
  const [err, setErr] = useState('')

  function toggleRoute(r: string) {
    setRoutes(curr => curr.includes(r) ? curr.filter(x => x !== r) : [...curr, r])
  }

  function applyRoleDefaults() {
    setRoutes(DEFAULT_ROUTES_BY_ROLE[role] ?? [])
  }

  function handleSave() {
    if (!displayName.trim()) return setErr('Nome de exibição não pode estar vazio')
    if (routes.length === 0) return setErr('Selecione pelo menos uma rota')
    onSave({ role, displayName: displayName.trim(), allowedRoutes: routes })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', width: '360px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Editar — {user.displayName}</h3>
        <p style={{ margin: '0 0 14px', fontSize: '0.72rem', color: 'var(--muted)' }}>id: <code>{user.id}</code> · username: @{user.username}</p>

        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome de exibição</label>
        <input type="text" value={displayName} onChange={e => { setDisplayName(e.target.value); setErr('') }}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '12px', boxSizing: 'border-box' }} />

        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cargo</label>
        <select value={role} onChange={e => setRole(e.target.value as Role)}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '12px' }}>
          {ALL_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Acesso a módulos</label>
          <button type="button" onClick={applyRoleDefaults} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline' }}>
            Usar padrão da role
          </button>
        </div>
        <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '8px 10px', marginBottom: '12px' }}>
          {ROUTE_OPTIONS.map(opt => (
            <label key={opt.href} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={routes.includes(opt.href)} onChange={() => toggleRoute(opt.href)} />
              <span>{opt.icon} {opt.label}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem' }}>{opt.href}</span>
            </label>
          ))}
        </div>

        {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: '0 0 10px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSave} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ---- Página principal ----
export default function AdminUsuariosPage() {
  const router = useRouter()
  const [users, setUsers]           = useState<AppUser[]>([])
  const [loading, setLoading]       = useState(true)
  const [pinModal, setPinModal]     = useState<AppUser | null>(null)
  const [newModal, setNewModal]     = useState(false)
  const [editModal, setEditModal]   = useState<AppUser | null>(null)
  const [msg, setMsg]               = useState('')

  useEffect(() => {
    const me = getCurrentUser()
    if (!me || me.role !== 'admin') { router.replace('/'); return }
    loadUsers()
  }, [router])

  async function loadUsers() {
    setLoading(true)
    const remote = await fetchUsersFromSupabase()
    const list = remote ?? getCachedUsers()
    if (remote) cacheUsers(remote)
    setUsers(list)
    setLoading(false)
  }

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(''), 2500)
  }

  async function handlePinSave(user: AppUser, newPin: string) {
    const ok = await updateUserInSupabase(user.id, { pin: newPin })
    if (ok) {
      const updated = users.map(u => u.id === user.id ? { ...u, pin: newPin } : u)
      setUsers(updated); cacheUsers(updated)
      flash('PIN atualizado!')
    } else flash('Erro ao atualizar PIN')
    setPinModal(null)
  }

  async function handleToggle(user: AppUser) {
    const newActive = !user.active
    const ok = await updateUserInSupabase(user.id, { active: newActive })
    if (ok) {
      const updated = users.map(u => u.id === user.id ? { ...u, active: newActive } : u)
      setUsers(updated); cacheUsers(updated)
      flash(newActive ? 'Usuário ativado' : 'Usuário desativado')
    } else flash('Erro ao atualizar')
  }

  async function handleCreate(data: Omit<AppUser, 'id'> & { allowedRoutes: string[] }) {
    const ok = await createUserInSupabase(data)
    if (ok) { await loadUsers(); flash('Usuário criado!') }
    else flash('Erro ao criar usuário (username pode já existir)')
    setNewModal(false)
  }

  async function handleEdit(user: AppUser, updates: { role: Role; displayName: string; allowedRoutes: string[] }) {
    const ok = await updateUserInSupabase(user.id, updates)
    if (ok) {
      const updated = users.map(u => u.id === user.id ? { ...u, ...updates } : u)
      setUsers(updated); cacheUsers(updated)
      flash('Usuário atualizado!')
    } else flash('Erro ao atualizar')
    setEditModal(null)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><p>Carregando...</p></div>

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Usuários</h1>
        <button onClick={() => setNewModal(true)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
          + Novo
        </button>
      </div>

      {msg && <div style={{ background: '#d1fae5', color: '#065f46', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {users.map(user => (
          <div key={user.id} style={{
            background: 'white', borderRadius: '12px', padding: '14px 16px',
            border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px',
            opacity: user.active ? 1 : 0.55,
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
              background: roleColor(user.role), display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: '1rem',
            }}>
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{user.displayName}</div>
              <div style={{ fontSize: '0.75rem', color: roleColor(user.role) }}>{roleLabel(user.role)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>@{user.username}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button onClick={() => setPinModal(user)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>
                PIN
              </button>
              <button onClick={() => setEditModal(user)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>
                Editar
              </button>
              <button onClick={() => handleToggle(user)}
                style={{
                  padding: '6px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                  background: user.active ? '#fee2e2' : '#d1fae5', color: user.active ? '#dc2626' : '#065f46',
                }}>
                {user.active ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {pinModal && <PinModal user={pinModal} onClose={() => setPinModal(null)} onSave={pin => handlePinSave(pinModal, pin)} />}
      {newModal && <NewUserModal onClose={() => setNewModal(false)} onSave={handleCreate} />}
      {editModal && <EditUserModal user={editModal} onClose={() => setEditModal(null)} onSave={updates => handleEdit(editModal, updates)} />}
    </div>
  )
}
