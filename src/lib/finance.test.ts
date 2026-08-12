import { describe, expect, it, vi } from 'vitest'

// O módulo cria o cliente Supabase ao ser importado; estes testes só exercitam
// as funções puras, então o cliente é dispensado.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import {
  competenceMonthOf,
  currentMonthKey,
  emptyFinanceDraft,
  entrySignedAmount,
  formatCompetenceMonth,
  monthRange,
  summarizeEntries,
  validateFinanceDraft,
  type FinanceCategoryRow,
  type FinanceEntryDraft,
  type FinanceEntryRow,
} from './finance'

const TODAY = '2026-08-12'

function draft(overrides: Partial<FinanceEntryDraft> = {}): FinanceEntryDraft {
  return {
    ...emptyFinanceDraft(),
    categoryKey: 'mao_obra_diarias',
    accountKey: 'caixa_fisico_jc',
    store: 'jc',
    amount: '150,00',
    paidDate: TODAY,
    paymentMethod: 'dinheiro',
    description: 'Diária do Marcelo',
    ...overrides,
  }
}

const despesa: FinanceCategoryRow = {
  id: 'cat-diarias', key: 'mao_obra_diarias', label: 'Mão de obra — Diárias e extras',
  dre_tier: 'operacional', dre_group: 'mao_de_obra', nature: 'despesa', team: null, sort_order: 270,
}
const receita: FinanceCategoryRow = {
  id: 'cat-balcao', key: 'venda_balcao', label: 'Venda balcão',
  dre_tier: 'operacional', dre_group: 'receita', nature: 'receita', team: null, sort_order: 10,
}

function entry(overrides: Partial<FinanceEntryRow> = {}): FinanceEntryRow {
  return {
    id: 'entry-1', entry_type: 'lancamento', category_id: 'cat-diarias', account_id: 'acc-1',
    store: 'jc', competence_month: '2026-08-01', paid_date: TODAY, amount: 150,
    payment_method: 'dinheiro', description: 'Diária do Marcelo', reversal_of: null,
    reversal_reason: null, reversed_at: null, created_at: '2026-08-12T12:00:00Z',
    ...overrides,
  }
}

describe('validação do lançamento avulso', () => {
  it('aceita o lançamento completo', () => {
    expect(validateFinanceDraft(draft(), TODAY)).toBeNull()
  })

  it('exige categoria, loja e conta', () => {
    expect(validateFinanceDraft(draft({ categoryKey: '' }), TODAY)).toMatch(/categoria/i)
    expect(validateFinanceDraft(draft({ store: '' }), TODAY)).toMatch(/loja/i)
    expect(validateFinanceDraft(draft({ accountKey: '' }), TODAY)).toMatch(/conta ou caixa/i)
  })

  it('recusa valor zerado, negativo ou ilegível', () => {
    expect(validateFinanceDraft(draft({ amount: '0' }), TODAY)).toMatch(/maior que zero/i)
    expect(validateFinanceDraft(draft({ amount: '' }), TODAY)).toMatch(/maior que zero/i)
    expect(validateFinanceDraft(draft({ amount: 'abc' }), TODAY)).toMatch(/maior que zero/i)
  })

  // A lição validar-tambem-na-saida nasceu de um erro de R$ 190 mil: o mesmo
  // teto vale na tela e no banco.
  it('recusa valor acima do teto', () => {
    expect(validateFinanceDraft(draft({ amount: '1000000,01' }), TODAY)).toMatch(/limite/i)
  })

  it('recusa data no futuro e data absurda', () => {
    expect(validateFinanceDraft(draft({ paidDate: '2026-08-13' }), TODAY)).toMatch(/futuro/i)
    expect(validateFinanceDraft(draft({ paidDate: '2019-12-31' }), TODAY)).toMatch(/antiga/i)
  })

  it('exige descrição com significado', () => {
    expect(validateFinanceDraft(draft({ description: '  x ' }), TODAY)).toMatch(/3 letras/i)
  })

  it('aceita o dinheiro em formato brasileiro', () => {
    expect(validateFinanceDraft(draft({ amount: 'R$ 1.234,56' }), TODAY)).toBeNull()
  })
})

describe('competência', () => {
  it('deriva o mês da data do lançamento', () => {
    expect(competenceMonthOf('2026-08-12')).toBe('2026-08-01')
    expect(competenceMonthOf('2026-12-31')).toBe('2026-12-01')
  })

  it('descreve o mês em português', () => {
    expect(formatCompetenceMonth('2026-08')).toBe('agosto de 2026')
  })

  it('calcula o intervalo do mês, inclusive na virada do ano', () => {
    expect(monthRange('2026-08')).toEqual({ start: '2026-08-01', end: '2026-09-01' })
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })

  it('sabe o mês corrente', () => {
    expect(currentMonthKey(TODAY)).toBe('2026-08')
  })
})

describe('efeito do lançamento no caixa', () => {
  it('despesa sai, receita entra', () => {
    expect(entrySignedAmount(entry(), 'despesa')).toBe(-150)
    expect(entrySignedAmount(entry(), 'receita')).toBe(150)
  })

  it('estorno inverte o original', () => {
    expect(entrySignedAmount(entry({ entry_type: 'estorno' }), 'despesa')).toBe(150)
    expect(entrySignedAmount(entry({ entry_type: 'estorno' }), 'receita')).toBe(-150)
  })
})

describe('resumo do mês', () => {
  const categories = new Map([[despesa.id, despesa], [receita.id, receita]])

  it('soma receitas e despesas separadamente', () => {
    const totals = summarizeEntries([
      entry({ id: 'a', category_id: receita.id, amount: 1000 }),
      entry({ id: 'b', category_id: despesa.id, amount: 150 }),
    ], categories)
    expect(totals).toEqual({ receita: 1000, despesa: 150, saldo: 850 })
  })

  it('o estorno zera o lançamento original no total', () => {
    const totals = summarizeEntries([
      entry({ id: 'a', category_id: despesa.id, amount: 150 }),
      entry({ id: 'b', category_id: despesa.id, amount: 150, entry_type: 'estorno', reversal_of: 'a' }),
    ], categories)
    expect(totals).toEqual({ receita: 150, despesa: 150, saldo: 0 })
  })

  it('ignora lançamento de categoria desconhecida em vez de somar errado', () => {
    const totals = summarizeEntries([entry({ category_id: 'cat-que-nao-existe' })], categories)
    expect(totals).toEqual({ receita: 0, despesa: 0, saldo: 0 })
  })
})
