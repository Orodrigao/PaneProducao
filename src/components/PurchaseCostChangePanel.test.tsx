import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CostChangePanelContent, CostChangePanelView, type CostChangePanelState, type RecentCostChange } from './PurchaseCostChangePanel'
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

function renderContent(changes: RecentCostChange[]): string {
  return renderToStaticMarkup(createElement(CostChangePanelContent, { changes })).replace(/\s/g, ' ')
}

describe('quadro das altas de custo no Contas a pagar', () => {
  it('começa recolhido, com título, ícones e resumo singular, sem linhas nem explicação', () => {
    const html = render({ status: 'pronto', changes: [recent()] })
    expect(html).toContain('Altas e variações grandes de custo, notas dos últimos 30 dias')
    expect(html).toContain('1 cadastro com alta ou variação grande')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('width:100%')
    expect(html).toContain('lucide-trending-up')
    expect(html).toContain('lucide-chevron-down')
    expect(html).not.toContain('lucide-chevron-up')
    expect(html).not.toContain('<li')
    expect(html).not.toContain('[TESTE] Tomate cereja')
    expect(html).not.toContain('Alta de 5% ou mais')
    expect(html).not.toContain('O preço de venda não muda sozinho.')
    expect(html).not.toContain('conferir a embalagem')
    expect(html).not.toContain('disabled')
  })

  it('conta cada par nota/cadastro, mesmo quando o cadastro é o mesmo, e destaca a embalagem', () => {
    const html = render({ status: 'pronto', changes: [recent(), recent({ kind: 'muito_diferente', point: point({ purchaseId: 'c' }) })] })
    expect(html).toContain('2 cadastros com alta ou variação grande · 1 pede conferir a embalagem')
    expect(html).toContain('color:var(--berry)')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<li')
  })

  it('usa singular e plural também na quantidade de embalagens a conferir', () => {
    const change = recent({ kind: 'muito_diferente' })
    expect(render({ status: 'pronto', changes: [change] })).toContain('1 cadastro com alta ou variação grande · 1 pede conferir a embalagem')
    expect(render({ status: 'pronto', changes: [change, recent({ kind: 'muito_diferente', point: point({ purchaseId: 'c' }) })] })).toContain('2 cadastros com alta ou variação grande · 2 pedem conferir a embalagem')
    const withoutPackaging = render({ status: 'pronto', changes: [recent(), recent({ point: point({ purchaseId: 'c' }) })] })
    expect(withoutPackaging).toContain('2 cadastros com alta ou variação grande')
    expect(withoutPackaging).not.toContain('conferir a embalagem')
    expect(withoutPackaging).not.toContain('color:var(--berry)')
  })

  it('aberto, cada alta mostra o cadastro, quanto subiu, de quanto para quanto e as duas notas', () => {
    const html = renderContent([recent()])
    expect(html).toContain('[TESTE] Tomate cereja')
    expect(html).toContain('+20%')
    expect(html).toContain('R$ 5,00 por kg → R$ 6,00 por kg')
    expect(html).toContain('NF 200 de 20/10/2026 · Hortifruti Fictício · antes: NF 100 de 10/10/2026 (Outro Fornecedor)')
    expect(html).toContain('O preço de venda não muda sozinho.')
  })

  it('diferença muito grande pede conferir a embalagem', () => {
    expect(renderContent([recent({ kind: 'muito_diferente', ratio: 7.36 })])).toContain('+636% · confira a quantidade por embalagem')
  })

  const summaryCases: { state: CostChangePanelState; summary: string }[] = [
    { state: { status: 'pronto', changes: [] }, summary: 'Nenhum cadastro subiu 5% ou mais, nem teve variação grande, sobre a compra anterior.' },
    { state: { status: 'carregando' }, summary: 'Conferindo as notas recentes...' },
    { state: { status: 'erro' }, summary: 'Não foi possível conferir as altas de custo agora. O restante do Contas a pagar segue normal; atualize a página para tentar de novo.' },
  ]
  it.each(summaryCases)('sem linhas, mantém o resumo visível e não abre conteúdo vazio: $state.status', ({ state, summary }) => {
    const html = render(state)
    expect(html).toContain(summary)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('disabled')
    expect(html).not.toContain('<li')
    expect(html).not.toContain('O preço de venda não muda sozinho.')
    if (state.status === 'erro') {
      expect(html).toContain('role="alert"')
      expect(html).toContain('color:var(--berry)')
    }
  })

  it('mostra oito de cada vez', () => {
    const changes = Array.from({ length: 10 }, (_, index) => recent({ point: point({ purchaseId: `nota-${index}`, nfeNumber: `${300 + index}` }) }))
    const html = renderContent(changes)
    expect(html.match(/<li/g)).toHaveLength(8)
    expect(html).toContain('Mostrar todas as 10')
    expect(html).toContain('NF 307')
    expect(html).not.toContain('NF 308')
    expect(render({ status: 'pronto', changes })).not.toContain('Mostrar todas')
  })
})
