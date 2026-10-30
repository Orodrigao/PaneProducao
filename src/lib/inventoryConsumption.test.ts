import { describe, expect, it } from 'vitest'
import type { AppUser } from '@/lib/auth'
import {
  buildConsumptionTrend,
  canViewConsumptionRevenue,
  canViewInventoryConsumption,
  cmvOverRevenue,
  formatPercent,
  consumptionStatusInfo,
  formatPeriodDate,
  isTrendRowFlagged,
  nonCatalogPurchases,
  sortConsumptionItems,
  summarizeConsumption,
  type InventoryConsumptionItem,
  type InventoryConsumptionPeriod,
  type InventoryConsumptionRevenue,
} from './inventoryConsumption'

function user(overrides: Partial<AppUser>): AppUser {
  return {
    id: 'u1',
    username: 'teste',
    displayName: 'Teste',
    role: 'financeiro',
    active: true,
    store: 'jc',
    allowedRoutes: ['/estoque'],
    permissions: [],
    ...overrides,
  }
}

const period: InventoryConsumptionPeriod = {
  period_start_count_id: 'a',
  period_end_count_id: 'b',
  period_start_date: '2026-09-26',
  period_end_date: '2026-10-03',
  period_days: 7,
  end_closed_at: '2026-10-03T15:00:00Z',
  purchases_total: '1210.00',
  purchases_counted: '1075.00',
  purchases_outside_count: '80.00',
  purchases_unclassified: '0',
  purchases_not_stock: '15.00',
  unclassified_lines: 0,
  late_lines: 0,
}

function item(overrides: Partial<InventoryConsumptionItem>): InventoryConsumptionItem {
  return {
    period_end_count_id: 'b',
    product_id: 'p',
    product_name: 'Insumo',
    product_category: 'INSUMOS',
    unit: 'kg',
    qty_start: '10.000',
    qty_in: '0.000',
    qty_end: '5.000',
    qty_consumed: '5.000',
    unit_cost: '2.0000',
    value_consumed: '10.00',
    purchase_lines: 0,
    lines_without_quantity: 0,
    edge_lines: 0,
    late_lines: 0,
    status: 'ok',
    ...overrides,
  }
}

describe('canViewInventoryConsumption', () => {
  it('libera admin e quem ve as compras da JC', () => {
    expect(canViewInventoryConsumption(user({ role: 'admin' }))).toBe(true)
    expect(canViewInventoryConsumption(user({
      permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'jc' }],
    }))).toBe(true)
    expect(canViewInventoryConsumption(user({
      permissions: [{ permission_key: 'contas_pagar.acessar', scope: '*' }],
    }))).toBe(true)
  })

  it('bloqueia quem conta mas nao ve custo, e escopo de outra loja', () => {
    expect(canViewInventoryConsumption(null)).toBe(false)
    expect(canViewInventoryConsumption(user({
      role: 'expedicao',
      permissions: [{ permission_key: 'estoque.contar_semanal', scope: 'jc' }],
    }))).toBe(false)
    expect(canViewInventoryConsumption(user({
      permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'ja' }],
    }))).toBe(false)
  })
})

describe('consumptionStatusInfo', () => {
  it('situacao desconhecida vinda do banco nunca libera numero', () => {
    const info = consumptionStatusInfo('novo_status_do_banco')
    expect(info.tone).toBe('blocked')
    expect(info.label).toBe('novo_status_do_banco')
  })
})

describe('summarizeConsumption', () => {
  it('soma so as linhas com numero e marca o total como parcial quando falta alguma', () => {
    const summary = summarizeConsumption(period, [
      item({ value_consumed: '802.82' }),
      item({ status: 'conferir', value_consumed: '-100.00' }),
      item({ status: 'incompleto', qty_consumed: null, unit_cost: null, value_consumed: null }),
    ])
    expect(summary.totalValue).toBe(702.82)
    expect(summary.itemsWithValue).toBe(2)
    expect(summary.itemsBlocked).toBe(1)
    expect(summary.itemsToCheck).toBe(1)
    expect(summary.isPartial).toBe(true)
  })

  it('total completo so quando todo insumo tem valor e nao ha nota sem classificacao', () => {
    expect(summarizeConsumption(period, [item({})]).isPartial).toBe(false)
    expect(summarizeConsumption({ ...period, unclassified_lines: 1 }, [item({})]).isPartial).toBe(true)
    expect(summarizeConsumption(period, [item({ status: 'sem_custo', value_consumed: null })]).isPartial).toBe(true)
  })

  it('intervalo diferente de uma semana e sinalizado', () => {
    expect(summarizeConsumption(period, []).isIrregularPeriod).toBe(false)
    expect(summarizeConsumption({ ...period, period_days: 14 }, []).isIrregularPeriod).toBe(true)
  })
})

