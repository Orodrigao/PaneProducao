import { describe, expect, it } from 'vitest'
import {
  aggregateOvenPlan,
  ovenLotCode,
  parseOvenQuantity,
  validateOvenConfirmation,
} from './ovenProduction'

describe('ovenLotCode', () => {
  it('gera o código operacional LMMDD', () => {
    expect(ovenLotCode('2026-07-10')).toBe('L0710')
  })

  it('rejeita datas inexistentes', () => {
    expect(() => ovenLotCode('2026-02-30')).toThrow('Data de produção inválida.')
  })
})

describe('aggregateOvenPlan', () => {
  it('soma as demandas do mesmo pão em origens diferentes', () => {
    const result = aggregateOvenPlan([
      { bread_id: 'integral', quantity: 12 },
      { bread_id: 'integral', quantity: 8 },
      { bread_id: 'italiano', quantity: 5 },
    ])

    expect(result.get('integral')).toBe(20)
    expect(result.get('italiano')).toBe(5)
  })

  it('ignora quantidades vazias, inválidas ou não positivas', () => {
    const result = aggregateOvenPlan([
      { bread_id: 'integral', quantity: null },
      { bread_id: 'integral', quantity: -2 },
      { bread_id: '', quantity: 10 },
    ])

    expect(result.size).toBe(0)
  })
})

describe('parseOvenQuantity', () => {
  it('aceita zero e inteiros positivos', () => {
    expect(parseOvenQuantity('0')).toBe(0)
    expect(parseOvenQuantity(' 22 ')).toBe(22)
  })

  it('rejeita frações, negativos e texto', () => {
    expect(parseOvenQuantity('2.5')).toBeNull()
    expect(parseOvenQuantity('-1')).toBeNull()
    expect(parseOvenQuantity('abc')).toBeNull()
  })
})

describe('validateOvenConfirmation', () => {
  it('exige motivo somente quando há perda', () => {
    expect(validateOvenConfirmation({
      quantityGood: '22',
      quantityLoss: '0',
      lossReason: '',
    })).toBeNull()

    expect(validateOvenConfirmation({
      quantityGood: '22',
      quantityLoss: '1',
      lossReason: '',
    })).toBe('Escolha o motivo da perda.')
  })
})
