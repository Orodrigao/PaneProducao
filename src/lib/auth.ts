// src/lib/auth.ts — autenticacao PIN-based + Supabase Auth em paralelo

import { withTimeout } from '@/lib/supabaseRest'

export type Role = 'admin' | 'producao' | 'vendas' | 'estoque' | 'compras' | 'romaneio' | 'financeiro' | 'expedicao'
export type AuthProvider = 'pin' | 'email'

export interface AppUser {
  id: string
  username: string
  displayName: string
  pin: string
  role: Role
  active: boolean
  allowedRoutes: string[]
  store: string | null  // jc | ja | ex | null (admins sem loja física)
  email?: string
  authProvider?: AuthProvider
}

const SB_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const CACHE_KEY   = 'pane_users_cache'
const SESSION_KEY = 'pane_user_id'
const AUTH_PROFILE_CACHE_KEY = 'pane_auth_profile_cache'

const ROLES: readonly Role[] = ['admin', 'producao', 'vendas', 'estoque', 'compras', 'romaneio', 'financeiro', 'expedicao']

export const DEFAULT_ROUTES_BY_ROLE: Record<Role, string[]> = {
  admin:      ['/', '/sobras', '/fechamento-caixa', '/romaneio', '/estoque-congelado', '/estoque-paes', '/compras', '/cotacoes', '/fornecedores', '/estoque', '/produtos', '/clientes', '/tabelas-preco', '/pedidos-pj', '/encomendas', '/simulador-desconto', '/admin/usuarios', '/relatorios', '/relatorios/sobras-descartes'],
  producao:   ['/', '/sobras', '/forno', '/estoque-paes'],
  vendas:     ['/', '/sobras', '/fechamento-caixa', '/romaneio'],
  estoque:    ['/', '/estoque-congelado', '/estoque'],
  compras:    ['/compras', '/cotacoes', '/fornecedores', '/estoque', '/produtos', '/estoque-paes'],
  romaneio:   ['/romaneio'],
  financeiro: ['/', '/sobras', '/fechamento-caixa', '/compras', '/cotacoes', '/fornecedores', '/estoque-congelado', '/estoque', '/romaneio', '/estoque-paes', '/clientes', '/tabelas-preco', '/pedidos-pj', '/encomendas', '/simulador-desconto', '/relatorios'],
  expedicao:  ['/', '/sobras', '/estoque-congelado', '/estoque', '/romaneio'],
}

export const USERS_FALLBACK: AppUser[] = [
  { id: 'fb1', username: 'rodrigo',   displayName: 'Rodrigo',    pin: '1234', role: 'admin',    active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.admin,    store: null },
  { id: 'fb2', username: 'suelen',    displayName: 'Suelen',     pin: '1111', role: 'admin',    active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.admin,    store: null },
  { id: 'fb3', username: 'producao1', displayName: 'Producao 1', pin: '2222', role: 'producao', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.producao, store: 'jc' },
  { id: 'fb4', username: 'producao2', displayName: 'Producao 2', pin: '3333', role: 'producao', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.producao, store: 'jc' },
  { id: 'fb5', username: 'vendas1',   displayName: 'Vendas 1',   pin: '4444', role: 'vendas',   active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.vendas,   store: 'jc' },
  { id: 'fb6', username: 'estoque1',  displayName: 'Estoque 1',  pin: '5555', role: 'estoque',  active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.estoque,  store: 'jc' },
  { id: 'fb7', username: 'compras1',  displayName: 'Compras 1',  pin: '6666', role: 'compras',  active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.compras,  store: 'jc' },
  { id: 'fb8', username: 'romaneio1', displayName: 'Romaneio 1', pin: '7777', role: 'romaneio', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.romaneio, store: 'ja' },
]

interface SBUser {
  id: string
  name: string
  display_name: string
  pin: string
  role: Role
  active: boolean
  routes: string[] | null
  store: string | null
}

interface AppProfileRow {
  user_id: string
  display_name: string
  role: string
  active: boolean
  allowed_routes: unknown
  store: string | null
}

export interface AuthActionResult {
  ok: boolean
  message: string
  user?: AppUser
}

export const PASSWORD_MIN_LENGTH = 10

