import { describe, expect, it } from 'vitest'
import { passwordPolicyChecklist, normalizeEmailInput, validatePasswordSetup } from './auth'

describe('normalizeEmailInput', () => {
  it('remove espaços e padroniza e-mail em minúsculas', () => {
    expect(normalizeEmailInput('  Rodrigao@GMAIL.COM  ')).toBe('rodrigao@gmail.com')
  })
})

describe('validatePasswordSetup', () => {
  it('exige senha com pelo menos 10 caracteres', () => {
    expect(validatePasswordSetup('Aa1!56789', 'Aa1!56789')).toMatchObject({ ok: false })
  })

  it('rejeita confirmação diferente', () => {
    expect(validatePasswordSetup('SenhaForte1!', 'SenhaForte2!')).toMatchObject({ ok: false })
  })

  it('rejeita senha sem tipos variados de caracteres', () => {
    expect(validatePasswordSetup('senhaforte', 'senhaforte')).toMatchObject({ ok: false })
  })

  it('rejeita senhas comuns ou obvias', () => {
    expect(validatePasswordSetup('Senha1234!', 'Senha1234!')).toMatchObject({ ok: false })
    expect(validatePasswordSetup('PaneSalute2026!', 'PaneSalute2026!')).toMatchObject({ ok: false })
  })

  it('rejeita senha sequencial', () => {
    expect(validatePasswordSetup('Abc123456!', 'Abc123456!')).toMatchObject({ ok: false })
  })

  it('aceita senha válida com confirmação igual', () => {
    expect(validatePasswordSetup('Forno#Dia72', 'Forno#Dia72')).toMatchObject({ ok: true })
  })
})

describe('passwordPolicyChecklist', () => {
  it('marca critérios visuais de senha forte', () => {
    expect(passwordPolicyChecklist('Forno#Dia72').every(rule => rule.valid)).toBe(true)
  })

  it('indica critérios pendentes para senha fraca', () => {
    const pending = passwordPolicyChecklist('senha').filter(rule => !rule.valid).map(rule => rule.id)

    expect(pending).toEqual(['length', 'case', 'number', 'symbol'])
  })
})
