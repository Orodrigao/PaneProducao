import { describe, expect, it, vi } from 'vitest'

// O módulo cria o cliente Supabase ao ser importado; estes testes só exercitam
// as funções puras, então o cliente é dispensado.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import {
  buildFinanceRecurringForecasts,
  competenceMonthOf,
  entryDifference,
  currentMonthKey,
  emptyFinanceDraft,
  emptyFinanceTransferDraft,
  entrySignedAmount,
  financeSourceLabel,
  formatCompetenceMonth,
  monthRange,
  summarizeEntries,
  transferLegIsInflow,
  validateFinanceDraft,
  validateFinanceRecurringRuleDraft,
  validateFinanceTransferDraft,
  type FinanceCategoryRow,
  type FinanceEntryDraft,
  type FinanceEntryRow,
  type FinanceRecurringRuleDraft,
  type FinanceRecurringRuleRow,
  type FinanceTransferDraft,
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
    store: 'jc', competence_month: '2026-08-01', paid_date: TODAY,
    planned_amount: 150, amount: 150,
    payment_method: 'dinheiro', description: 'Diária do Marcelo',
    source: 'avulso', source_ref: null, recurrence_month: null,
    transfer_id: null, transfer_leg: null, reversal_of: null,
    reversal_reason: null, reversed_at: null, created_at: '2026-08-12T12:00:00Z',
    ...overrides,
  }
}

function recurringRule(overrides: Partial<FinanceRecurringRuleRow> = {}): FinanceRecurringRuleRow {
  return {
    id: 'rule-aluguel', name: 'Aluguel da JC', category_id: 'cat-diarias', store: 'jc',
    planned_amount: 2000, due_day: 31, start_month: '2026-01-01', end_month: null,
    default_account_id: 'acc-1', default_payment_method: 'boleto', active: true,
    ...overrides,
  }
}

