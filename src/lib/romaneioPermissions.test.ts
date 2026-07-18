import { describe, expect, it } from 'vitest'
import {
  canPerformRomaneioAction,
  normalizeRomaneioScope,
  visibleRomaneioScopes,
  type RomaneioPermissions,
} from './romaneioPermissions'

describe('romaneioPermissions', () => {
  const assignments: RomaneioPermissions = [
    { permission_key: 'romaneio.visualizar', scope: 'ex' },
    { permission_key: 'romaneio.confirmar_saida', scope: 'ex' },
    { permission_key: 'romaneio.criar', scope: 'ja' },
  ]

  it('separa ação de loja', () => {
    expect(canPerformRomaneioAction(assignments, 'send', 'EX')).toBe(true)
    expect(canPerformRomaneioAction(assignments, 'send', 'JA')).toBe(false)
    expect(canPerformRomaneioAction(assignments, 'create', 'JA')).toBe(true)
  })

  it('normaliza escopos e lista somente destinos visíveis', () => {
    expect(normalizeRomaneioScope('Ex')).toBe('ex')
    expect(visibleRomaneioScopes(assignments)).toEqual(new Set(['ex']))
  })
})
