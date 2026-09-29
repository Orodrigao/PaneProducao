import { describe, expect, it } from 'vitest'
import type { AppUser } from '@/lib/auth'
import { authorName, canViewNfeLinks, currencyLabel, dateLabel, dateTimeLabel, invoiceMappingLabel } from '@/lib/vinculosNfe'

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 'user-1', username: 'user', displayName: 'Pessoa', role: 'financeiro', active: true,
    allowedRoutes: ['/produtos'], store: 'jc',
    permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'jc' }],
    ...overrides,
  }
}

describe('consulta de vínculos de NF-e', () => {
  it('permite administrador ativo e Financeiro com rota e acesso a pagar', () => {
    expect(canViewNfeLinks(user())).toBe(true)
    expect(canViewNfeLinks(user({ role: 'admin', permissions: [] }))).toBe(true)
  })

  it('bloqueia Financeiro sem rota ou permissão e qualquer perfil inativo', () => {
    expect(canViewNfeLinks(user({ allowedRoutes: ['/contas-pagar'] }))).toBe(false)
    expect(canViewNfeLinks(user({ permissions: [] }))).toBe(false)
    expect(canViewNfeLinks(user({ role: 'vendas' }))).toBe(false)
    expect(canViewNfeLinks(user({ active: false }))).toBe(false)
  })

  it('exibe autores indisponíveis sem inventar nome', () => {
    expect(authorName(new Map([['a', 'Elis']]), 'a')).toBe('Elis')
    expect(authorName(new Map(), 'a')).toBe('Nome indisponível')
    expect(authorName(new Map(), null)).toBe('Não registrado')
  })

  it('formata valores, datas e situação do item da nota', () => {
    expect(currencyLabel(12.5)).toContain('12,50')
    expect(dateLabel('2026-09-29')).toBe('29/09/2026')
    expect(dateTimeLabel(null)).toBe('Data não registrada')
    expect(invoiceMappingLabel({ mapping_status: 'mapeado' })).toBe('Vínculo registrado na nota')
    expect(invoiceMappingLabel({ mapping_status: 'pendente' })).toBe('Sem vínculo confirmado na nota')
  })
})
