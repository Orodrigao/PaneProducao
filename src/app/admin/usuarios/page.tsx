'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, X, KeyRound, Pencil, Power, Search, SlidersHorizontal } from 'lucide-react'
import {
  AppUser, Role,
  fetchUsersFromSupabase, cacheUsers, getCachedUsers,
  createUserInSupabase, updateUserInSupabase,
  getCurrentUser, roleLabel, roleColor,
  DEFAULT_ROUTES_BY_ROLE,
} from '@/lib/auth'

const ALL_ROLES: Role[] = ['admin', 'producao', 'vendas', 'estoque', 'compras', 'romaneio', 'financeiro', 'expedicao']
type StatusFilter = 'todos' | 'ativos' | 'inativos'
type StoreFilter = 'todas' | 'global' | 'jc' | 'ja' | 'ex'

const ROUTE_OPTIONS = [
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

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'ativos', label: 'Ativos' },
  { value: 'inativos', label: 'Inativos' },
]

const STORE_FILTERS: { value: StoreFilter; label: string }[] = [
  { value: 'todas', label: 'Todas as lojas' },
  { value: 'global', label: 'Global' },
  { value: 'jc', label: 'JC' },
  { value: 'ja', label: 'JA' },
  { value: 'ex', label: 'EX' },
]

function storeLabel(store: string | null) {
  if (store === 'jc') return 'JC'
  if (store === 'ja') return 'JA'
  if (store === 'ex') return 'EX'
  return 'Global'
}

