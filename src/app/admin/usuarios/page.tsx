'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, KeyRound, Pencil, Power } from 'lucide-react'
import {
  AppUser, Role,
  fetchUsersFromSupabase, cacheUsers, getCachedUsers,
  createUserInSupabase, updateUserInSupabase,
  getCurrentUser, roleLabel, roleColor,
  DEFAULT_ROUTES_BY_ROLE,
} from '@/lib/auth'

const ALL_ROLES: Role[] = ['admin', 'producao', 'vendas', 'estoque', 'compras', 'romaneio', 'financeiro', 'expedicao']

const ROUTE_OPTIONS = [
  { href: '/fechamento-caixa',  label: 'Fechamento de Caixa', icon: 'R$' },
  { href: '/',                  label: 'Produção',          icon: '🍞' },
  { href: '/forno',             label: 'Forno (confirmar)', icon: '🔥' },
  { href: '/sobras',            label: 'Sobras',            icon: '♻️' },
  { href: '/romaneio',          label: 'Romaneio',          icon: '🚚' },
  { href: '/estoque-congelado', label: 'Congelado',         icon: '🧊' },
  { href: '/estoque-paes',      label: 'Saldo Pães',        icon: '📊' },
  { href: '/compras',           label: 'Lista de Compras',  icon: '🛒' },
  { href: '/cotacoes',          label: 'Cotações',          icon: '📋' },
  { href: '/fornecedores',      label: 'Fornecedores',      icon: '🏭' },
  { href: '/estoque',           label: 'Estoque',           icon: '📊' },
  { href: '/produtos',          label: 'Produtos',          icon: '📦' },
  { href: '/clientes',          label: 'Clientes PJ',       icon: '👥' },
  { href: '/tabelas-preco',     label: 'Tabelas de Preço',  icon: '📋' },
  { href: '/pedidos-pj',        label: 'Pedidos PJ',        icon: '🧾' },
  { href: '/simulador-desconto',label: 'Simulador Desconto',icon: '✨' },
  { href: '/admin/usuarios',    label: 'Admin (usuários)',  icon: '⚙️' },
  { href: '/relatorios',                  label: 'Relatórios (acesso)',  icon: '📈' },
  { href: '/relatorios/sobras-descartes', label: '└ Sobras & Descartes', icon: '♻️' },
]

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
    <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="ps-sheet confirm" style={{maxWidth:320, borderRadius:'var(--r-card)'}}>
        <h3><KeyRound size={16} style={{verticalAlign:-2, marginRight:6}}/>Trocar PIN — {user.displayName}</h3>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <input type="password" inputMode="numeric" maxLength={4} placeholder="Novo PIN (4 dígitos)" value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g,'')); setErr('') }} className="ps-input" style={{textAlign:'center', fontSize:18}}/>
        </div>
        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirmar PIN" value={confirm}
            onChange={e => { setConfirm(e.target.value.replace(/\D/g,'')); setErr('') }} className="ps-input" style={{textAlign:'center', fontSize:18}}/>
        </div>
        {err && <p style={{color:'var(--berry)', fontSize:13, margin:'0 0 10px'}}>{err}</p>}

        <div className="actions">
          <button onClick={handleSave} className="ps-btn primary">
            <Save size={14}/> Salvar
          </button>
          <button onClick={onClose} className="ps-btn ghost">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function NewUserModal({ onClose, onSave }: { onClose: () => void; onSave: (u: Omit<AppUser, 'id'> & { allowedRoutes: string[] }) => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', pin: '', role: 'producao' as Role, active: true, store: null as string | null })
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
    <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="ps-sheet">
        <div className="ps-sheet-grab"/>
        <h3>+ Novo Usuário</h3>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Username (login)</div>
          <input type="text" value={form.username}
            onChange={e => { setForm(f => ({ ...f, username: e.target.value })); setErr('') }} className="ps-input"/>
        </div>
        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Nome de exibição</div>
          <input type="text" value={form.displayName}
            onChange={e => { setForm(f => ({ ...f, displayName: e.target.value })); setErr('') }} className="ps-input"/>
        </div>
        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">PIN (4 dígitos)</div>
          <input type="password" inputMode="numeric" maxLength={4} value={form.pin}
            onChange={e => { setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') })); setErr('') }} className="ps-input" style={{textAlign:'center', fontSize:18}}/>
        </div>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Cargo</div>
          <select value={form.role} onChange={e => setRole(e.target.value as Role)} className="ps-select">
            {ALL_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Loja física</div>
          <select value={form.store ?? ''} onChange={e => setForm(f => ({ ...f, store: e.target.value || null }))} className="ps-select">
            <option value="">(sem loja — admin/sem físico)</option>
            <option value="jc">JC — Júlio</option>
            <option value="ja">JA — Jardim América</option>
            <option value="ex">EX — Exposição</option>
          </select>
        </div>

        <div className="ps-fieldlabel" style={{marginBottom:6}}>Acesso a módulos (pré-marcado pelos defaults da role)</div>
        <div style={{background:'var(--line-soft)', borderRadius:'var(--r-ctrl)', padding:'8px 10px', marginBottom:12, maxHeight:200, overflowY:'auto'}}>
          {ROUTE_OPTIONS.map(opt => (
            <label key={opt.href} style={{display:'flex', alignItems:'center', gap:8, padding:'5px 0', cursor:'pointer', fontSize:13}}>
              <input type="checkbox" checked={routes.includes(opt.href)} onChange={() => toggleRoute(opt.href)}/>
              <span>{opt.icon} {opt.label}</span>
              <span style={{marginLeft:'auto', color:'var(--ink-faint)', fontSize:11}}>{opt.href}</span>
            </label>
          ))}
        </div>

        {err && <p style={{color:'var(--berry)', fontSize:13, margin:'0 0 10px'}}>{err}</p>}
        <div className="actions">
          <button onClick={handleSave} className="ps-btn primary">
            <Save size={14}/> Criar
          </button>
          <button onClick={onClose} className="ps-btn ghost">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function EditUserModal({ user, onClose, onSave }: { user: AppUser; onClose: () => void; onSave: (updates: { role: Role; displayName: string; allowedRoutes: string[]; store: string | null }) => void }) {
  const [role, setRole] = useState<Role>(user.role)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [routes, setRoutes] = useState<string[]>(user.allowedRoutes)
  const [store, setStore] = useState<string | null>(user.store ?? null)
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
    onSave({ role, displayName: displayName.trim(), allowedRoutes: routes, store })
  }

  return (
    <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="ps-sheet">
        <div className="ps-sheet-grab"/>
        <h3><Pencil size={14} style={{verticalAlign:-2, marginRight:6}}/>Editar — {user.displayName}</h3>
        <p style={{margin:'0 0 14px', fontSize:11, color:'var(--ink-faint)'}}>id: <code>{user.id}</code> · username: @{user.username}</p>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Nome de exibição</div>
          <input type="text" value={displayName} onChange={e => { setDisplayName(e.target.value); setErr('') }} className="ps-input"/>
        </div>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Cargo</div>
          <select value={role} onChange={e => setRole(e.target.value as Role)} className="ps-select">
            {ALL_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>

        <div className="ps-fieldgroup" style={{marginBottom:10}}>
          <div className="ps-fieldlabel">Loja física</div>
          <select value={store ?? ''} onChange={e => setStore(e.target.value || null)} className="ps-select">
            <option value="">(sem loja — admin/sem físico)</option>
            <option value="jc">JC — Júlio</option>
            <option value="ja">JA — Jardim América</option>
            <option value="ex">EX — Exposição</option>
          </select>
        </div>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
          <span className="ps-fieldlabel">Acesso a módulos</span>
          <button type="button" onClick={applyRoleDefaults} style={{background:'none', border:'none', color:'var(--crust)', cursor:'pointer', fontSize:11, textDecoration:'underline', fontFamily:'var(--font-ui)'}}>
            Usar padrão da role
          </button>
        </div>
        <div style={{background:'var(--line-soft)', borderRadius:'var(--r-ctrl)', padding:'8px 10px', marginBottom:12, maxHeight:200, overflowY:'auto'}}>
          {ROUTE_OPTIONS.map(opt => (
            <label key={opt.href} style={{display:'flex', alignItems:'center', gap:8, padding:'5px 0', cursor:'pointer', fontSize:13}}>
              <input type="checkbox" checked={routes.includes(opt.href)} onChange={() => toggleRoute(opt.href)}/>
              <span>{opt.icon} {opt.label}</span>
              <span style={{marginLeft:'auto', color:'var(--ink-faint)', fontSize:11}}>{opt.href}</span>
            </label>
          ))}
        </div>

        {err && <p style={{color:'var(--berry)', fontSize:13, margin:'0 0 10px'}}>{err}</p>}
        <div className="actions">
          <button onClick={handleSave} className="ps-btn primary">
            <Save size={14}/> Salvar
          </button>
          <button onClick={onClose} className="ps-btn ghost">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminUsuariosPage() {
  const router = useRouter()
  const [users, setUsers]           = useState<AppUser[]>([])
  const [me, setMe]                 = useState<AppUser | null>(null)
  const [loading, setLoading]       = useState(true)
  const [pinModal, setPinModal]     = useState<AppUser | null>(null)
  const [newModal, setNewModal]     = useState(false)
  const [editModal, setEditModal]   = useState<AppUser | null>(null)
  const [msg, setMsg]               = useState('')

  useEffect(() => {
    const u = getCurrentUser()
    if (!u || u.role !== 'admin') { router.replace('/'); return }
    setMe(u)
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

  async function handleEdit(user: AppUser, updates: { role: Role; displayName: string; allowedRoutes: string[]; store: string | null }) {
    const ok = await updateUserInSupabase(user.id, updates)
    if (ok) {
      const updated = users.map(u => u.id === user.id ? { ...u, ...updates } : u)
      setUsers(updated); cacheUsers(updated)
      flash('Usuário atualizado!')
    } else flash('Erro ao atualizar')
    setEditModal(null)
  }

  if (loading) return (
    <div className="ps-loading">
      <div className="ps-spinner"/>
      <p>Carregando...</p>
    </div>
  )

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Admin · Usuários</b>
              <span>Cadastro &amp; permissões</span>
            </div>
          </div>
          {me && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(me.role)}}>{me.displayName.charAt(0).toUpperCase()}</div>
              <b>{me.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:14, marginBottom:14, gap:10}}>
            <h1 className="ps-page-title" style={{margin:0}}>👥 Usuários ({users.length})</h1>
            <button onClick={() => setNewModal(true)} className="ps-btn primary">
              <Plus size={14}/> Novo
            </button>
          </div>

          {msg && (
            <div className="ps-banner crust" style={{marginBottom:14}}>{msg}</div>
          )}

          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {users.map(user => (
              <div key={user.id} className="ps-card" style={{padding:'12px 14px', flexDirection:'row', alignItems:'center', gap:12, opacity: user.active ? 1 : 0.55}}>
                <div className="ps-avatar" style={{width:42, height:42, fontSize:16, background:roleColor(user.role)}}>
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:700, fontSize:14.5, color:'var(--ps-ink)'}}>{user.displayName}</div>
                  <div style={{fontSize:12, color:roleColor(user.role), fontWeight:600}}>{roleLabel(user.role)}{user.store && ` · ${user.store.toUpperCase()}`}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>@{user.username}</div>
                </div>
                <div style={{display:'flex', gap:6, flexShrink:0, flexDirection:'column'}}>
                  <button onClick={() => setPinModal(user)} className="ps-btn ghost sm">
                    <KeyRound size={11}/> PIN
                  </button>
                  <button onClick={() => setEditModal(user)} className="ps-btn ghost sm">
                    <Pencil size={11}/> Editar
                  </button>
                  <button onClick={() => handleToggle(user)} className={`ps-btn sm ${user.active ? 'danger' : 'success'}`}>
                    <Power size={11}/> {user.active ? 'Off' : 'On'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {pinModal && <PinModal user={pinModal} onClose={() => setPinModal(null)} onSave={pin => handlePinSave(pinModal, pin)} />}
      {newModal && <NewUserModal onClose={() => setNewModal(false)} onSave={handleCreate} />}
      {editModal && <EditUserModal user={editModal} onClose={() => setEditModal(null)} onSave={updates => handleEdit(editModal, updates)} />}
    </div>
  )
}
