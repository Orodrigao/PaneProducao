import { describe, expect, it } from 'vitest'
import {
  navigateAfterAuthentication,
  normalizeEmailInput,
  passwordPolicyChecklist,
  passwordRecoveryErrorMessage,
  validatePasswordSetup,
} from './auth'

describe('normalizeEmailInput', () => {
  it('remove espaços e padroniza e-mail em minúsculas', () => {
    expect(normalizeEmailInput('  Rodrigao@GMAIL.COM  ')).toBe('rodrigao@gmail.com')
  })
})

describe('navigateAfterAuthentication', () => {
  it('faz uma navegação completa para iniciar a rota com a sessão persistida', () => {
    const destinations: string[] = []

    navigateAfterAuthentication('/romaneio', destination => destinations.push(destination))

    expect(destinations).toEqual(['/romaneio'])
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

describe('passwordRecoveryErrorMessage', () => {
  it('explica o limite de envio de e-mails', () => {
    const message = passwordRecoveryErrorMessage({ status: 429 })

    expect(message).toContain('Aguarde até uma hora')
    expect(message).not.toContain('PIN')
  })

  it('mantém a mensagem genérica para outros erros', () => {
    const message = passwordRecoveryErrorMessage({ status: 500 })

    expect(message).toBe('Não foi possível enviar o link. Confira o e-mail e tente novamente.')
    expect(message).not.toContain('PIN')
  })
})
