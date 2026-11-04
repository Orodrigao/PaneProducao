import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CostChangePanelView, type CostChangePanelState, type RecentCostChange } from './PurchaseCostChangePanel'
import type { CostPoint } from '@/lib/purchaseCostChange'

// A tela aqui é só o desenho; a leitura do banco tem teste próprio e não roda no Vitest.
vi.mock('@/lib/purchaseCostChangeClient', () => ({ loadCostHistory: vi.fn(), loadRecentCostChanges: vi.fn() }))

function point(overrides: Partial<CostPoint>): CostPoint {
  return {
    purchaseId: 'b', productId: 'tomate', productName: '[TESTE] Tomate cereja', productUnit: 'kg',
    nfeKey: 'chave-b', nfeNumber: '200', issueDate: '2026-10-20', issuedAt: null, createdAt: '2026-10-20T14:00:00Z',
    supplierName: 'Hortifruti Fictício', unitCost: 6, costApplied: true, packaging: [],
    ...overrides,
  }
}

function recent(overrides: Partial<RecentCostChange> = {}): RecentCostChange {
  const current = point({})
  return {
    kind: 'subiu', productId: 'tomate', unitCost: 6, ratio: 1.2, newer: null,
    previous: point({ purchaseId: 'a', nfeNumber: '100', issueDate: '2026-10-10', unitCost: 5, supplierName: 'Outro Fornecedor' }),
    point: current,
    ...overrides,
  }
}

function render(state: CostChangePanelState): string {
  return renderToStaticMarkup(createElement(CostChangePanelView, { state })).replace(/\s/g, ' ')
}

describe('quadro das altas de custo no Contas a pagar', () => {
  it('cada alta mostra o cadastro, quanto subiu, de quanto para quanto e as duas notas', () => {
    const html = render({ status: 'pronto', changes: [recent()] })
    expect(html).toContain('Altas e variações grandes de custo, notas dos últimos 30 dias')
    expect(html).toContain('[TESTE] Tomate cereja')
    expect(html).toContain('+20%')
    expect(html).toContain('R$ 5,00 por kg → R$ 6,00 por kg')
    expect(html).toContain('NF 200 de 20/10/2026 · Hortifruti Fictício · antes: NF 100 de 10/10/2026 (Outro Fornecedor)')
    expect(html).toContain('O preço de venda não muda sozinho.')
  })

  it('diferença muito grande pede conferir a embalagem', () => {
    expect(render({ status: 'pronto', changes: [recent({ kind: 'muito_diferente', ratio: 7.36 })] })).toContain('+636% · confira a quantidade por embalagem')
  })

  it('vazio, carregando e erro dizem o que aconteceu', () => {
    expect(render({ status: 'pronto', changes: [] })).toContain('Nenhum cadastro subiu 5% ou mais, nem teve variação grande, sobre a compra anterior.')
    expect(render({ status: 'carregando' })).toContain('Conferindo as notas recentes...')
    expect(render({ status: 'erro' })).toContain('O restante do Contas a pagar segue normal')
  })

  it('mostra oito de cada vez', () => {
    const changes = Array.from({ length: 10 }, (_, index) => recent({ point: point({ purchaseId: `nota-${index}`, nfeNumber: `${300 + index}` }) }))
    const html = render({ status: 'pronto', changes })
    expect(html.match(/<li/g)).toHaveLength(8)
    expect(html).toContain('Mostrar todas as 10')
  })
})