export interface PasswordPolicyRule {
  id: string
  label: string
  valid: boolean
}

const COMMON_WEAK_PASSWORDS = new Set([
  '1234567890',
  '123456789',
  '12345678',
  'senha123',
  'senha1234',
  'senha12345',
  'senha123!',
  'senha1234!',
  'password1',
  'password123',
  'qwerty123',
  'admin123',
])

const SEQUENTIAL_PATTERNS = [
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  'abcdef',
  'qwerty',
  'asdfgh',
]

function isRole(value: string): value is Role {
  return ROLES.includes(value as Role)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function normalizeEmailInput(email: string): string {
  return email.trim().toLowerCase()
}

export function passwordPolicyChecklist(password: string): PasswordPolicyRule[] {
  return [
    {
      id: 'length',
      label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
      valid: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'case',
      label: 'Letras maiúsculas e minúsculas',
      valid: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    {
      id: 'number',
      label: 'Pelo menos um número',
      valid: /\d/.test(password),
    },
    {
      id: 'symbol',
      label: 'Pelo menos um símbolo',
      valid: /[^A-Za-z0-9]/.test(password),
    },
  ]
}

function hasSequentialPattern(password: string): boolean {
  const normalized = password.toLowerCase()
  return SEQUENTIAL_PATTERNS.some(pattern => normalized.includes(pattern))
}

function isCommonWeakPassword(password: string): boolean {
  const normalized = password.toLowerCase()
  return COMMON_WEAK_PASSWORDS.has(normalized)
    || normalized.includes('pane')
    || normalized.includes('salute')
    || /^senha\d*!?$/.test(normalized)
    || /^password\d*!?$/.test(normalized)
}

export function validatePasswordSetup(password: string, confirmation: string): AuthActionResult {
  if (!password) return { ok: false, message: 'Informe a senha.' }

  const missingRules = passwordPolicyChecklist(password).filter(rule => !rule.valid)
  if (missingRules.length > 0) {
    return { ok: false, message: `Senha fraca. Faltou: ${missingRules.map(rule => rule.label.toLowerCase()).join(', ')}.` }
  }
  if (isCommonWeakPassword(password)) {
    return { ok: false, message: 'Senha muito fácil de adivinhar. Evite 1234, senha, password, Pane e Salute.' }
  }
  if (/(.)\1{3,}/.test(password)) {
    return { ok: false, message: 'Senha muito repetitiva. Evite repetir o mesmo caractere muitas vezes.' }
  }
  if (hasSequentialPattern(password)) {
    return { ok: false, message: 'Senha muito sequencial. Evite sequências como 123456 ou qwerty.' }
  }
  if (password !== confirmation) {
    return { ok: false, message: 'As senhas não conferem.' }
  }
  return { ok: true, message: 'Senha válida.' }
}

export function passwordRecoveryErrorMessage(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 429
  ) {
    return 'Limite de e-mails atingido. Aguarde até uma hora antes de pedir outro link. Enquanto isso, use o PIN.'
  }

  return 'Não foi possível enviar o link. Confira o e-mail ou use o PIN.'
}

function profileToAppUser(profile: AppProfileRow, email: string): AppUser | null {
  if (!isRole(profile.role)) return null

  return {
    id: profile.user_id,
    username: email || profile.display_name,
    displayName: profile.display_name,
    pin: '',
    role: profile.role,
    active: profile.active,
    allowedRoutes: isStringArray(profile.allowed_routes) && profile.allowed_routes.length > 0
      ? profile.allowed_routes
      : (DEFAULT_ROUTES_BY_ROLE[profile.role] ?? []),
    store: profile.store ?? null,
    email: email || undefined,
    authProvider: 'email',
  }
}

export async function fetchUsersFromSupabase(): Promise<AppUser[] | null> {
  try {
    const res = await withTimeout(fetch(SB_URL + '/rest/v1/app_users?select=*&order=display_name.asc', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    }))
    if (!res.ok) return null
    const rows: SBUser[] = await res.json()
    return rows.map(r => ({
      id: r.id, username: r.name, displayName: r.display_name,
      pin: r.pin, role: r.role, active: r.active,
      allowedRoutes: (Array.isArray(r.routes) && r.routes.length > 0)
        ? r.routes
        : (DEFAULT_ROUTES_BY_ROLE[r.role] ?? []),
      store: r.store ?? null,
      authProvider: 'pin',
    }))
  } catch { return null }
}

