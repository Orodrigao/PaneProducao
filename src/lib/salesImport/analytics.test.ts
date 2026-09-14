import { describe, expect, it } from 'vitest'
import { coverageLabel, saleUnitsForProduct, salesPeriodForPreset } from './analytics'

describe('salesPeriodForPreset', () => {
  const now = new Date('2026-09-14T12:00:00-03:00')

  it('abre nos últimos 30 dias incluindo hoje', () => {
    expect(salesPeriodForPreset('30', now)).toEqual({ start: '2026-08-16', end: '2026-09-14' })
  })

  it('oferece hoje, sete dias e o mês corrente sem depender de UTC', () => {
    expect(salesPeriodForPreset('today', now)).toEqual({ start: '2026-09-14', end: '2026-09-14' })
    expect(salesPeriodForPreset('7', now)).toEqual({ start: '2026-09-08', end: '2026-09-14' })
    expect(salesPeriodForPreset('month', now)).toEqual({ start: '2026-09-01', end: '2026-09-14' })
  })
})

describe('sales analytics helpers', () => {
  it('mantém a unidade do produto e acrescenta somente formas ativas', () => {
    expect(saleUnitsForProduct('kg', [
      { sale_unit: 'un', active: true },
      { sale_unit: 'litro', active: true },
      { sale_unit: 'kg', active: false },
    ])).toEqual(['kg', 'un'])
  })

  it('explica cobertura completa e buracos sem chamar ausência de venda zero', () => {
    expect(coverageLabel({ expected_days: 3, imported_days: 1, explained_days: 1, missing_dates: ['2026-09-03'] }))
      .toBe('2 de 3 dias explicados · faltam 1.')
    expect(coverageLabel({ expected_days: 3, imported_days: 2, explained_days: 1, missing_dates: [] }))
      .toBe('3 de 3 dias explicados.')
  })
})
