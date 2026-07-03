import { describe, expect, it } from 'vitest'
import { calculateCashClosingTotals, parseMoneyInput } from './cashClosing'

const baseInput = {
  salesAmount: 0,
  banriAmount: 0,
  sitefAmount: 0,
  pixAmount: 0,
  cashAmount: 0,
  siteSalesAmount: 0,
  ifoodSalesAmount: 0,
  totalAmount: 0,
  cashWithdrawalAmount: 0,
  openingCashAmount: 0,
  closingCashAmount: 0,
  envelopeAmount: 0,
  nextDayCashAmount: 0,
}

describe('cashClosing', () => {
  it('calcula totais e diferencas de fechamento', () => {
    const totals = calculateCashClosingTotals({
      ...baseInput,
      salesAmount: 900,
      siteSalesAmount: 50,
      ifoodSalesAmount: 50,
      banriAmount: 300,
      sitefAmount: 200,
      pixAmount: 250,
      cashAmount: 250,
      totalAmount: 1000,
      openingCashAmount: 200,
      cashWithdrawalAmount: 100,
      closingCashAmount: 350,
      envelopeAmount: 150,
      nextDayCashAmount: 200,
    })

    expect(totals.paymentTotal).toBe(1000)
    expect(totals.channelSalesTotal).toBe(1000)
    expect(totals.paymentDifference).toBe(0)
    expect(totals.channelDifference).toBe(0)
    expect(totals.expectedClosingCash).toBe(350)
    expect(totals.cashDifference).toBe(0)
    expect(totals.cashSplitTotal).toBe(350)
    expect(totals.cashSplitDifference).toBe(0)
  })

  it('mantem centavos estaveis sem erro de ponto flutuante', () => {
    const totals = calculateCashClosingTotals({
      ...baseInput,
      banriAmount: 0.1,
      sitefAmount: 0.2,
      totalAmount: 0.3,
    })

    expect(totals.paymentTotal).toBe(0.3)
    expect(totals.paymentDifference).toBe(0)
  })

  it('parseia valores em formato brasileiro', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56)
    expect(parseMoneyInput('R$ 25,5')).toBe(25.5)
    expect(parseMoneyInput('')).toBe(0)
    expect(parseMoneyInput('abc')).toBe(0)
  })
})
