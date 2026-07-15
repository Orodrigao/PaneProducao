import { describe, expect, it } from 'vitest'
import { passwordRecoveryIdentityForSession } from './passwordRecovery'

const identity = {
  userId: 'user-1',
  email: 'cleo@paneesalute.com.br',
  accessToken: 'token-da-recuperacao',
}

describe('passwordRecoveryIdentityForSession', () => {
  it('aceita somente a sessao que veio do link de recuperacao', () => {
    expect(passwordRecoveryIdentityForSession(JSON.stringify(identity), {
      user: { id: 'user-1', email: 'cleo@paneesalute.com.br' },
      access_token: 'token-da-recuperacao',
    })).toMatchObject(identity)
  })

  it('rejeita uma sessao normal, ainda que seja do mesmo usuario', () => {
    expect(passwordRecoveryIdentityForSession(JSON.stringify(identity), {
      user: { id: 'user-1', email: 'cleo@paneesalute.com.br' },
      access_token: 'token-de-login-normal',
    })).toBeNull()
  })

  it('rejeita marcador invalido ou de outro usuario', () => {
    expect(passwordRecoveryIdentityForSession('nao-e-json', {
      user: { id: 'user-1' },
      access_token: 'token-da-recuperacao',
    })).toBeNull()

    expect(passwordRecoveryIdentityForSession(JSON.stringify(identity), {
      user: { id: 'user-2' },
      access_token: 'token-da-recuperacao',
    })).toBeNull()
  })
})
