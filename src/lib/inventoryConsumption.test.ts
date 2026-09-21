import { describe, expect, it } from 'vitest'
import type { AppUser } from '@/lib/auth'
import {
  canViewInventoryConsumption,
  consumptionStatusInfo,
  formatPeriodDate,
  sortConsumptionItems,
  summarizeConsumption,
  type InventoryConsumptionItem,
  type InventoryConsumptionPeriod,
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