describe('sortConsumptionItems', () => {
  it('pendencias primeiro, depois conferir, depois os maiores valores', () => {
    const sorted = sortConsumptionItems([
      item({ product_id: 'pequeno', value_consumed: '10.00' }),
      item({ product_id: 'conferir', status: 'conferir', value_consumed: '-5.00' }),
      item({ product_id: 'grande', value_consumed: '900.00' }),
      item({ product_id: 'pendente', status: 'nao_contado', value_consumed: null }),
    ])
    expect(sorted.map(row => row.product_id)).toEqual(['pendente', 'conferir', 'grande', 'pequeno'])
  })
})

describe('formatPeriodDate', () => {
  it('le a data do banco sem deslocar o dia pelo fuso', () => {
    expect(formatPeriodDate('2026-09-26')).toBe('26/09')
  })
})

function revenue(overrides: Partial<InventoryConsumptionRevenue>): InventoryConsumptionRevenue {
  return {
    period_end_count_id: 'b',
    cash_jc: '2500.00',
    cash_jc_days: 6,
    cash_ja: '400.00',
    cash_ja_days: 6,
    cash_ifood: '0',
    cash_jc_missing_days: 0,
    cash_ja_missing_days: 0,
    pj_orders: '300.00',
    pj_orders_lines: 2,
    ex_billed: '1300.00',
    ex_days_billed: 7,
    revenue_total: '4500.00',
    ...overrides,
  }
}

describe('canViewConsumptionRevenue', () => {
  it('exige o Contas a pagar da JC e tambem o Contas a receber', () => {
    expect(canViewConsumptionRevenue(user({ role: 'admin' }))).toBe(true)
    expect(canViewConsumptionRevenue(user({
      permissions: [
        { permission_key: 'contas_pagar.acessar', scope: 'jc' },
        { permission_key: 'contas_receber.acessar', scope: '*' },
      ],
    }))).toBe(true)
  })

  it('so um dos dois nao basta', () => {
    expect(canViewConsumptionRevenue(user({
      permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'jc' }],
    }))).toBe(false)
    expect(canViewConsumptionRevenue(user({
      permissions: [{ permission_key: 'contas_receber.acessar', scope: '*' }],
    }))).toBe(false)
    expect(canViewConsumptionRevenue(user({
      permissions: [
        { permission_key: 'contas_pagar.acessar', scope: 'jc' },
        { permission_key: 'contas_receber.acessar', scope: 'ja' },
      ],
    }))).toBe(false)
    expect(canViewConsumptionRevenue(null)).toBe(false)
  })
})

describe('nonCatalogPurchases (revenda sem cadastro)', () => {
  it('separa o que ficou fora do cadastro em uso ou despesa e revenda sem cadastro', () => {
    expect(nonCatalogPurchases({ ...period, purchases_not_stock: '135.00', purchases_resale_no_catalog: '105.00' }))
      .toEqual({ expense: 30, resale: 105 })
  })

  it('banco anterior à revenda sem cadastro, sem a coluna: tudo é uso ou despesa, como era', () => {
    expect(nonCatalogPurchases(period)).toEqual({ expense: 15, resale: 0 })
    expect(nonCatalogPurchases({ ...period, purchases_resale_no_catalog: null })).toEqual({ expense: 15, resale: 0 })
  })

  it('centavos não sobram na subtração', () => {
    expect(nonCatalogPurchases({ ...period, purchases_not_stock: '0.30', purchases_resale_no_catalog: '0.10' }).expense).toBe(0.2)
  })
})

