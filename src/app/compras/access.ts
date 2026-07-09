import type { AppUser } from '@/lib/auth'

export type PurchaseAccess = { sector: string | null; isOwner: boolean }

type PurchaseUser = Pick<AppUser, 'id' | 'username' | 'displayName' | 'email' | 'role' | 'allowedRoutes'>

function normalizeIdentity(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function identityText(user: PurchaseUser): string {
  return [
    user.id,
    user.username,
    user.displayName,
    user.email,
  ].map(normalizeIdentity).join('|')
}

function hasAny(text: string, aliases: string[]): boolean {
  return aliases.some(alias => text.includes(alias))
}

function hasRoute(user: PurchaseUser, route: string): boolean {
  return user.allowedRoutes.some(allowedRoute =>
    allowedRoute === route || (allowedRoute !== '/' && route.startsWith(allowedRoute + '/'))
  )
}

export function resolvePurchaseAccess(user: PurchaseUser): PurchaseAccess {
  const identity = identityText(user)

  if (user.role === 'admin' || user.role === 'financeiro' || user.role === 'compras') {
    return { sector: null, isOwner: true }
  }
  if (hasAny(identity, ['elis', 'financeiro'])) {
    return { sector: null, isOwner: true }
  }
  if (hasAny(identity, ['geolar', 'producao1', 'padaria'])) {
    return { sector: 'padaria', isOwner: false }
  }
  if (hasAny(identity, ['fran', 'cozinha'])) {
    return { sector: 'cozinha', isOwner: false }
  }
  if (hasAny(identity, ['liara', 'atendimento', 'samuca', 'samuel', 'rose', 'cleo', 'atendente_ex'])) {
    return { sector: 'loja', isOwner: false }
  }
  if (user.role === 'vendas' && hasRoute(user, '/compras')) {
    return { sector: 'loja', isOwner: false }
  }

  return { sector: null, isOwner: false }
}
