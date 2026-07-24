import { describe, expect, it } from 'vitest'
import { resolveProductionHomeUserKey } from './productionHomeAccess'

describe('resolveProductionHomeUserKey', () => {
  it('mantem expedicao de JC no contexto de Gustavo', () => {
    expect(resolveProductionHomeUserKey({ role: 'expedicao', store: 'jc' })).toBe('gustavo')
  })

  it('preserva o contexto de EX para expedicao fora de JC', () => {
    expect(resolveProductionHomeUserKey({ role: 'expedicao', store: 'ex' })).toBe('marselle')
  })

  it('nao projeta Vendas JA como Loja EX', () => {
    expect(resolveProductionHomeUserKey({ role: 'vendas', store: 'ja' })).toBeNull()
  })

  it('preserva as projecoes existentes dos demais perfis', () => {
    expect(resolveProductionHomeUserKey({ role: 'admin', store: null })).toBe('rodrigo')
    expect(resolveProductionHomeUserKey({ role: 'financeiro', store: null })).toBe('elis')
    expect(resolveProductionHomeUserKey({ role: 'producao', store: 'jc' })).toBe('geolar')
  })
})
