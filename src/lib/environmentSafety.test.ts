import { describe, expect, it } from 'vitest'
import {
  assertSafeSupabaseEnvironment,
  assertValidSupabasePublicKey,
} from './environmentSafety'

const PRODUCTION_URL = 'https://gohluceldchoitihrimw.supabase.co'
const PREVIEW_URL = 'https://tuqzhjsbodoycjbmwuqm.supabase.co'

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
  it('interrompe o build quando o Supabase recusa a chave publica', async () => {
    const fetchImpl = async () => new Response(
      JSON.stringify({ message: 'Invalid API key' }),
      { status: 401 },
    )

    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PRODUCTION_URL,
      supabaseKey: 'chave-publica-invalida',
      fetchImpl,
    })).rejects.toThrow(/chave publica.*recusada/i)
  })

  it('permite o build quando o Supabase aceita a chave publica', async () => {
    const fetchImpl = async () => new Response('{}', { status: 200 })

    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PREVIEW_URL,
      supabaseKey: 'chave-publica-valida',
      fetchImpl,
    })).resolves.toBeUndefined()
  })
})
