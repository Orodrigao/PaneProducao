import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  PREVIEW_PROJECT_REF,
  ensurePreviewUsers,
  validatePreviewUserEnvironment,
} from './provision-preview-users.mjs'

const SAFE_ENVIRONMENT = {
  previewProjectRef: PREVIEW_PROJECT_REF,
  supabaseUrl: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  serviceRoleKey: 'segredo-de-teste',
  testUserPassword: 'SenhaTeste1!',
}

describe('validatePreviewUserEnvironment', () => {
  it('recusa qualquer projeto diferente do Banco Preview', () => {
    assert.throws(() => validatePreviewUserEnvironment({
      ...SAFE_ENVIRONMENT,
      previewProjectRef: 'gohluceldchoitihrimw',
      supabaseUrl: 'https://gohluceldchoitihrimw.supabase.co',
    }), /projeto Preview esperado/i)
  })

  it('exige uma senha compativel com a politica do aplicativo', () => {
    assert.throws(() => validatePreviewUserEnvironment({
      ...SAFE_ENVIRONMENT,
      testUserPassword: 'senha-fraca',
    }), /politica/i)

    assert.throws(() => validatePreviewUserEnvironment({
      ...SAFE_ENVIRONMENT,
      testUserPassword: 'PaneTeste1!',
    }), /politica/i)
  })
})

describe('ensurePreviewUsers', () => {
  it('cria contas ausentes e atualiza contas existentes sem expor a senha', async () => {
    const responses = [
      new Response(JSON.stringify({
        users: [{ id: 'usuario-existente', email: 'rodrigao+teste@gmail.com' }],
      }), { status: 200 }),
      ...Array.from({ length: 5 }, () => new Response('{}', { status: 200 })),
    ]
    const fetchImpl = mock.fn(async () => responses.shift())

    await ensurePreviewUsers({ ...SAFE_ENVIRONMENT, fetchImpl })

    assert.equal(fetchImpl.mock.callCount(), 6)
    assert.match(fetchImpl.mock.calls[1].arguments[0], /admin\/users\/usuario-existente$/)
    assert.equal(fetchImpl.mock.calls[1].arguments[1].method, 'PUT')
    assert.match(fetchImpl.mock.calls[2].arguments[0], /admin\/users$/)
    assert.equal(fetchImpl.mock.calls[2].arguments[1].method, 'POST')
    assert.match(fetchImpl.mock.calls[2].arguments[1].body, /rodrigao\+teste-vendas-ja@gmail\.com/)
    assert.match(fetchImpl.mock.calls[2].arguments[1].body, /SenhaTeste1!/)
  })
})
