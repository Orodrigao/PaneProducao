import { describe, expect, it } from 'vitest'
import {
  calculateCashClosingTotals,
  cashClosingDifferences,
  describeCashClosingConflict,
  isCashClosingSaveConflict,
  isUncertainWriteResult,
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
    expect(describeCashClosingConflict('Suélen', '08/10 20:09')).toBe(
      'Suélen salvou este fechamento em 08/10 20:09, enquanto esta tela estava aberta. Os números da sua tela ainda não foram gravados.',
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

  it('guarda nas observacoes o que estava gravado: total, campos que mudam e observacoes da outra pessoa', () => {
    const replaced = {
      savedBy: 'Suélen',
      savedAt: '08/10 20:09',
      totalAmount: 4294.93,
      fields: [
        { label: '1. Total em dinheiro', amount: 272 },
        { label: '3. Banrisul credito/debito', amount: 300 },
      ],
      savedNotes: 'Stone caiu às 14h',
    }
    const line = notesWithReplacement('', replaced)

    expect(line).toContain('Substituiu o fechamento que Suélen salvou em 08/10 20:09')
    expect(line).toMatch(/total do dia R\$\s4\.294,93; 1\. Total em dinheiro R\$\s272,00; 3\. Banrisul credito\/debito R\$\s300,00\./)
    expect(line).toContain('Obs. de Suélen: Stone caiu às 14h]')
    // O que a pessoa escreveu fica, e a anotacao vem depois.
    expect(notesWithReplacement('  maquininha caiu  ', replaced)).toBe(`maquininha caiu\n${line}`)
    // Observacao igual a da tela nao se repete.
    expect(notesWithReplacement('Stone caiu às 14h', replaced)).not.toContain('Obs. de Suélen')
  })

  it('nao aninha nem dobra a anotacao em trocas seguidas de substituicao', () => {
    const base = { savedAt: '08/10 20:09', totalAmount: 100, fields: [] }
    // B substitui A; depois A substitui B, cujas observacoes ja trazem a 1a anotacao.
    const bNotes = notesWithReplacement('obs de B', { ...base, savedBy: 'A', savedNotes: 'obs de A' })
    const aNotes = notesWithReplacement('obs de A', { ...base, savedBy: 'B', savedNotes: bNotes })
    // B, com a tela ainda trazendo a 1a anotacao, substitui de novo.
    const again = notesWithReplacement(bNotes, { ...base, savedBy: 'A', savedNotes: aNotes })

    expect(again.match(/obs de B/g)).toHaveLength(2)
    expect(again.length).toBeLessThan(bNotes.length + 500)
    // A anotacao de quem ja tinha substituido nao repete o que a tela traz.
    const sameScreen = notesWithReplacement('minhas obs', { ...base, savedBy: 'Eu', savedNotes: 'minhas obs\n[Substituiu X]' })
    expect(sameScreen).toBe('minhas obs\n[Substituiu o fechamento que Eu salvou em 08/10 20:09: total do dia R$\u00a0100,00. Obs. de Eu: [Substituiu X]]')
  })

  it('so trata como incerta a gravacao sem resposta do banco ou com erro do gateway', () => {
    expect(isUncertainWriteResult({ status: 0 })).toBe(true)
    expect(isUncertainWriteResult({ status: 504 })).toBe(true)
    expect(isUncertainWriteResult({ status: 409 })).toBe(false)
    expect(isUncertainWriteResult({ status: 406 })).toBe(false)
    expect(isUncertainWriteResult({ status: 403 })).toBe(false)
    expect(isUncertainWriteResult({ status: 201 })).toBe(false)
  })

  it('avisa de outro jeito quando a versao gravada e da propria pessoa', () => {
    expect(describeCashClosingConflict('Rodrigo', '08/10 20:09', true)).toBe(
      'Você já tinha salvo este fechamento em 08/10 20:09, em outra tentativa ou em outro aparelho, com números ou observações diferentes. O que está nesta tela ainda não foi gravado.',
    )
  })
})