// Slugifica username pra gerar id estável (lowercase, sem acento, sem espaço).
function slugifyUserId(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export async function createUserInSupabase(
  user: Omit<AppUser, 'id'> & { allowedRoutes?: string[] }
): Promise<boolean> {
  try {
    const id = slugifyUserId(user.username)
    if (!id) return false
    const body = {
      id,
      name: user.username,
      display_name: user.displayName,
      pin: user.pin,
      role: user.role,
      active: user.active,
      routes: user.allowedRoutes && user.allowedRoutes.length > 0 ? user.allowedRoutes : null,
      store: user.store ?? null,
    }
    const res = await fetch(SB_URL + '/rest/v1/app_users', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch { return false }
}

export async function updateUserInSupabase(
  id: string,
  updates: Partial<Pick<AppUser, 'pin' | 'active' | 'role' | 'displayName' | 'allowedRoutes' | 'store'>>
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {}
    if (updates.pin           !== undefined) body.pin          = updates.pin
    if (updates.active        !== undefined) body.active       = updates.active
    if (updates.role          !== undefined) body.role         = updates.role
    if (updates.displayName   !== undefined) body.display_name = updates.displayName
    if (updates.allowedRoutes !== undefined) body.routes       = updates.allowedRoutes
    if (updates.store         !== undefined) body.store        = updates.store
    const res = await fetch(SB_URL + '/rest/v1/app_users?id=eq.' + id, {
      method: 'PATCH',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch { return false }
}

export function cacheUsers(users: AppUser[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(CACHE_KEY, JSON.stringify(users))
}

export function cacheAuthUser(user: AppUser | null) {
  if (typeof window === 'undefined') return
  if (!user) {
    localStorage.removeItem(AUTH_PROFILE_CACHE_KEY)
    return
  }
  localStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(user))
}

export function getCachedAuthUser(): AppUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_PROFILE_CACHE_KEY)
    if (!raw) return null
    const user = JSON.parse(raw) as AppUser
    if (!user.active || user.allowedRoutes.length === 0) return null
    return user
  } catch { return null }
}

export function getCachedUsers(): AppUser[] {
  if (typeof window === 'undefined') return USERS_FALLBACK
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return USERS_FALLBACK
    return JSON.parse(raw) as AppUser[]
  } catch { return USERS_FALLBACK }
}

export function authenticate(user: AppUser) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_KEY, user.id)
}

export function getCurrentUser(): AppUser | null {
  if (typeof window === 'undefined') return null
  const authUser = getCachedAuthUser()
  if (authUser) return authUser

  const id = localStorage.getItem(SESSION_KEY)
  if (!id) return null
  const users = getCachedUsers()
  const user = users.find(u => u.id === id && u.active)
  if (!user) return null
  // Safety net: cache stale com allowedRoutes vazio (ex: usuário criado em deploy buggy
  // que não tinha a role no DEFAULT_ROUTES_BY_ROLE). Limpa sessão e força re-login.
  if (user.role !== 'admin' && user.allowedRoutes.length === 0) {
    localStorage.removeItem(SESSION_KEY)
    return null
  }
  return user
}

export async function fetchCurrentAuthUser(): Promise<AppUser | null> {
  if (typeof window === 'undefined') return null

  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: sessionData, error: sessionError } = await withTimeout(supabase.auth.getSession())

    if (sessionError || !sessionData.session?.user) {
      cacheAuthUser(null)
      return null
    }

    const authUser = sessionData.session.user
    const { data, error } = await withTimeout(supabase
      .from('app_profiles')
      .select('user_id, display_name, role, active, allowed_routes, store')
      .eq('user_id', authUser.id)
      .maybeSingle())

    if (error || !data) {
      cacheAuthUser(null)
      return null
    }

    const user = profileToAppUser(data as AppProfileRow, authUser.email ?? '')
    if (!user || !user.active) {
      cacheAuthUser(null)
      return null
    }

    cacheAuthUser(user)
    return user
  } catch {
    return getCachedAuthUser()
  }
}

