import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// As invariantes de RLS desta tela são guardadas contra o schema versionado
// em supabase/tests/ (pgTAP, executado pelo CI Banco).

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8').toLowerCase()
const pjPageSource = readFileSync(new URL('./pedidos-pj/page.tsx', import.meta.url), 'utf8').toLowerCase()
const ovenPageSource = readFileSync(new URL('./forno/page.tsx', import.meta.url), 'utf8').toLowerCase()

describe('pedido de produção da loja', () => {
  it('identifica explicitamente o pedido comum como produção', () => {
    expect(pageSource).toContain("order_date: date, order_type: 'producao', obs")
  })
})

describe('virada da programação PJ', () => {
  it('Comercial salva entrega obrigatória sem escolher produção', () => {
    expect(pjPageSource).toContain('production_date: null')
    expect(pjPageSource).toContain('a produção decide no dia')
    expect(pjPageSource).not.toContain('defaultproduction')
  })

  it('Forno usa somente o PJ programado, sem fallback para entrega', () => {
    expect(ovenPageSource).toContain("supabase.rpc('list_pj_production_for_oven'")
    expect(ovenPageSource).not.toContain('pj_delivery_date.eq')
    expect(ovenPageSource).not.toContain("row.product_source !== 'product'")
  })

  it('Geolar recebe o painel interativo depois da etapa das lojas', () => {
    expect(pageSource).toContain('<pjproductionplanningpanel />')
    expect(pageSource).not.toContain('pedidos pj a produzir')
  })
})
