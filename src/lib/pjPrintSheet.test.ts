import { describe, expect, it } from 'vitest'
import { buildPjPrintSheet, type PjPrintBreadSource } from './pjPrintSheet'

const breads: PjPrintBreadSource[] = [
  { breadId: 'hamburguer', breadName: 'Hamburguer', storeQuantities: [30, 20, 30] },
  { breadId: 'frances', breadName: 'Frances', storeQuantities: [100, 100, 100] },
  { breadId: 'pj-exclusivo', breadName: 'Pão exclusivo PJ', storeQuantities: [0, 0, 0] },
]

describe('folha de pães com produção PJ', () => {
  it('soma lojas e PJ no total do mesmo pão', () => {
    expect(buildPjPrintSheet(breads, [
      { bread_id: 'hamburguer', quantity: 70 },
      { bread_id: 'hamburguer', quantity: 50 },
    ])).toContainEqual({
      breadId: 'hamburguer',
      breadName: 'Hamburguer',
      storeQuantities: [30, 20, 30],
      storeTotal: 80,
      pjQuantity: 120,
      total: 200,
    })
  })

  it('inclui pão produzido somente para PJ', () => {
    expect(buildPjPrintSheet(breads, [
      { bread_id: 'pj-exclusivo', quantity: 40 },
    ])).toContainEqual({
      breadId: 'pj-exclusivo',
      breadName: 'Pão exclusivo PJ',
      storeQuantities: [0, 0, 0],
      storeTotal: 0,
      pjQuantity: 40,
      total: 40,
    })
  })

  it('soma quantidade PJ numérica recebida como texto', () => {
    expect(buildPjPrintSheet([breads[0]], [
      { bread_id: 'hamburguer', quantity: '120' },
    ])).toEqual([{
      breadId: 'hamburguer',
      breadName: 'Hamburguer',
      storeQuantities: [30, 20, 30],
      storeTotal: 80,
      pjQuantity: 120,
      total: 200,
    }])
  })

  it('mantém sem parcela PJ o pão produzido somente para as lojas', () => {
    const [row] = buildPjPrintSheet([breads[1]], [])

    expect(row).toEqual({
      breadId: 'frances',
      breadName: 'Frances',
      storeQuantities: [100, 100, 100],
      storeTotal: 300,
      pjQuantity: null,
      total: 300,
    })
  })

  it('mantém a folha das lojas igual quando a lista PJ está vazia', () => {
    expect(buildPjPrintSheet([breads[0]], [])).toEqual([{
      breadId: 'hamburguer',
      breadName: 'Hamburguer',
      storeQuantities: [30, 20, 30],
      storeTotal: 80,
      pjQuantity: null,
      total: 80,
    }])
  })

  it('ignora quantidades PJ zero ou negativas sem criar linha nem alterar total', () => {
    expect(buildPjPrintSheet(breads, [
      { bread_id: 'hamburguer', quantity: -50 },
      { bread_id: 'pj-exclusivo', quantity: 0 },
    ])).toEqual([
      {
        breadId: 'hamburguer',
        breadName: 'Hamburguer',
        storeQuantities: [30, 20, 30],
        storeTotal: 80,
        pjQuantity: null,
        total: 80,
      },
      {
        breadId: 'frances',
        breadName: 'Frances',
        storeQuantities: [100, 100, 100],
        storeTotal: 300,
        pjQuantity: null,
        total: 300,
      },
    ])
  })

  it('ignora quantidades PJ zero ou negativas recebidas como texto', () => {
    expect(buildPjPrintSheet([breads[0], breads[2]], [
      { bread_id: 'hamburguer', quantity: '-5' },
      { bread_id: 'pj-exclusivo', quantity: '0' },
    ])).toEqual([{
      breadId: 'hamburguer',
      breadName: 'Hamburguer',
      storeQuantities: [30, 20, 30],
      storeTotal: 80,
      pjQuantity: null,
      total: 80,
    }])
  })

  it('ignora valor PJ não numérico vindo do banco', () => {
    expect(buildPjPrintSheet([breads[0], breads[2]], [
      { bread_id: 'hamburguer', quantity: 'muitos' },
      { bread_id: 'pj-exclusivo', quantity: 'quarenta' },
    ])).toEqual([{
      breadId: 'hamburguer',
      breadName: 'Hamburguer',
      storeQuantities: [30, 20, 30],
      storeTotal: 80,
      pjQuantity: null,
      total: 80,
    }])
  })
})
