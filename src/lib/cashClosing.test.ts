import { describe, expect, it } from 'vitest'
import {
  calculateCashClosingTotals,
  cashClosingDifferences,
  describeCashClosingConflict,
  isCashClosingSaveConflict,
  notesWithReplacement,
  parseMoneyInput,
  wasSavedMeanwhile,
} from './cashClosing'

const baseInput = {
  banriAmount: 0,
  sitefAmount: 0,
  pixAmount: 0,
  siteSalesAmount: 0,
  ifoodSalesAmount: 0,
  cashWithdrawalAmount: 0,
  openingCashAmount: 0,
  closingCashAmount: 0,
  envelopeAmount: 0,
  nextDayCashAmount: 0,
}

describe('cashClosing', () => {
  it('calcula venda em dinheiro pelo dinheiro contado, sangrias e abertura', () => {
    const totals = calculateCashClosingTotals({
      ...baseInput,
      banriAmount: 300,
      siteSalesAmount: 400,
      sitefAmount: 200,
      pixAmount: 250,
      openingCashAmount: 170,
      cashWithdrawalAmount: 241.88,
      closingCashAmount: 1786,
      ifoodSalesAmount: 999,
      envelopeAmount: 1700,
      nextDayCashAmount: 86,
    })

    expect(totals.cashSalesAmount).toBe(1857.88)
    expect(totals.nonCashPaymentTotal).toBe(1150)
    expect(totals.declaredTotal).toBe(3007.88)
    expect(totals.cashSplitTotal).toBe(1786)
  })

  it('mantem ifood, envelope e proximo dia fora do total do dia', () => {
    const totals = calculateCashClosingTotals({
      ...baseInput,
      closingCashAmount: 100,
      ifoodSalesAmount: 50,
      envelopeAmount: 70,
      nextDayCashAmount: 30,
    })

    expect(totals.cashSalesAmount).toBe(100)
    expect(totals.declaredTotal).toBe(100)
    expect(totals.cashSplitTotal).toBe(100)
  })

  it('mantem centavos estaveis sem erro de ponto flutuante', () => {
    const totals = calculateCashClosingTotals({
      ...baseInput,
      banriAmount: 0.1,
      sitefAmount: 0.2,
    })

    expect(totals.nonCashPaymentTotal).toBe(0.3)
    expect(totals.declaredTotal).toBe(0.3)
  })

  it('parseia valores em formato brasileiro', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56)
    expect(parseMoneyInput('R$ 25,5')).toBe(25.5)
    expect(parseMoneyInput('')).toBe(0)
    expect(parseMoneyInput('abc')).toBe(0)
  })

  it('reconhece como conflito so a recusa de fechamento repetido e a atualizacao que nao achou a versao lida', () => {
    expect(isCashClosingSaveConflict({ code: '23505' })).toBe(true)
    expect(isCashClosingSaveConflict({ code: 'PGRST116' })).toBe(true)
    expect(isCashClosingSaveConflict({ code: '42501' })).toBe(false)
    expect(isCashClosingSaveConflict({ code: '23514' })).toBe(false)
    expect(isCashClosingSaveConflict({})).toBe(false)
    expect(isCashClosingSaveConflict(null)).toBe(false)
  })

  it('so confirma o conflito quando o banco tem versao diferente da que a tela leu', () => {
    const lida = '2026-10-08T23:09:27.296422+00:00'
    const nova = '2026-10-08T23:12:05.118000+00:00'

    // A tela achou que era fechamento novo e o banco ja tem um.
    expect(wasSavedMeanwhile(null, lida)).toBe(true)
    // A tela editava uma versao que outra pessoa ja trocou.
    expect(wasSavedMeanwhile(lida, nova)).toBe(true)
    // Mesma versao: a recusa veio de outro motivo, nao de gravacao alheia.
    expect(wasSavedMeanwhile(lida, lida)).toBe(false)
    // O banco nao mostrou fechamento nenhum: nada a comparar.
    expect(wasSavedMeanwhile(null, null)).toBe(false)
    expect(wasSavedMeanwhile(lida, null)).toBe(false)
  })

  it('explica quem salvou, quando e que os numeros da tela nao foram gravados', () => {
    expect(describeCashClosingConflict('Suélen', '20:09')).toBe(
      'Suélen salvou este fechamento às 20:09, enquanto esta tela estava aberta. Os números da sua tela ainda não foram gravados.',
    )
    expect(describeCashClosingConflict('  ', '')).toBe(
      'Outra pessoa salvou este fechamento, enquanto esta tela estava aberta. Os números da sua tela ainda não foram gravados.',
    )
  })

  it('aponta os campos diferentes ao centavo, inclusive com o mesmo total', () => {
    const saved = { ...baseInput, closingCashAmount: 272, banriAmount: 300, siteSalesAmount: 100 }

    expect(cashClosingDifferences(saved, { ...saved })).toEqual([])
    expect(cashClosingDifferences(saved, { ...saved, closingCashAmount: 272.001 })).toEqual([])
    // Mesmo total do dia, maquininha trocada.
    expect(cashClosingDifferences(saved, { ...saved, banriAmount: 100, siteSalesAmount: 300 })).toEqual([
      'banriAmount',
      'siteSalesAmount',
    ])
    expect(cashClosingDifferences(saved, { ...saved, closingCashAmount: 510, envelopeAmount: 272 })).toEqual([
      'closingCashAmount',
      'envelopeAmount',
    ])
  })

  it('guarda nas observacoes o fechamento que foi substituido, sem perder o que ja estava escrito', () => {
    const replaced = { savedBy: 'Suélen', savedAtTime: '20:09', totalAmount: 4294.93, cashAmount: 615.93 }
    const line = notesWithReplacement('', replaced)

    expect(line).toContain('Substituiu o fechamento de Suélen às 20:09')
    expect(line).toMatch(/total do dia R\$\s4\.294,93/)
    expect(line).toMatch(/venda em dinheiro R\$\s615,93/)
    expect(notesWithReplacement('  maquininha caiu  ', replaced)).toBe(`maquininha caiu\n${line}`)
  })
})
