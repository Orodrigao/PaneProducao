import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSafeSupabaseEnvironment,
  assertValidSupabasePublicKey,
} from './environmentSafety'

const PRODUCTION_URL = 'https://gohluceldchoitihrimw.supabase.co'
const PREVIEW_URL = 'https://tuqzhjsbodoycjbmwuqm.supabase.co'
const PREVIEW_KEY = 'sb_publishable_MRaAwUY1Wq2eWCHGIgljHQ_BM26DSWc'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assertSafeSupabaseEnvironment', () => {
  it('impede que preview da Vercel converse com o banco de producao', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PRODUCTION_URL,
      vercelEnvironment: 'preview',
    })).toThrow(/Preview.*banco de producao/i)
  })

  it('impede que uma maquina local converse com o banco de producao', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PRODUCTION_URL,
    })).toThrow(/local.*banco de producao/i)
  })

  it('aceita o banco de teste em preview e na maquina local', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PREVIEW_URL,
      vercelEnvironment: 'preview',
    })).not.toThrow()

    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PREVIEW_URL,
    })).not.toThrow()
  })

  it('exige o banco de producao no deploy de producao', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PREVIEW_URL,
      vercelEnvironment: 'production',
    })).toThrow(/Producao.*banco de teste/i)

    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PRODUCTION_URL,
      vercelEnvironment: 'production',
    })).not.toThrow()
  })

  it('recusa build sem endereco do Supabase', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: undefined,
      vercelEnvironment: 'preview',
    })).toThrow(/NEXT_PUBLIC_SUPABASE_URL ausente/i)
  })
})

describe('assertValidSupabasePublicKey', () => {
  it('interrompe o build quando a chave publica nao pertence ao projeto', async () => {
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PRODUCTION_URL,
      supabaseKey: 'chave-publica-invalida',
    })).rejects.toThrow(/chave publica.*nao pertence/i)
  })

  it('recusa caractere invisivel no fim da chave publica', async () => {
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PREVIEW_URL,
      supabaseKey: `${PREVIEW_KEY}\r`,
    })).rejects.toThrow(/chave publica.*nao pertence/i)
  })

  it('valida a chave conhecida sem depender de acesso à rede', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('rede indisponivel')
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PREVIEW_URL,
      supabaseKey: PREVIEW_KEY,
    })).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
