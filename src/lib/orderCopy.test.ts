import { describe, expect, it } from 'vitest'
import { buildOrderCopy, orderCopyConfirmation } from './orderCopy'

const breads = [
  { id: 'baguete', name: 'Baguete' },
  { id: 'ciabatta', name: 'Ciabatta' },
  { id: 'rugbrod', name: 'Rugbrød' },
  { id: 'brioche', name: 'Brioche' },
]

describe('buildOrderCopy', () => {
  it('copia a origem para todo pão do dia de destino e zera o que a origem não pediu', () => {
    const copy = buildOrderCopy(
      'jc',
      { baguete: { quantity: 21 }, ciabatta: { quantity: '30' } },
      breads.slice(0, 3),
      breads,
    )
    expect(copy.quantities).toEqual({ 'jc-baguete': 21, 'jc-ciabatta': 30, 'jc-rugbrod': 0 })
    expect(copy.copiedTotal).toBe(51)
    expect(copy.leftOut).toEqual([])
  })

  it('devolve o que a origem pediu e o dia de destino não faz, sem somar no total', () => {
    const copy = buildOrderCopy(
      'ja',
      { baguete: { quantity: 4 }, brioche: { quantity: 6 }, rugbrod: { quantity: 0 }, sumido: { quantity: 2 } },
      breads.slice(0, 2),
      breads,
    )
    expect(copy.quantities).toEqual({ 'ja-baguete': 4, 'ja-ciabatta': 0 })
    expect(copy.copiedTotal).toBe(4)
    expect(copy.leftOut).toEqual([
      { breadId: 'brioche', name: 'Brioche', quantity: 6 },
      { breadId: 'sumido', name: 'sumido', quantity: 2 },
    ])
  })

  it('trata quantidade vazia, negativa ou ilegível como zero', () => {
    const copy = buildOrderCopy(
      'ex',
      { baguete: { quantity: null }, ciabatta: { quantity: -3 }, rugbrod: { quantity: 'abc' } },
      breads.slice(0, 3),
      breads,
    )
    expect(copy.quantities).toEqual({ 'ex-baguete': 0, 'ex-ciabatta': 0, 'ex-rugbrod': 0 })
    expect(copy.copiedTotal).toBe(0)
  })
})

describe('orderCopyConfirmation', () => {
  it('não pergunta quando nenhum formulário de destino tem quantidade', () => {
    expect(orderCopyConfirmation('segunda, 22/09', 'quarta, 30/09', [
      { store: 'jc', currentTotal: 0, copiedTotal: 212, fromPlanning: true },
      { store: 'ja', currentTotal: 0, copiedTotal: 62, fromPlanning: null },
    ])).toBeNull()
  })

  it('mostra por loja o que tem agora, de onde veio e o que entra', () => {
    const message = orderCopyConfirmation('terça-feira, 22/09', 'quarta-feira, 30/09', [
      { store: 'jc', currentTotal: 258, copiedTotal: 212, fromPlanning: true },
      { store: 'ja', currentTotal: 75, copiedTotal: 62, fromPlanning: false },
    ])
    expect(message).toBe([
      'Trocar o pedido de quarta-feira, 30/09 pelas quantidades de terça-feira, 22/09?',
      '',
      'JC: agora 258 (esta data tem pedido gerado pelo Planejamento), cópia 212',
      'JA: agora 75, cópia 62',
      '',
      'Nada é salvo até você conferir e apertar Salvar pedido.',
    ].join('\n'))
  })

  it('avisa quando não deu para conferir o Planejamento', () => {
    const message = orderCopyConfirmation('a', 'b', [
      { store: 'jc', currentTotal: 10, copiedTotal: 5, fromPlanning: null },
    ])
    expect(message).toContain('JC: agora 10 (não consegui conferir se esta data tem pedido do Planejamento), cópia 5')
  })
})
