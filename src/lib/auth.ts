// src/lib/auth.ts — autenticacao por Supabase Auth

import { withTimeout } from '@/lib/supabaseRest'

export type Role = 'admin' | 'producao' | 'vendas' | 'estoque' | 'compras' | 'romaneio' | 'financeiro' | 'expedicao'
export interface AppUser {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  allowedRoutes: string[]
  store: string | null  // jc | ja | ex | null (admins sem loja física)
  email?: string
}

const AUTH_PROFILE_CACHE_KEY = 'pane_auth_profile_cache'
const LEGACY_AUTH_STORAGE_KEYS = ['pane_users_cache', 'pane_user_id']

const ROLES: readonly Role[] = ['admin', 'producao', 'vendas', 'estoque', 'compras', 'romaneio', 'financeiro', 'expedicao']

export const DEFAULT_ROUTES_BY_ROLE: Record<Role, string[]> = {
  admin:      ['/', '/sobras', '/fechamento-caixa', '/romaneio', '/estoque-congelado', '/estoque-paes', '/compras', '/cotacoes', '/fornecedores', '/estoque', '/produtos', '/clientes', '/tabelas-preco', '/pedidos-pj', '/encomendas', '/simulador-desconto', '/relatorios', '/relatorios/sobras-descartes'],
  producao:   ['/', '/sobras', '/forno', '/estoque-paes'],
  vendas:     ['/', '/sobras', '/fechamento-caixa', '/romaneio'],
  estoque:    ['/', '/estoque-congelado', '/estoque'],
  compras:    ['/compras', '/cotacoes', '/fornecedores', '/estoque', '/produtos', '/estoque-paes'],
  romaneio:   ['/romaneio'],
  financeiro: ['/', '/sobras', '/fechamento-caixa', '/compras', '/cotacoes', '/fornecedores', '/estoque-congelado', '/estoque', '/romaneio', '/estoque-paes', '/clientes', '/tabelas-preco', '/pedidos-pj', '/encomendas', '/simulador-desconto', '/relatorios'],
  expedicao:  ['/', '/sobras', '/estoque-congelado', '/estoque', '/romaneio'],
}

export interface AppProfileRow {
  user_id: string
  display_name: string
  role: string
  active: boolean
  allowed_routes: unknown
  store: string | null
}

export interface AppPermissionRow {
  permission_key: string
  scope: string
}

export function resolveAllowedRoutes(
  role: Role,
  store: string | null,
  baseRoutes: string[],
  permissions: readonly AppPermissionRow[],
): string[] {
  if (role === 'admin') return baseRoutes

  const canAccessPjOrders = permissions.some(permission =>
    permission.permission_key === 'pedidos_pj.acessar'
    && (permission.scope === '*' || permission.scope === store),
  )

  if (!canAccessPjOrders) return baseRoutes.filter(route => route !== '/pedidos-pj')
  if (baseRoutes.includes('/pedidos-pj')) return baseRoutes
  return [...baseRoutes, '/pedidos-pj']
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
    return 'Limite de e-mails atingido. Aguarde até uma hora antes de pedir outro link.'
  }

  return 'Não foi possível enviar o link. Confira o e-mail e tente novamente.'
}

export function buildAppUser(
  profile: AppProfileRow,
  email: string,
  permissions: readonly AppPermissionRow[] = [],
): AppUser | null {
  if (!isRole(profile.role)) return null

  const baseRoutes = isStringArray(profile.allowed_routes) && profile.allowed_routes.length > 0
    ? profile.allowed_routes
    : (DEFAULT_ROUTES_BY_ROLE[profile.role] ?? [])

  return {
    id: profile.user_id,
    username: email || profile.display_name,
    displayName: profile.display_name,
    role: profile.role,
    active: profile.active,
    allowedRoutes: resolveAllowedRoutes(profile.role, profile.store, baseRoutes, permissions),
    store: profile.store ?? null,
    email: email || undefined,
  }
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

export function getCurrentUser(): AppUser | null {
  return getCachedAuthUser()
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
    const [profileResult, permissionsResult] = await Promise.all([
      withTimeout(supabase
        .from('app_profiles')
        .select('user_id, display_name, role, active, allowed_routes, store')
        .eq('user_id', authUser.id)
        .maybeSingle()),
      withTimeout(supabase
        .from('app_user_permissions')
        .select('permission_key, scope')
        .eq('user_id', authUser.id)),
    ])

    if (profileResult.error || !profileResult.data) {
      cacheAuthUser(null)
      return null
    }

    const permissions = permissionsResult.error
      ? []
      : (permissionsResult.data ?? []) as AppPermissionRow[]
    const user = buildAppUser(
      profileResult.data as AppProfileRow,
      authUser.email ?? '',
      permissions,
    )
    if (!user || !user.active) {
      cacheAuthUser(null)
      return null
    }

    cacheAuthUser(user)
    return user
  } catch {
    cacheAuthUser(null)
    return null
  }
}

export async function getCurrentUserAsync(): Promise<AppUser | null> {
  return fetchCurrentAuthUser()
}

export function navigateAfterAuthentication(
  destination: string,
  replace: (path: string) => void = path => window.location.replace(path),
) {
  // Uma navegação completa inicia a rota protegida somente depois que o
  // Supabase terminou de persistir a sessão criada pelo login.
  replace(destination)
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
      await supabase.auth.signOut({ scope: 'local' })
      cacheAuthUser(null)
      return { ok: false, message: 'Seu acesso ao ERP não está ativo.' }
    }

    return { ok: true, message: 'Entrada confirmada.', user }
  } catch {
    return { ok: false, message: 'Falha ao entrar. Tente novamente em instantes.' }
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
    return { ok: false, message: 'Falha ao enviar o link. Tente novamente em instantes.' }
  }
}

export async function updateCurrentUserPassword(password: string, confirmation: string): Promise<AuthActionResult> {
  const validation = validatePasswordSetup(password, confirmation)
  if (!validation.ok) return validation

  try {
    const {
      clearPasswordRecoverySession,
      getPasswordRecoverySession,
      supabase,
    } = await import('@/lib/supabase')
    const recoverySession = await withTimeout(getPasswordRecoverySession())

    if (!recoverySession) {
      return { ok: false, message: 'Link inválido ou expirado. Peça um novo acesso.' }
    }

    const { error } = await withTimeout(supabase.auth.updateUser({ password }))
    if (error) {
      return { ok: false, message: 'Não foi possível salvar a senha.' }
    }
    clearPasswordRecoverySession()

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
  LEGACY_AUTH_STORAGE_KEYS.forEach(key => localStorage.removeItem(key))
  localStorage.removeItem(AUTH_PROFILE_CACHE_KEY)
  void import('@/lib/supabase')
    .then(({ clearPasswordRecoverySession, supabase }) => {
      clearPasswordRecoverySession()
      return supabase.auth.signOut({ scope: 'local' })
    })
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
