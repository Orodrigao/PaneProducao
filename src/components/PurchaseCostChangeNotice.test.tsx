import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CostChangeLine, CostChangeSummary, noteCostStates, noteHistoryKey, type NoteCostState } from './PurchaseCostChangeNotice'
import type { CostChange, CostPoint, NoteProductCost } from '@/lib/purchaseCostChange'
import type { NfeDraft } from '@/lib/nfeXml'

// A tela aqui é só o desenho; a leitura do banco tem teste próprio e não roda no Vitest.
vi.mock('@/lib/purchaseCostChangeClient', () => ({ loadCostHistory: vi.fn(), loadRecentCostChanges: vi.fn() }))

const previous: CostPoint = {
  purchaseId: 'nota-a', productId: 'tomate', productName: '[TESTE] Tomate cereja', productUnit: 'kg',
  nfeKey: 'chave-a', nfeNumber: '100', issueDate: '2026-10-10', issuedAt: null, createdAt: '2026-10-10T14:00:00Z',
  supplierName: 'Hortifruti Fictício', unitCost: 5, costApplied: true, packaging: [{ sourceUnit: 'UN', factor: 8.08 }],
}

function change(overrides: Partial<CostChange>): CostChange {
  return { kind: 'sem_alta', productId: 'tomate', unitCost: 5, previous, newer: null, ratio: 1, ...overrides }
}

function line(state: NoteCostState): string {
  return renderToStaticMarkup(createElement(CostChangeLine, { state, unit: 'kg' })).replace(/\s/g, ' ')
}

describe('linha de custo de cada item da nota', () => {
  it('alta mostra o tamanho, o custo de agora e a última compra, sem mexer no preço de venda', () => {
    const html = line({ status: 'pronto', change: change({ kind: 'subiu', unitCost: 6, ratio: 1.2 }) })
    expect(html).toContain('Custo subiu 20% desde a última compra')
    expect(html).toContain('Nesta nota: R$ 6,00 por kg')
    expect(html).toContain('R$ 5,00 por kg na NF 100 de 10/10/2026 · Hortifruti Fictício · embalagem UN com 8,08 kg')
    expect(html).toContain('O preço de venda não muda sozinho')
    expect(html).toContain('role="alert"')
  })

  it('custo igual ou pouco diferente é informação miúda, sem alerta', () => {
    const html = line({ status: 'pronto', change: change({ unitCost: 5.1, ratio: 1.02 }) })
    expect(html).toContain('(+2% sobre a última compra: R$ 5,00 por kg na NF 100')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('Custo subiu')
  })

  it('diferença muito grande, para cima ou para baixo, manda conferir a embalagem', () => {
    expect(line({ status: 'pronto', change: change({ kind: 'muito_diferente', unitCost: 22.67, ratio: 7.36 }) }))
      .toContain('Custo 636% acima da última compra: confira a quantidade por embalagem')
    expect(line({ status: 'pronto', change: change({ kind: 'muito_diferente', unitCost: 2, ratio: 0.4 }) }))
      .toContain('Custo 60% abaixo da última compra: confira a quantidade por embalagem')
  })

  it('primeira compra, nota mais antiga, embalagem pendente, carregando e erro têm texto próprio', () => {
    expect(line({ status: 'pronto', change: change({ kind: 'primeira', previous: null, ratio: null }) })).toContain('Primeira compra deste cadastro por NF-e: R$ 5,00 por kg')
    expect(line({ status: 'pronto', change: change({ kind: 'nota_antiga', newer: { ...previous, nfeNumber: '300', issueDate: '2026-10-30' } }) }))
      .toContain('Já existe nota mais recente deste cadastro (NF 300 de 30/10/2026): esta nota entra no financeiro, mas não muda o custo.')
    expect(line({ status: 'aguardando_embalagem' })).toContain('Confira a embalagem para comparar o custo com a última compra.')
    expect(line({ status: 'carregando' })).toContain('Comparando com a última compra')
    expect(line({ status: 'erro' })).toContain('A importação segue normal.')
  })

  it('a alta só promete o quadro se a nota trocar o custo', () => {
    expect(line({ status: 'pronto', change: change({ kind: 'subiu', unitCost: 6, ratio: 1.2 }) }))
      .toContain('Se esta nota trocar o custo do cadastro ao ser confirmada, a alta fica no quadro')
  })

  it('leitura que falhou oferece comparar de novo, quando a tela dá o caminho', () => {
    expect(renderToStaticMarkup(createElement(CostChangeLine, { state: { status: 'erro' }, unit: 'kg', onRetry: () => undefined }))).toContain('Comparar de novo')
    expect(line({ status: 'erro' })).not.toContain('Comparar de novo')
  })
})

describe('estado de cada cadastro da nota aberta', () => {
  const nota = { accessKey: 'chave-b', issueDate: '2026-10-20', issuedAt: '2026-10-20T09:00:00-03:00' } as NfeDraft
  const custo = (productId: string, unitCost: number | null): NoteProductCost => ({ productId, unitCost, lineNumbers: [1] })
  const costs = new Map([
    ['tomate', custo('tomate', 6)],
    ['manjericao', custo('manjericao', 10)],
    ['farinha', custo('farinha', null)],
    ['acucar', custo('acucar', 4)],
  ])

  it('separa embalagem por conferir, erro, carregando e pronto, pela leitura desta nota', () => {
    const history = new Map([[noteHistoryKey('chave-b', 'tomate'), [previous]], [noteHistoryKey('outra-nota', 'manjericao'), [previous]]])
    const failed = new Set([noteHistoryKey('chave-b', 'acucar')])
    const states = noteCostStates(nota, costs, history, failed)
    expect(states.get('tomate')).toMatchObject({ status: 'pronto', change: { kind: 'subiu', previous: { purchaseId: 'nota-a' } } })
    // Histórico lido para outra nota não vale para esta.
    expect(states.get('manjericao')).toEqual({ status: 'carregando' })
    expect(states.get('farinha')).toEqual({ status: 'aguardando_embalagem' })
    expect(states.get('acucar')).toEqual({ status: 'erro' })
  })

  it('sem nota aberta não há estado', () => {
    expect(noteCostStates(null, costs, new Map(), new Set()).size).toBe(0)
  })
})

describe('resumo no alto dos itens', () => {
  const names = new Map([['tomate', '[TESTE] Tomate cereja'], ['manjericao', '[TESTE] Manjericão']])

  it('lista quem subiu e quem precisa conferir a embalagem', () => {
    const html = renderToStaticMarkup(createElement(CostChangeSummary, {
      changes: [
        change({ kind: 'subiu', ratio: 1.2 }),
        change({ kind: 'muito_diferente', productId: 'manjericao', ratio: 0.4 }),
        change({ productId: 'outro' }),
      ],
      names,
    }))
    expect(html).toContain('1 cadastro desta nota subiu de custo')
    expect(html).toContain('[TESTE] Tomate cereja +20%')
    expect(html).toContain('1 cadastro com custo muito diferente da última compra')
    expect(html).toContain('[TESTE] Manjericão −60%')
  })

  it('some quando nada subiu', () => {
    expect(renderToStaticMarkup(createElement(CostChangeSummary, { changes: [change({})], names }))).toBe('')
  })
})