describe('cmvOverRevenue', () => {
  const completo = summarizeConsumption(period, [item({ value_consumed: '900.00' })])

  it('revenda sem cadastro fica fora do % e o valor vai junto para a tela dizer', () => {
    const comRevenda = { ...period, purchases_not_stock: '120.00', purchases_resale_no_catalog: '105.00' }
    const cmv = cmvOverRevenue(comRevenda, summarizeConsumption(comRevenda, [item({ value_consumed: '900.00' })]), revenue({}))
    // O % é o mesmo de antes: a revenda não entra no consumo contado.
    expect(cmv.percent).toBe(20)
    expect(cmv.resaleExcluded).toBe(105)
  })

  it('sem revenda sem cadastro, nada a avisar', () => {
    expect(cmvOverRevenue(period, completo, revenue({})).resaleExcluded).toBe(0)
  })

  it('divide o consumo pela venda total da semana', () => {
    const cmv = cmvOverRevenue(period, completo, revenue({}))
    expect(cmv.revenueTotal).toBe(4500)
    expect(cmv.percent).toBe(20)
    expect(cmv.gaps).toEqual([])
    expect(cmv.isPartial).toBe(false)
  })

  it('cobranca da EX faltando deixa a venda incompleta', () => {
    const cmv = cmvOverRevenue(period, completo, revenue({ ex_days_billed: 1 }))
    expect(cmv.gaps).toEqual(['cobranca_ex'])
    expect(cmv.isPartial).toBe(true)
  })

  it('dia sem fechamento de caixa deixa a venda incompleta', () => {
    const cmv = cmvOverRevenue(period, completo, revenue({ cash_ja_missing_days: 1 }))
    expect(cmv.gaps).toEqual(['caixa_faltando'])
    expect(cmv.isPartial).toBe(true)
  })

  it('semana sem nenhum insumo com valor nao mostra 0%', () => {
    const vazio = summarizeConsumption(period, [])
    expect(cmvOverRevenue(period, vazio, revenue({})).percent).toBeNull()
  })

  it('consumo parcial deixa o % parcial', () => {
    const parcial = summarizeConsumption(period, [item({ status: 'incompleto', value_consumed: null })])
    expect(cmvOverRevenue(period, parcial, revenue({})).isPartial).toBe(true)
  })

  it('insumo para conferir deixa o % parcial', () => {
    const conferir = summarizeConsumption(period, [
      item({ value_consumed: '900.00' }),
      item({ product_id: 'p2', status: 'conferir', value_consumed: '-100.00' }),
    ])
    expect(conferir.isPartial).toBe(false)
    expect(cmvOverRevenue(period, conferir, revenue({})).isPartial).toBe(true)
  })

  it('sem venda nao inventa %', () => {
    const cmv = cmvOverRevenue(period, completo, revenue({ revenue_total: '0' }))
    expect(cmv.percent).toBeNull()
    expect(cmv.gaps).toContain('sem_venda')
    expect(formatPercent(cmv.percent)).toBe('—')
  })

  it('formata o % com uma casa, no padrao brasileiro', () => {
    expect(formatPercent(31.25)).toBe('31,3%')
    expect(formatPercent(20)).toBe('20,0%')
  })
})

describe('buildConsumptionTrend', () => {
  const anterior: InventoryConsumptionPeriod = {
    ...period,
    period_start_count_id: 'z',
    period_end_count_id: 'a',
    period_start_date: '2026-09-19',
    period_end_date: '2026-09-26',
  }

  it('monta uma linha por semana com o consumo da propria semana', () => {
    const rows = buildConsumptionTrend(
      [period, anterior],
      [
        item({ period_end_count_id: 'b', value_consumed: '900.00' }),
        item({ period_end_count_id: 'a', value_consumed: '450.00' }),
      ],
      [revenue({}), revenue({ period_end_count_id: 'a', revenue_total: '3000.00' })],
    )
    expect(rows.map(row => row.summary.totalValue)).toEqual([900, 450])
    expect(rows.map(row => row.cmv?.percent)).toEqual([20, 15])
  })

  it('sem permissao para a venda o quadro mostra so o consumo', () => {
    const rows = buildConsumptionTrend([period], [item({ value_consumed: '900.00' })], null)
    expect(rows[0].cmv).toBeNull()
    expect(rows[0].summary.totalValue).toBe(900)
  })

  it('periodo com mais de 7 dias leva a marca de nao comparavel', () => {
    const duasSemanas = { ...period, period_days: 14 }
    const [normal] = buildConsumptionTrend([period], [item({ value_consumed: '900.00' })], [revenue({})])
    const [longo] = buildConsumptionTrend([duasSemanas], [item({ value_consumed: '900.00' })], null)
    expect(isTrendRowFlagged(normal)).toBe(false)
    expect(isTrendRowFlagged(longo)).toBe(true)
  })

  it('insumo para conferir leva a marca mesmo sem acesso a venda', () => {
    const [row] = buildConsumptionTrend([period], [
      item({ value_consumed: '900.00' }),
      item({ product_id: 'p2', status: 'conferir', value_consumed: '-100.00' }),
    ], null)
    expect(row.cmv).toBeNull()
    expect(isTrendRowFlagged(row)).toBe(true)
  })
})
