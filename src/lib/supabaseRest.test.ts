import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  RequestTimeoutError,
  buildSupabaseRestHeaders,
  withTimeout,
} from './supabaseRest'

describe('buildSupabaseRestHeaders', () => {
  it('envia o token do usuário autenticado para o RLS', () => {
    const headers = buildSupabaseRestHeaders('token-do-usuario')

    expect(headers.get('Authorization')).toBe('Bearer token-do-usuario')
    expect(headers.get('apikey')).not.toBeNull()
  })

  it('preserva o fallback público para o login por PIN durante a transição', () => {
    const headers = buildSupabaseRestHeaders(null)

    expect(headers.get('Authorization')).toBe(`Bearer ${headers.get('apikey')}`)
  })
})

describe('withTimeout', () => {
  it('encerra um carregamento que não responde', async () => {
    vi.useFakeTimers()
    const pending = new Promise<string>(() => undefined)
    const result = withTimeout(pending, 1_000)
    const expectation = expect(result).rejects.toBeInstanceOf(RequestTimeoutError)

    await vi.advanceTimersByTimeAsync(1_000)
    await expectation
    vi.useRealTimers()
  })
})

describe('consultas REST protegidas', () => {
  it('não fixa mais a chave pública como identidade nas telas operacionais', () => {
    const files = [
      resolve(process.cwd(), 'src/app/page.tsx'),
      resolve(process.cwd(), 'src/app/romaneio/page.tsx'),
    ]

    files.forEach(file => {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('supabaseRestFetch')
      expect(source).not.toMatch(/Authorization['"]?\s*:\s*['"]Bearer ['"]?\s*\+\s*SB_KEY/)
    })
  })

  it('protege novas consultas REST diretas em qualquer tela', () => {
    const appRoot = resolve(process.cwd(), 'src/app')
    const pending = [appRoot]
    const files: string[] = []

    while (pending.length > 0) {
      const directory = pending.pop()
      if (!directory) continue
      readdirSync(directory, { withFileTypes: true }).forEach(entry => {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) pending.push(path)
        else if (entry.name.endsWith('.tsx')) files.push(path)
      })
    }

    files.forEach(file => {
      const source = readFileSync(file, 'utf8')
      if (!source.includes('/rest/v1/')) return
      expect(source).not.toMatch(/Authorization['"]?\s*:\s*(?:['"]Bearer ['"]?\s*\+\s*SB_KEY|`Bearer \$\{SB_KEY\}`)/)
    })
  })
})
