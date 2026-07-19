import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTES_BY_ROLE, type AppUser } from '@/lib/auth'
import { resolvePurchaseAccess } from './access'

function user(overrides: Partial<AppUser>): AppUser {
  return {
    id: 'uuid-auth-user',
    username: 'user@paneesalute.com.br',
    displayName: 'Usuario',
    role: 'vendas',
    active: true,
    allowedRoutes: ['/compras'],
    store: 'jc',
    ...overrides,
  }
}

describe('resolvePurchaseAccess', () => {
  it('reconhece Liara no login por e-mail mesmo com id UUID do Supabase Auth', () => {
    const access = resolvePurchaseAccess(user({
      username: 'atendimento@paneesalute.com.br',
      email: 'atendimento@paneesalute.com.br',
      displayName: 'Liara',
    }))

    expect(access).toEqual({ sector: 'loja', isOwner: false })
  })

  it('trata financeiro e compras como visao geral do comprador', () => {
    expect(resolvePurchaseAccess(user({
      role: 'financeiro',
      allowedRoutes: DEFAULT_ROUTES_BY_ROLE.financeiro,
    }))).toEqual({ sector: null, isOwner: true })

    expect(resolvePurchaseAccess(user({
      role: 'compras',
      allowedRoutes: DEFAULT_ROUTES_BY_ROLE.compras,
    }))).toEqual({ sector: null, isOwner: true })
  })

  it('nao libera usuario vendas sem rota de compras', () => {
    const access = resolvePurchaseAccess(user({
      displayName: 'Vendas sem compras',
      allowedRoutes: ['/sobras'],
    }))

    expect(access).toEqual({ sector: null, isOwner: false })
  })
})
