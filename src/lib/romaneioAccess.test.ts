import { describe, expect, it } from 'vitest'
import { canSeeRomaneio, destinationCode, resolveRomaneioRole } from './romaneioAccess'

describe('resolveRomaneioRole', () => {
  it('mantém vendas no papel da própria loja', () => {
    expect(resolveRomaneioRole({ id: 'jc', role: 'vendas', store: 'jc', allowedRoutes: ['/romaneio'] })).toBe('gustavo')
    expect(resolveRomaneioRole({ id: 'ja', role: 'vendas', store: 'ja', allowedRoutes: ['/romaneio'] })).toBe('cleo')
    expect(resolveRomaneioRole({ id: 'ex', role: 'vendas', store: 'ex', allowedRoutes: ['/romaneio'] })).toBe('marselle')
  })

  it('não cria papel interno para usuário sem acesso à rota', () => {
    expect(resolveRomaneioRole({
      id: 'sem-romaneio',
      role: 'vendas',
      store: 'ex',
      allowedRoutes: ['/sobras'],
    })).toBeNull()
  })
})

describe('canSeeRomaneio', () => {
  it('restringe cada loja aos destinos operacionais esperados', () => {
    expect(canSeeRomaneio('marselle', { code: 'EX' })).toBe(true)
    expect(canSeeRomaneio('marselle', { code: 'JA' })).toBe(false)
    expect(canSeeRomaneio('cleo', { code: 'EX' })).toBe(true)
    expect(canSeeRomaneio('cleo', { code: 'JA' })).toBe(true)
    expect(canSeeRomaneio('cleo', { code: 'JC' })).toBe(false)
    expect(canSeeRomaneio('gustavo', { code: 'JA' })).toBe(true)
  })

  it('reconhece destinos legados pelo nome', () => {
    expect(destinationCode({ name: 'Exposição' })).toBe('EX')
    expect(destinationCode({ name: 'Jardim América' })).toBe('JA')
  })
})
