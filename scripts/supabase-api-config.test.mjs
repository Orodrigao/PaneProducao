import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyDataApiConfig,
  buildDataApiPayload,
  readApiSchemas,
} from './supabase-api-config.mjs'

const PROJECT_REF = 'abcdefghijklmnopqrst'

test('o config real publica somente public', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')

  assert.deepEqual(buildDataApiPayload(config), { db_schema: 'public' })
})

test('lê somente os schemas da seção api', () => {
  const config = `
[other]
schemas = ["ignorado"]

[api]
schemas = ["public", "storage_api"] # comentário permitido

[api.tls]
schemas = ["tambem_ignorado"]
`

  assert.deepEqual(readApiSchemas(config), ['public', 'storage_api'])
  assert.deepEqual(buildDataApiPayload(config), { db_schema: 'public,storage_api' })
})

test('rejeita configuração ausente, ambígua ou inválida', () => {
  const invalidConfigs = [
    '[api]\nenabled = true',
    '[api]\nschemas = não-é-array',
    '[api]\nschemas = []',
    '[api]\nschemas = ["public", "public"]',
    '[api]\nschemas = ["public", "nome-perigoso"]',
    '[api]\nschemas = ["storage_api"]',
    '[api]\nschemas = ["public"]\nschemas = ["public", "extra"]',
  ]

  for (const config of invalidConfigs) {
    assert.throws(() => readApiSchemas(config))
  }
})

test('aplica exatamente os schemas do arquivo canônico e confirma o retorno', async () => {
  const calls = []
  const schemas = await applyDataApiConfig({
    projectRef: PROJECT_REF,
    accessToken: 'segredo-que-não-pode-vazar',
    workdir: 'C:\\worktree',
    readFileImpl: async (path, encoding) => {
      assert.match(path, /supabase[\\/]config\.toml$/)
      assert.equal(encoding, 'utf8')
      return '[api]\nschemas = ["public", "outro_schema"]'
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        json: async () => ({ db_schema: 'public,outro_schema' }),
      }
    },
  })

  assert.deepEqual(schemas, ['public', 'outro_schema'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${PROJECT_REF}/postgrest`)
  assert.equal(calls[0].options.method, 'PATCH')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer segredo-que-não-pode-vazar')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.body, '{"db_schema":"public,outro_schema"}')
})

test('falha fechada quando a API recusa ou não confirma a configuração', async () => {
  const base = {
    projectRef: PROJECT_REF,
    accessToken: 'token-ultrassecreto',
    readFileImpl: async () => '[api]\nschemas = ["public"]',
  }

  await assert.rejects(
    applyDataApiConfig({
      ...base,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/)
      assert.doesNotMatch(error.message, /token-ultrassecreto/)
      return true
    },
  )

  await assert.rejects(
    applyDataApiConfig({
      ...base,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ db_schema: 'public,graphql_public' }),
      }),
    }),
    /não confirmou/,
  )
})

test('rejeita credenciais ausentes antes de chamar a rede', async () => {
  await assert.rejects(
    applyDataApiConfig({ projectRef: '', accessToken: 'x' }),
    /PROJECT_REF/,
  )
  await assert.rejects(
    applyDataApiConfig({ projectRef: PROJECT_REF, accessToken: '' }),
    /SUPABASE_ACCESS_TOKEN/,
  )
})
