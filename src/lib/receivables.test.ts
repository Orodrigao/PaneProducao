import { describe, expect, it, vi } from 'vitest'

// O módulo cria o cliente Supabase ao ser importado; estes testes só exercitam
// as funções puras, então o cliente é dispensado.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import {
  daysOverdue,
  defaultPaymentDraft,
  emptyReceivableDraft,
  isOverdue,
  sortReceivables,
  summarizeReceivables,
  validateReceivableDraft,
  pjOrderCanBeBilled,
  summarizePjOrdersToBill,
  validateReceivablePaymentDraft,
  type PjOrderToBillRow,
  type ReceivableRow,
} from '@/lib/receivables'

const HOJE = '2026-08-20'

function cobranca(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id: 'r1',
    customer_id: 'c1',
    origin: 'avulso',
    origin_ref: null,
    description: 'Pães da semana',
    invoice_date: '2026-07-20',
    original_due_date: '2026-08-19',
    due_date: '2026-08-19',
    amount: 1200,
    status: 'aberta',
    received_date: null,
    received_amount: null,
    received_method: null,
    received_account_id: null,
    cancel_reason: null,
    created_at: '2026-07-20T10:00:00Z',
    ...overrides,
  }
}

describe('validateReceivableDraft', () => {
  it('exige cliente, valor, data e descrição', () => {
    const vazio = emptyReceivableDraft()
    expect(validateReceivableDraft(vazio, HOJE)).toBe('Escolha o cliente que vai pagar.')
    expect(validateReceivableDraft({ ...vazio, customerId: 'c1' }, HOJE))
      .toBe('Informe um valor maior que zero.')
    expect(validateReceivableDraft({ ...vazio, customerId: 'c1', amount: '100' }, HOJE))
      .toBe('Descreva a cobrança com pelo menos 3 letras.')
  })

  it('recusa faturamento no futuro', () => {
    const draft = { customerId: 'c1', invoiceDate: '2026-08-21', amount: '100', description: 'Pães' }
    expect(validateReceivableDraft(draft, HOJE)).toBe('A data do faturamento não pode ser no futuro.')
  })

  it('recusa valor acima do limite, como o banco faz', () => {
    const draft = { customerId: 'c1', invoiceDate: HOJE, amount: '1000000,01', description: 'Pães' }
    expect(validateReceivableDraft(draft, HOJE))
      .toBe('Valor acima do limite permitido. Confira o que foi digitado.')
  })

  it('aceita uma cobrança bem preenchida', () => {
    const draft = { customerId: 'c1', invoiceDate: '2026-08-19', amount: '1.200,50', description: 'Pães da semana' }
    expect(validateReceivableDraft(draft, HOJE)).toBeNull()
  })
})

describe('validateReceivablePaymentDraft', () => {
  const alvo = cobranca()

  it('recusa recebimento anterior ao faturamento', () => {
    const draft = defaultPaymentDraft(alvo)
    expect(validateReceivablePaymentDraft({ ...draft, receivedDate: '2026-07-01', accountKey: 'banco_sicredi_jc' }, alvo, HOJE))
      .toBe('O recebimento não pode ser anterior ao faturamento.')
  })

  it('exige a conta em que o dinheiro entrou', () => {
    const draft = defaultPaymentDraft(alvo)
    expect(validateReceivablePaymentDraft(draft, alvo, HOJE))
      .toBe('Escolha a conta em que o dinheiro entrou.')
  })

  it('aceita o padrão de dois toques quando a conta é escolhida', () => {
    const draft = { ...defaultPaymentDraft(alvo), accountKey: 'banco_sicredi_jc' }
    expect(validateReceivablePaymentDraft(draft, alvo, HOJE)).toBeNull()
  })

  it('propõe hoje e o valor cobrado como padrão', () => {
    const draft = defaultPaymentDraft(alvo)
    expect(draft.receivedAmount).toBe('1200,00')
    expect(draft.receivedMethod).toBe('pix')
  })
})

describe('atraso', () => {
  it('conta os dias vencidos', () => {
    expect(daysOverdue(cobranca({ due_date: '2026-08-15' }), HOJE)).toBe(5)
    expect(daysOverdue(cobranca({ due_date: '2026-08-25' }), HOJE)).toBe(-5)
  })

  it('cobrança recebida nunca conta como atrasada', () => {
    expect(isOverdue(cobranca({ due_date: '2026-08-01' }), HOJE)).toBe(true)
    expect(isOverdue(cobranca({ due_date: '2026-08-01', status: 'recebida' }), HOJE)).toBe(false)
  })
})

describe('summarizeReceivables', () => {
  it('separa o que está atrasado do que ainda vai vencer', () => {
    const totais = summarizeReceivables([
      cobranca({ id: 'a', due_date: '2026-08-01', amount: 300 }),
      cobranca({ id: 'b', due_date: '2026-08-30', amount: 500 }),
    ], HOJE)
    expect(totais.atrasado).toBe(300)
    expect(totais.aVencer).toBe(500)
  })

  it('soma o recebido pelo valor que entrou, não pelo cobrado', () => {
    const totais = summarizeReceivables([
      cobranca({ id: 'c', status: 'recebida', amount: 1200, received_amount: 1190 }),
    ], HOJE)
    expect(totais.recebidoNoPeriodo).toBe(1190)
    expect(totais.atrasado).toBe(0)
  })

  it('cobrança cancelada não entra em nenhum total', () => {
    const totais = summarizeReceivables([
      cobranca({ id: 'd', status: 'cancelada', due_date: '2026-08-01', amount: 900 }),
    ], HOJE)
    expect(totais).toEqual({ atrasado: 0, aVencer: 0, recebidoNoPeriodo: 0 })
  })
})

describe('sortReceivables', () => {
  it('põe as atrasadas mais antigas na frente', () => {
    const ordenado = sortReceivables([
      cobranca({ id: 'recebida', status: 'recebida', due_date: '2026-08-02' }),
      cobranca({ id: 'a-vencer', due_date: '2026-08-30' }),
      cobranca({ id: 'atrasada-nova', due_date: '2026-08-18' }),
      cobranca({ id: 'atrasada-velha', due_date: '2026-08-05' }),
    ], HOJE)
    expect(ordenado.map(row => row.id)).toEqual([
      'atrasada-velha', 'atrasada-nova', 'a-vencer', 'recebida',
    ])
  })
})

describe('pedidos PJ a faturar', () => {
  const pedido = (overrides: Partial<PjOrderToBillRow> = {}): PjOrderToBillRow => ({
    order_group_id: 'g1',
    customer_id: 'c1',
    customer_name: '[TESTE] Cliente',
    payment_term_days: 15,
    delivery_date: '2026-08-12',
    dispatched_at: null,
    items: 2,
    amount: 150,
    ...overrides,
  })

  it('pedido de cliente sem prazo nao pode ser cobrado', () => {
    expect(pjOrderCanBeBilled(pedido())).toBe(true)
    expect(pjOrderCanBeBilled(pedido({ payment_term_days: null }))).toBe(false)
    // Zero é à vista, não é ausência de prazo.
    expect(pjOrderCanBeBilled(pedido({ payment_term_days: 0 }))).toBe(true)
  })

  it('separa o quanto esta travado por falta de prazo do cliente', () => {
    const resumo = summarizePjOrdersToBill([
      pedido({ order_group_id: 'a', amount: 150 }),
      pedido({ order_group_id: 'b', amount: 80, payment_term_days: null }),
    ])
    expect(resumo.total).toBe(230)
    expect(resumo.bloqueados).toBe(1)
    expect(resumo.valorBloqueado).toBe(80)
  })
})
