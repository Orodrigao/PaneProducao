import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSafeSupabaseEnvironment,
  assertValidSupabasePublicKey,
} from './environmentSafety'

const PRODUCTION_URL = 'https://gohluceldchoitihrimw.supabase.co'
const PREVIEW_URL = 'https://tuqzhjsbodoycjbmwuqm.supabase.co'
const PREVIEW_KEY = 'sb_publishable_MRaAwUY1Wq2eWCHGIgljHQ_BM26DSWc'
// Um banco nascido para uma PR: referencia e chave que ninguem conhece antes.
const BRANCH_URL = 'https://qsnhvuakbgftolhuvgkg.supabase.co'
const BRANCH_KEY = 'sb_publishable_9Kf2LmQpXv7TzR4bNc1WdA_Hs83YuEo'

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

  it('aceita o banco de uma PR, que ninguem conhece de antemao', () => {
    // A regra deixou de ser "tem de ser ESTE projeto" e passou a ser "nao pode
    // ser producao". Sem isso, banco por PR reprovaria todo preview legitimo.
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: BRANCH_URL,
      vercelEnvironment: 'preview',
    })).not.toThrow()
  })

  it('continua recusando producao em preview, que e o motivo da trava existir', () => {
    expect(() => assertSafeSupabaseEnvironment({
      supabaseUrl: PRODUCTION_URL,
      vercelEnvironment: 'preview',
    })).toThrow(/Preview.*banco de producao/i)
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
    })).rejects.toThrow(/caractere invisivel/i)
  })

  it('aceita a chave de um banco de PR, que nao esta em lista nenhuma', async () => {
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: BRANCH_URL,
      supabaseKey: BRANCH_KEY,
    })).resolves.toBeUndefined()
  })

  it('recusa chave em formato desconhecido fora de producao', async () => {
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: BRANCH_URL,
      supabaseKey: 'chave-qualquer',
    })).rejects.toThrow(/formato nao reconhecido/i)
  })

  it('producao continua presa a impressao digital exata', async () => {
    // O banco que nao muda e o unico em que chave errada custa caro, entao ele
    // nao ganha a folga que os bancos de PR precisam.
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: PRODUCTION_URL,
      supabaseKey: PREVIEW_KEY,
    })).rejects.toThrow(/nao pertence/i)
  })

  it('chave JWT que declara outro projeto e recusada', async () => {
    // Quando a chave diz a que projeto pertence, o par trocado nao passa.
    const payload = Buffer.from(JSON.stringify({ ref: 'outroprojetoqualquer' })).toString('base64url')
    await expect(assertValidSupabasePublicKey({
      supabaseUrl: BRANCH_URL,
      supabaseKey: `cabecalho.${payload}.assinatura`,
    })).rejects.toThrow(/nao pertence/i)
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
