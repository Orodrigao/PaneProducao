import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bakeryDayKey, buildPjPrintSheet, type PjPrintBreadSource } from './pjPrintSheet'
import { nextProductionPlanDate } from './productionPlanning'

const productionPageSource = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')

const breads: PjPrintBreadSource[] = [
  { breadId: 'hamburguer', breadName: 'Hamburguer', storeQuantities: [30, 20, 30] },
  { breadId: 'frances', breadName: 'Frances', storeQuantities: [100, 100, 100] },
  { breadId: 'pj-exclusivo', breadName: 'Pão exclusivo PJ', storeQuantities: [0, 0, 0] },
]

describe('folha de pães com produção PJ', () => {
  it('recarrega o PJ do dia imediatamente depois de uma nova programação', () => {
    expect(productionPageSource).toContain("window.addEventListener('pj-production-scheduled', refreshAfterScheduling)")
    expect(productionPageSource).toContain("window.removeEventListener('pj-production-scheduled', refreshAfterScheduling)")
  })

  it('consulta a produção PJ de hoje mesmo quando a folha das lojas está no dia seguinte', () => {
    const geolarScreen = productionPageSource.slice(
      productionPageSource.indexOf('function GeolarScreen'),
    )

    expect(geolarScreen).toContain('p_production_date: bakeryDayKey()')
    expect(geolarScreen).not.toContain('p_production_date: geolarDate')
  })

  it('abre a folha regular no próximo dia de saída usando a mesma regra do planejamento', () => {
    expect(productionPageSource).toContain(
      'const defDate = requestedProductionDate() ?? nextProductionPlanDate(bakeryDayKey())',
    )
    expect(productionPageSource).not.toContain(
      'const defDate = requestedProductionDate() ?? deliveryDateKey(todayDelivIdx)',
    )

    expect(nextProductionPlanDate('2026-09-07')).toBe('2026-09-08')
    expect(nextProductionPlanDate('2026-09-09')).toBe('2026-09-10')
    expect(nextProductionPlanDate('2026-09-10')).toBe('2026-09-11')
    expect(nextProductionPlanDate('2026-09-11')).toBe('2026-09-12')
    expect(nextProductionPlanDate('2026-09-12')).toBe('2026-09-14')
  })

  it('mantém o dia da padaria correto na madrugada em aparelhos no Brasil ou em UTC', () => {
    expect(bakeryDayKey(new Date('2026-09-09T02:59:59.000Z'))).toBe('2026-09-08')
    expect(bakeryDayKey(new Date('2026-09-09T03:00:00.000Z'))).toBe('2026-09-09')
    expect(bakeryDayKey(new Date('2026-09-10T02:59:59.000Z'))).toBe('2026-09-09')
  })

  it('faz o texto copiado pela Geolar usar a mesma data exibida na folha', () => {
    expect(productionPageSource).toContain(
      'generateWhatsApp(geolarOrders, scope, geolarDate)',
    )
    expect(productionPageSource).toContain(
      'const dLabel = selectedDate ? dateLabel(selectedDate) : deliveryDayLabel(delivIdx)',
    )
  })

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

  it('inclui produto de Forno sem cadastro duplicado em pães', () => {
    expect(buildPjPrintSheet(breads, [{
      product_source: 'product',
      product_id: 'produto-sem-vinculo',
      product_name: 'Baguete de Alecrim',
      production_unit: 'un',
      quantity: 12,
    }])).toContainEqual({
      breadId: 'product:produto-sem-vinculo',
      breadName: 'Baguete de Alecrim',
      storeQuantities: [0, 0, 0],
      storeTotal: 0,
      pjQuantity: 12,
      total: 12,
    })
  })

  it('usa o contrato novo com reserva para a versão anterior do banco', () => {
    expect(productionPageSource).toContain("supabase.rpc('list_pj_production_for_oven_v2'")
    expect(productionPageSource).toContain("supabase.rpc('list_pj_production_for_oven'")
    expect(productionPageSource).toContain('isMissingPjPrintContract(error)')
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