export async function getCurrentUserAsync(): Promise<AppUser | null> {
  const authUser = await fetchCurrentAuthUser()
  return authUser ?? getCurrentUser()
}

export async function signInWithEmailPassword(email: string, password: string): Promise<AuthActionResult> {
  const normalizedEmail = normalizeEmailInput(email)
  if (!normalizedEmail) {
    return { ok: false, message: 'Informe seu e-mail.' }
  }
  if (!password) {
    return { ok: false, message: 'Informe sua senha.' }
  }

  try {
    const { supabase } = await import('@/lib/supabase')
    const { error } = await withTimeout(supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    }))

    if (error) {
      return { ok: false, message: 'E-mail ou senha inválidos.' }
    }

    const user = await fetchCurrentAuthUser()
    if (!user) {
      await supabase.auth.signOut()
      cacheAuthUser(null)
      return { ok: false, message: 'Seu acesso ao ERP não está ativo.' }
    }

    return { ok: true, message: 'Entrada confirmada.', user }
  } catch {
    return { ok: false, message: 'Falha ao entrar. Use o PIN e tente novamente depois.' }
  }
}

export async function sendPasswordSetupLink(email: string): Promise<AuthActionResult> {
  const normalizedEmail = normalizeEmailInput(email)
  if (!normalizedEmail) {
    return { ok: false, message: 'Informe seu e-mail.' }
  }

  try {
    const { supabase } = await import('@/lib/supabase')
    const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/login?mode=senha`,
    }))

    if (error) {
      return { ok: false, message: passwordRecoveryErrorMessage(error) }
    }

    return { ok: true, message: 'Link enviado. Abra seu e-mail para criar ou trocar a senha.' }
  } catch {
    return { ok: false, message: 'Falha ao enviar o link. Use o PIN e tente novamente depois.' }
  }
}

export async function updateCurrentUserPassword(password: string, confirmation: string): Promise<AuthActionResult> {
  const validation = validatePasswordSetup(password, confirmation)
  if (!validation.ok) return validation

  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: sessionData, error: sessionError } = await withTimeout(supabase.auth.getSession())

    if (sessionError || !sessionData.session) {
      return { ok: false, message: 'Link expirado. Peça um novo acesso.' }
    }

    const { error } = await withTimeout(supabase.auth.updateUser({ password }))
    if (error) {
      return { ok: false, message: 'Não foi possível salvar a senha.' }
    }

    const user = await fetchCurrentAuthUser()
    if (!user) {
      return { ok: false, message: 'Senha criada, mas o perfil ERP não está ativo.' }
    }

    return { ok: true, message: 'Senha criada. Entrando...', user }
  } catch {
    return { ok: false, message: 'Falha ao salvar a senha. Peça um novo acesso.' }
  }
}

export function logout() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(AUTH_PROFILE_CACHE_KEY)
  void import('@/lib/supabase')
    .then(({ supabase }) => supabase.auth.signOut())
    .catch(() => undefined)
}

export function canAccess(user: AppUser, pathname: string): boolean {
  if (user.role === 'admin') return true
  return user.allowedRoutes.some(route =>
    route === pathname || (route !== '/' && pathname.startsWith(route + '/'))
  )
}

export function firstAllowedRoute(user: AppUser): string {
  return user.allowedRoutes[0] ?? '/login'
}

export function roleLabel(role: Role): string {
  const map: Record<Role, string> = {
    admin: 'Administrador', producao: 'Producao', vendas: 'Vendas',
    estoque: 'Estoque', compras: 'Compras', romaneio: 'Romaneio',
    financeiro: 'Financeiro', expedicao: 'Expedicao',
  }
  return map[role] ?? role
}

export function roleColor(role: Role): string {
  const map: Record<Role, string> = {
    admin: '#7c3aed', producao: '#d97706', vendas: '#059669',
    estoque: '#2563eb', compras: '#dc2626', romaneio: '#0891b2',
    financeiro: '#0a6e52', expedicao: '#1a6e8a',
  }
  return map[role] ?? '#6b7280'
}
