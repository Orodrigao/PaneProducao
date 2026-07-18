import { describe, expect, it } from 'vitest'
import { canSeeRomaneio, destinationCode } from './romaneioAccess'
import { canPerformRomaneioAction, type RomaneioPermissions } from './romaneioPermissions'

const permissions: RomaneioPermissions = [
  { permission_key: 'romaneio.visualizar', scope: 'ex' },
  { permission_key: 'romaneio.confirmar_saida', scope: 'ex' },
]

describe('permissões do Romaneio', () => {
  it('autoriza por ação e destino, sem inferir pela loja do usuário', () => {
    expect(canSeeRomaneio(permissions, { code: 'EX' })).toBe(true)
    expect(canSeeRomaneio(permissions, { code: 'JA' })).toBe(false)
    expect(canPerformRomaneioAction(permissions, 'send', 'EX')).toBe(true)
    expect(canPerformRomaneioAction(permissions, 'receive', 'EX')).toBe(false)
  })

  it('permite escopo global', () => {
    const global: RomaneioPermissions = [{ permission_key: 'romaneio.administrar', scope: '*' }]
    expect(canSeeRomaneio(global, { code: 'JA' })).toBe(true)
    expect(canPerformRomaneioAction(global, 'manage', 'EX')).toBe(true)
  })

  it('reconhece destinos legados pelo nome', () => {
    expect(destinationCode({ name: 'Exposição' })).toBe('EX')
    expect(destinationCode({ name: 'Jardim América' })).toBe('JA')
  })
})
