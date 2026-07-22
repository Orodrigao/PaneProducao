import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// As invariantes de RLS desta tela são guardadas contra o schema versionado
// em supabase/tests/ (pgTAP, executado pelo CI Banco).

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8').toLowerCase()

describe('pedido de produção da loja', () => {
  it('identifica explicitamente o pedido comum como produção', () => {
    expect(pageSource).toContain("order_date: date, order_type: 'producao', obs")
  })
})