function recurringDraft(overrides: Partial<FinanceRecurringRuleDraft> = {}): FinanceRecurringRuleDraft {
  return {
    name: 'Aluguel da JC', categoryKey: 'ocupacao', store: 'jc', plannedAmount: '2.000,00',
    dueDay: '10', startMonth: '2026-08', endMonth: '', defaultAccountKey: 'banco_sicredi_jc',
    defaultPaymentMethod: 'boleto',
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

describe('recorrências', () => {
  it('valida os dados que definem a previsão mensal', () => {
    expect(validateFinanceRecurringRuleDraft(recurringDraft())).toBeNull()
    expect(validateFinanceRecurringRuleDraft(recurringDraft({ defaultAccountKey: '' }))).toMatch(/conta habitual/i)
    expect(validateFinanceRecurringRuleDraft(recurringDraft({ endMonth: '2026-07' }))).toMatch(/fim da vigência/i)
  })

  it('calcula a pendência virtual e ajusta dia 31 para fevereiro', () => {
    const [forecast] = buildFinanceRecurringForecasts([recurringRule()], [], '2026-02')
    expect(forecast.dueDate).toBe('2026-02-28')
    expect(forecast.entry).toBeNull()
  })

  it('some depois da vigência e mostra o pagamento confirmado no mês certo', () => {
    const rule = recurringRule({ end_month: '2026-08-01' })
    const paid = entry({
      source: 'recorrencia', source_ref: rule.id, recurrence_month: '2026-08-01', amount: 2050,
    })
    expect(buildFinanceRecurringForecasts([rule], [paid], '2026-08')[0]?.entry?.amount).toBe(2050)
    expect(buildFinanceRecurringForecasts([rule], [paid], '2026-09')).toEqual([])
  })

  it('volta a mostrar a pendência se o lançamento do mês foi estornado', () => {
    const reversed = entry({
      source: 'recorrencia', source_ref: 'rule-aluguel', recurrence_month: '2026-08-01', reversed_at: '2026-08-12T12:00:00Z',
    })
    expect(buildFinanceRecurringForecasts([recurringRule()], [reversed], '2026-08')[0]?.entry).toBeNull()
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

describe('transferencia entre contas', () => {
  const transferencia: FinanceCategoryRow = {
    id: 'cat-transferencia', key: 'transferencia', label: 'Transferência entre contas',
    dre_tier: 'transferencia', dre_group: 'transferencia', nature: 'transferencia', team: null, sort_order: 510,
  }

  function transferDraft(overrides: Partial<FinanceTransferDraft> = {}): FinanceTransferDraft {
    return {
      ...emptyFinanceTransferDraft(),
      originAccountKey: 'caixa_fisico_jc',
      destinationAccountKey: 'sicredi_jc',
      amount: '800,00',
      transferDate: TODAY,
      note: '',
      ...overrides,
    }
  }

  it('aceita a sangria do caixa da JC para o banco', () => {
    expect(validateFinanceTransferDraft(transferDraft(), TODAY)).toBeNull()
  })

  it('recusa origem igual ao destino', () => {
    expect(validateFinanceTransferDraft(transferDraft({ destinationAccountKey: 'caixa_fisico_jc' }), TODAY))
      .toBe('A conta de origem e a de destino precisam ser diferentes.')
  })

  it('recusa valor zerado e data no futuro', () => {
    expect(validateFinanceTransferDraft(transferDraft({ amount: '0' }), TODAY))
      .toBe('Informe um valor maior que zero.')
    expect(validateFinanceTransferDraft(transferDraft({ transferDate: '2026-08-13' }), TODAY))
      .toBe('A data da transferência não pode ser no futuro.')
  })

  it('nao deixa passar valor acima do limite do banco', () => {
    expect(validateFinanceTransferDraft(transferDraft({ amount: '1000000,01' }), TODAY))
      .toBe('Valor acima do limite permitido. Confira o que foi digitado.')
  })

  // O ponto central da fase: dinheiro que só troca de conta não pode virar
  // despesa nem receita do mês (decisão 7 de docs/FINANCEIRO.md).
  it('nao entra no resumo do mes', () => {
    const categories = new Map([
      [despesa.id, despesa], [receita.id, receita], [transferencia.id, transferencia],
    ])
    const totals = summarizeEntries([
      entry({ id: 'a', category_id: despesa.id, amount: 150 }),
      entry({ id: 'saida', category_id: transferencia.id, amount: 800, transfer_id: 't-1', transfer_leg: 'saida' }),
      entry({ id: 'entrada', category_id: transferencia.id, amount: 800, transfer_id: 't-1', transfer_leg: 'entrada' }),
    ], categories)
    expect(totals).toEqual({ receita: 0, despesa: 150, saldo: -150 })
  })

  it('nao tem efeito no caixa pela natureza da categoria', () => {
    expect(entrySignedAmount(entry({ amount: 800 }), 'transferencia')).toBe(0)
  })

  it('o sinal de cada perna vem do lado, e o estorno inverte os dois', () => {
    expect(transferLegIsInflow({ entry_type: 'lancamento', transfer_leg: 'saida' })).toBe(false)
    expect(transferLegIsInflow({ entry_type: 'lancamento', transfer_leg: 'entrada' })).toBe(true)
    expect(transferLegIsInflow({ entry_type: 'estorno', transfer_leg: 'saida' })).toBe(true)
    expect(transferLegIsInflow({ entry_type: 'estorno', transfer_leg: 'entrada' })).toBe(false)
  })
})

describe('diferenca entre previsto e realizado', () => {
  it('mostra o juro pago a mais', () => {
    expect(entryDifference({ planned_amount: 1000, amount: 1020 })).toBe(20)
  })

  it('mostra o desconto obtido', () => {
    expect(entryDifference({ planned_amount: 1000, amount: 980 })).toBe(-20)
  })

  it('e zero quando pagou o previsto', () => {
    expect(entryDifference({ planned_amount: 150, amount: 150 })).toBe(0)
  })

  it('nao deixa sobra de arredondamento aparecer como diferenca', () => {
    expect(entryDifference({ planned_amount: 0.1 + 0.2, amount: 0.3 })).toBe(0)
  })
})

describe('financeSourceLabel', () => {
  it('nomeia as origens automaticas, inclusive o contas a receber', () => {
    expect(financeSourceLabel('contas_receber')).toBe('Contas a receber')
    expect(financeSourceLabel('contas_pagar')).toBe('Contas a pagar')
  })

  it('mostra a chave crua quando a origem e nova no banco e ainda nao tem nome', () => {
    // O check de finance_entries.source vive no banco; o mapa de nomes vive no
    // codigo. Quando os dois discordarem, o usuario le a chave, nunca
    // "undefined" — que foi o defeito da estreia do contas a receber.
    expect(financeSourceLabel('origem_que_ainda_nao_existe')).toBe('origem_que_ainda_nao_existe')
  })
})
