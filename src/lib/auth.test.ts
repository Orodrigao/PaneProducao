import { describe, expect, it } from 'vitest'
import { normalizeEmailInput, validatePasswordSetup } from './auth'

describe('normalizeEmailInput', () => {
  it('remove espaços e padroniza e-mail em minúsculas', () => {
    expect(normalizeEmailInput('  Rodrigao@GMAIL.COM  ')).toBe('rodrigao@gmail.com')
  })
})

describe('validatePasswordSetup', () => {
  it('exige senha com pelo menos 8 caracteres', () => {
    expect(validatePasswordSetup('1234567', '1234567')).toMatchObject({ ok: false })
  })

  it('rejeita confirmação diferente', () => {
    expect(validatePasswordSetup('senha123', 'senha124')).toMatchObject({ ok: false })
  })

  it('aceita senha válida com confirmação igual', () => {
    expect(validatePasswordSetup('senha123', 'senha123')).toMatchObject({ ok: true })
  })
})
