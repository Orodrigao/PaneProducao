import { describe, expect, it } from 'vitest'
import { customPeriod, readCustomPeriod } from './periodFilter'

describe('período Custom dos relatórios', () => {
  it('datas completas viram o dia inteiro, do início do primeiro ao fim do último', () => {
    const period = customPeriod('2026-09-01', '2026-09-29')
    expect(period).not.toBeNull()
    expect(period?.from).toEqual(new Date(2026, 8, 1, 0, 0, 0))
    expect(period?.to).toEqual(new Date(2026, 8, 29, 23, 59, 59))
  })

  it('campo "até" apagado não gera período', () => {
    expect(customPeriod('2026-09-01', '')).toBeNull()
  })

  it('campo "de" apagado não gera período', () => {
    expect(customPeriod('', '2026-09-29')).toBeNull()
  })

  it('data parcial não gera período', () => {
    for (const partial of ['2026-09', '2026-9-1', '2026-09-', ' 2026-09-01', 'NaN-NaN-NaN']) {
      expect(customPeriod('2026-09-01', partial)).toBeNull()
    }
  })

  it('ano no meio da digitação não gera período', () => {
    // Ao digitar 2026 no campo, o navegador passa por 0002, 0020 e 0202.
    for (const typing of ['0002-09-29', '0020-09-29', '0202-09-29', '20261-09-29']) {
      expect(customPeriod('2026-09-01', typing)).toBeNull()
    }
  })

  it('dia que não existe no calendário não gera período', () => {
    expect(customPeriod('2026-02-30', '2026-09-29')).toBeNull()
    expect(customPeriod('2026-09-01', '2026-13-01')).toBeNull()
  })

  it('período gerado nunca contém data inválida', () => {
    const period = customPeriod('2026-02-28', '2026-03-01')
    expect(period).not.toBeNull()
    expect(Number.isNaN(period?.from.getTime())).toBe(false)
    expect(Number.isNaN(period?.to.getTime())).toBe(false)
  })

  it('data inicial depois da final não gera período', () => {
    expect(customPeriod('2026-09-29', '2026-09-01')).toBeNull()
    // Um dia de diferença na virada do ano também conta.
    expect(customPeriod('2027-01-01', '2026-12-31')).toBeNull()
  })

  it('mesmo dia no início e no fim é o dia inteiro', () => {
    const period = customPeriod('2026-09-15', '2026-09-15')
    expect(period?.from).toEqual(new Date(2026, 8, 15, 0, 0, 0))
    expect(period?.to).toEqual(new Date(2026, 8, 15, 23, 59, 59))
  })
})

describe('motivo de o período Custom não valer', () => {
  it('data apagada ou parcial é incompleta', () => {
    expect(readCustomPeriod('2026-09-01', '')).toEqual({ period: null, issue: 'incomplete' })
    expect(readCustomPeriod('2026-09', '2026-09-29')).toEqual({ period: null, issue: 'incomplete' })
  })

  it('início depois do fim é invertido', () => {
    expect(readCustomPeriod('2026-09-29', '2026-09-01')).toEqual({ period: null, issue: 'inverted' })
  })

  it('data incompleta vence o invertido: não dá para comparar o que ainda não é data', () => {
    expect(readCustomPeriod('2026-09-29', '0202-09-01')).toEqual({ period: null, issue: 'incomplete' })
  })

  it('período válido não tem motivo', () => {
    expect(readCustomPeriod('2026-09-01', '2026-09-29').issue).toBeNull()
    expect(readCustomPeriod('2026-09-15', '2026-09-15').issue).toBeNull()
  })
})
