import { describe, expect, it } from 'vitest'
import { PLANNING_ORDER_OBS, storeOrderFormObs, storeOrderNote, storeOrderNotes } from './storeOrderNote'

describe('observação do pedido da loja', () => {
  it('acha o recado da loja mesmo quando a primeira linha ficou com a marca do Planejamento', () => {
    // Como em 29/08 na JC: a sobra confirmada regravou a marca em parte dos pães.
    const rows = [{ obs: PLANNING_ORDER_OBS }, { obs: 'La rustico 14' }, { obs: 'La rustico 14' }]
    expect(storeOrderNote(rows)).toBe('La rustico 14')
    expect(storeOrderFormObs(rows)).toBe('La rustico 14')
  })

  it('não trata a marca do Planejamento como recado, mas o formulário a reabre', () => {
    const rows = [{ obs: PLANNING_ORDER_OBS }, { obs: PLANNING_ORDER_OBS }]
    expect(storeOrderNote(rows)).toBe('')
    expect(storeOrderFormObs(rows)).toBe(PLANNING_ORDER_OBS)
  })

  it('ignora linha vazia, nula ou só com espaços', () => {
    expect(storeOrderNote([{ obs: '' }, { obs: null }, {}, { obs: '   ' }])).toBe('')
    expect(storeOrderFormObs([{ obs: '' }, { obs: null }])).toBe('')
    expect(storeOrderNote([{ obs: '' }, { obs: ' 4 inteiros e 4 fatiados ' }])).toBe('4 inteiros e 4 fatiados')
  })

  it('lista os recados na ordem das lojas pedida, só de quem escreveu', () => {
    const orders = {
      jc: { a: { obs: PLANNING_ORDER_OBS }, b: { obs: 'Fazer o rústico' } },
      ja: { a: { obs: PLANNING_ORDER_OBS } },
      ex: { a: { obs: 'Forma: 4 inteiros e 4 fatiados' } },
      pj: { a: { obs: 'INTEGRAL' } },
    }
    expect(storeOrderNotes(orders, ['ex', 'jc', 'ja'])).toEqual([
      { store: 'ex', note: 'Forma: 4 inteiros e 4 fatiados' },
      { store: 'jc', note: 'Fazer o rústico' },
    ])
    expect(storeOrderNotes({}, ['ex', 'jc', 'ja'])).toEqual([])
  })
})
