// src/lib/auth.ts — autenticacao PIN-based, Supabase REST, cache localStorage

export type Role = 'admin' | 'producao' | 'vendas' | 'estoque' | 'compras' | 'romaneio'

export interface AppUser {
  id: string
  username: string
  displayName: string
  pin: string
  role: Role
  active: boolean
  allowedRoutes: string[]
}

const SB_URL   = 'https://gohluceldchoitihrimw.supabase.co'
const SB_KEY   = 'sb_publishable_Su-BxUMybE1ysGiLxqNilg_YhYgItOJ'

const CACHE_KEY   = 'pane_users_cache'
const SESSION_KEY = 'pane_user_id'

export const DEFAULT_ROUTES_BY_ROLE: Record<Role, string[]> = {
  admin:    ['/', '/sobras', '/romaneio', '/estoque-congelado', '/compras', '/estoque', '/produtos', '/admin/usuarios'],
  producao: ['/', '/sobras'],
  vendas:   ['/', '/sobras', '/romaneio'],
  estoque:  ['/', '/estoque-congelado', '/estoque'],
  compras:  ['/compras', '/estoque', '/produtos'],
  romaneio: ['/romaneio'],
}

export const USERS_FALLBACK: AppUser[] = [
  { id: 'fb1', username: 'rodrigo',   displayName: 'Rodrigo',    pin: '1234', role: 'admin',    active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.admin },
  { id: 'fb2', username: 'suelen',    displayName: 'Suelen',     pin: '1111', role: 'admin',    active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.admin },
  { id: 'fb3', username: 'producao1', displayName: 'Producao 1', pin: '2222', role: 'producao', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.producao },
  { id: 'fb4', username: 'producao2', displayName: 'Producao 2', pin: '3333', role: 'producao', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.producao },
  { id: 'fb5', username: 'vendas1',   displayName: 'Vendas 1',   pin: '4444', role: 'vendas',   active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.vendas },
  { id: 'fb6', username: 'estoque1',  displayName: 'Estoque 1',  pin: '5555', role: 'estoque',  active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.estoque },
  { id: 'fb7', username: 'compras1',  displayName: 'Compras 1',  pin: '6666', role: 'compras',  active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.compras },
  { id: 'fb8', username: 'romaneio1', displayName: 'Romaneio 1', pin: '7777', role: 'romaneio', active: true, allowedRoutes: DEFAULT_ROUTES_BY_ROLE.romaneio },
]

interface SBUser {
  id: string
  username: string
  display_name: string
  pin: string
  role: Role
  active: boolean
}

export async function fetchUsersFromSupabase(): Promise<AppUser[] | null> {
  try {
    const res = await fetch(SB_URL + '/rest/v1/app_users?select=*&order=display_name.asc', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null
    const rows: SBUser[] = await res.json()
    return rows.map(r => ({
      id: r.id, username: r.username, displayName: r.display_name,
      pin: r.pin, role: r.role, active: r.active,
      allowedRoutes: DEFAULT_ROUTES_BY_ROLE[r.role] ?? [],
    }))
  } catch { return null }
}

export async function createUserInSupabase(user: Omit<AppUser, 'id' | 'allowedRoutes'>): Promise<boolean> {
  try {
    const res = await fetch(SB_URL + '/rest/v1/app_users', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ username: user.username, display_name: user.displayName, pin: user.pin, role: user.role, active: user.active }),
    })
    return res.ok
  } catch { return false }
}

export async function updateUserInSupabase(id: string, updates: Partial<Pick<AppUser, 'pin' | 'active' | 'role'>>): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {}
    if (updates.pin    !== undefined) body.pin    = updates.pin
    if (updates.active !== undefined) body.active = updates.active
    if (updates.role   !== undefined) body.role   = updates.role
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
  const id = localStorage.getItem(SESSION_KEY)
  if (!id) return null
  const users = getCachedUsers()
  return users.find(u => u.id === id && u.active) ?? null
}

export function logout() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_KEY)
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
  }
  return map[role] ?? role
}

export function roleColor(role: Role): string {
  const map: Record<Role, string> = {
    admin: '#7c3aed', producao: '#d97706', vendas: '#059669',
    estoque: '#2563eb', compras: '#dc2626', romaneio: '#0891b2',
  }
  return map[role] ?? '#6b7280'
}