function storeChipClass(store: string | null) {
  if (store === 'jc' || store === 'ja' || store === 'ex') return store
  return 'separado'
}

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
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [roleFilter, setRoleFilter] = useState<Role | 'todas'>('todas')
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('todas')

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

  const activeCount = useMemo(() => users.filter(user => user.active).length, [users])
  const inactiveCount = users.length - activeCount

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return users.filter(user => {
      const searchable = [
        user.displayName,
        user.username,
        roleLabel(user.role),
        user.role,
        storeLabel(user.store),
      ].join(' ').toLowerCase()
      const matchesSearch = needle.length === 0 || searchable.includes(needle)
      const matchesStatus =
        statusFilter === 'todos' ||
        (statusFilter === 'ativos' && user.active) ||
        (statusFilter === 'inativos' && !user.active)
      const matchesRole = roleFilter === 'todas' || user.role === roleFilter
      const matchesStore =
        storeFilter === 'todas' ||
        (storeFilter === 'global' && !user.store) ||
        user.store === storeFilter

      return matchesSearch && matchesStatus && matchesRole && matchesStore
    })
  }, [roleFilter, search, statusFilter, storeFilter, users])

  function clearFilters() {
    setSearch('')
    setStatusFilter('todos')
    setRoleFilter('todas')
    setStoreFilter('todas')
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
          <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginTop:14, marginBottom:12, gap:12}}>
            <div style={{minWidth:0}}>
              <h1 className="ps-page-title" style={{margin:0, fontSize:26}}>Usuários</h1>
              <p style={{margin:'3px 0 0', fontSize:12.5, color:'var(--ink-soft)', lineHeight:1.35}}>
                Login atual por PIN. Supabase Auth será preparado em etapa separada.
              </p>
            </div>
            <button onClick={() => setNewModal(true)} className="ps-btn primary" style={{minHeight:42}}>
              <Plus size={15}/> Novo
            </button>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8, marginBottom:12}}>
            <div style={{background:'var(--cream)', border:'1px solid var(--ps-line)', borderRadius:'var(--r-ctrl)', padding:'10px 11px'}}>
              <div className="ps-fieldlabel">Total</div>
              <div style={{fontSize:22, fontWeight:800, color:'var(--ps-ink)', lineHeight:1.1}}>{users.length}</div>
            </div>
            <div style={{background:'#E3F0E0', border:'1px solid #C5D5BA', borderRadius:'var(--r-ctrl)', padding:'10px 11px'}}>
              <div className="ps-fieldlabel" style={{color:'var(--sage)'}}>Ativos</div>
              <div style={{fontSize:22, fontWeight:800, color:'var(--sage)', lineHeight:1.1}}>{activeCount}</div>
            </div>
            <div style={{background:'var(--berry-tint)', border:'1px solid #E6B5AC', borderRadius:'var(--r-ctrl)', padding:'10px 11px'}}>
              <div className="ps-fieldlabel" style={{color:'var(--berry)'}}>Inativos</div>
              <div style={{fontSize:22, fontWeight:800, color:'var(--berry)', lineHeight:1.1}}>{inactiveCount}</div>
            </div>
          </div>

          <div style={{border:'1px solid var(--ps-line)', borderRadius:'var(--r-card)', background:'color-mix(in srgb, var(--cream) 80%, var(--flour))', padding:12, marginBottom:12, boxShadow:'var(--sh-1)'}}>
            <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:10, color:'var(--ink-soft)', fontSize:12, fontWeight:700}}>
              <SlidersHorizontal size={14}/> Encontrar usuário
              <span style={{marginLeft:'auto', color:'var(--ink-faint)', fontWeight:700}}>{filteredUsers.length} exibidos</span>
            </div>

            <div style={{position:'relative', marginBottom:10}}>
              <Search size={16} style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
              <input
                className="ps-input"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar por nome, login, cargo ou loja"
                style={{width:'100%', paddingLeft:36, paddingRight: search ? 36 : 12}}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Limpar busca"
                  style={{position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', width:28, height:28, border:0, borderRadius:8, background:'transparent', color:'var(--ink-faint)', display:'grid', placeItems:'center', cursor:'pointer'}}
                >
                  <X size={16}/>
                </button>
              )}
            </div>

            <div style={{display:'flex', gap:6, overflowX:'auto', paddingBottom:2, marginBottom:10}}>
              {STATUS_FILTERS.map(filter => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={statusFilter === filter.value ? 'ps-btn primary sm' : 'ps-btn ghost sm'}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as Role | 'todas')} className="ps-select" aria-label="Filtrar por cargo">
                <option value="todas">Todos os cargos</option>
                {ALL_ROLES.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </select>
              <select value={storeFilter} onChange={event => setStoreFilter(event.target.value as StoreFilter)} className="ps-select" aria-label="Filtrar por loja">
                {STORE_FILTERS.map(store => <option key={store.value} value={store.value}>{store.label}</option>)}
              </select>
            </div>
          </div>

          {msg && (
            <div className="ps-banner crust" style={{marginBottom:14}}>{msg}</div>
          )}

          {filteredUsers.length === 0 ? (
            <div className="ps-empty" style={{padding:'34px 12px'}}>
              Nenhum usuário encontrado.
              <button type="button" onClick={clearFilters} className="ps-btn ghost sm" style={{margin:'12px auto 0'}}>
                Limpar filtros
              </button>
            </div>
          ) : (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(244px, 1fr))', gap:10}}>
              {filteredUsers.map(user => (
                <div key={user.id} className="ps-card" style={{padding:'12px 13px', gap:10, opacity: user.active ? 1 : 0.62}}>
                  <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
                    <div className="ps-avatar" style={{width:38, height:38, fontSize:15, background:roleColor(user.role)}}>
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:800, fontSize:14.5, color:'var(--ps-ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{user.displayName}</div>
                      <div style={{fontSize:11.5, color:'var(--ink-faint)', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>@{user.username}</div>
                    </div>
                    <span className={user.active ? 'ps-status ok' : 'ps-status com_divergencia'} style={{fontSize:9.5, padding:'2px 7px'}}>
                      {user.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    <span className="ps-status separado" style={{fontSize:10, textTransform:'none', letterSpacing:0, color:roleColor(user.role)}}>
                      {roleLabel(user.role)}
                    </span>
                    <span className={user.store ? `ps-store-chip ${storeChipClass(user.store)}` : 'ps-status separado'} style={{fontSize:10}}>
                      {storeLabel(user.store)}
                    </span>
                    <span className="ps-status separado" style={{fontSize:10, textTransform:'none', letterSpacing:0}}>
                      {user.allowedRoutes.length} módulos
                    </span>
                  </div>

                  <div style={{display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:6}}>
                    <button onClick={() => setPinModal(user)} className="ps-btn ghost sm" aria-label={`Trocar PIN de ${user.displayName}`}>
                      <KeyRound size={12}/> PIN
                    </button>
                    <button onClick={() => setEditModal(user)} className="ps-btn ghost sm" aria-label={`Editar ${user.displayName}`}>
                      <Pencil size={12}/> Editar
                    </button>
                    <button onClick={() => handleToggle(user)} className={`ps-btn sm ${user.active ? 'danger' : 'success'}`} aria-label={user.active ? `Desativar ${user.displayName}` : `Ativar ${user.displayName}`}>
                      <Power size={12}/> {user.active ? 'Off' : 'On'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pinModal && <PinModal user={pinModal} onClose={() => setPinModal(null)} onSave={pin => handlePinSave(pinModal, pin)} />}
      {newModal && <NewUserModal onClose={() => setNewModal(false)} onSave={handleCreate} />}
      {editModal && <EditUserModal user={editModal} onClose={() => setEditModal(null)} onSave={updates => handleEdit(editModal, updates)} />}
    </div>
  )
}
