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
  pjOrderBillingBlock,
  pjOrderCanBeBilled,
  summarizePjOrdersToBill,
  podeDividirEm,
  validateReceivablePaymentDraft,
  vencimentosDaFatura,
  type PjOrderToBillRow,
  receivedTotal,
  remainingAmount,
  type ReceivableReceiptRow,
  type ReceivableRow,
} from '@/lib/receivables'

const HOJE = '2026-08-20'

function recibo(overrides: Partial<ReceivableReceiptRow> = {}): ReceivableReceiptRow {
  return {
    id: 'rec1',
    receivable_id: 'r1',
    received_date: '2026-08-18',
    amount: 100,
    method: 'pix',
    account_id: 'acc1',
    reversed_at: null,
    reversal_reason: null,
    ...overrides,
  }
}

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
    installment_number: 1,
    installment_count: 1,
    receipts: [],
    cancel_reason: null,
    created_at: '2026-07-20T10:00:00Z',
    ...overrides,
  }
}

describe('validateReceivableDraft', () => {
  it('exige cliente, valor, data e descrição', () => {
    // O rascunho nasce com a data real de hoje; fixa-la no HOJE do teste evita
    // que a virada do dia quebre assercoes que nada tem a ver com data.
    const vazio = { ...emptyReceivableDraft(), invoiceDate: HOJE }
    expect(validateReceivableDraft(vazio, HOJE)).toBe('Escolha o cliente que vai pagar.')
    expect(validateReceivableDraft({ ...vazio, customerId: 'c1' }, HOJE))
      .toBe('Informe um valor maior que zero.')
    expect(validateReceivableDraft({ ...vazio, customerId: 'c1', amount: '100' }, HOJE))
      .toBe('Descreva a cobrança com pelo menos 3 letras.')
  })

  it('recusa faturamento no futuro', () => {
    const draft = { customerId: 'c1', invoiceDate: '2026-08-21', amount: '100', description: 'Pães', parcelas: 1 }
    expect(validateReceivableDraft(draft, HOJE)).toBe('A data do faturamento não pode ser no futuro.')
  })

  it('recusa valor acima do limite, como o banco faz', () => {
    const draft = { customerId: 'c1', invoiceDate: HOJE, amount: '1000000,01', description: 'Pães', parcelas: 1 }
    expect(validateReceivableDraft(draft, HOJE))
      .toBe('Valor acima do limite permitido. Confira o que foi digitado.')
  })

  it('aceita uma cobrança bem preenchida', () => {
    const draft = { customerId: 'c1', invoiceDate: '2026-08-19', amount: '1.200,50', description: 'Pães da semana', parcelas: 1 }
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
    const draft = { ...defaultPaymentDraft(alvo), receivedDate: HOJE }
    expect(validateReceivablePaymentDraft(draft, alvo, HOJE))
      .toBe('Escolha a conta em que o dinheiro entrou.')
  })

  it('aceita o padrão de dois toques quando a conta é escolhida', () => {
    const draft = { ...defaultPaymentDraft(alvo), receivedDate: HOJE, accountKey: 'banco_sicredi_jc' }
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
      cobranca({ id: 'c', status: 'recebida', amount: 1200, receipts: [recibo({ amount: 1190 })] }),
    ], HOJE)
    expect(totais.recebidoNoPeriodo).toBe(1190)
    expect(totais.atrasado).toBe(0)
  })

  it('cobrança parcial deve só o que falta, não o valor cheio', () => {
    const totais = summarizeReceivables([
      cobranca({
        id: 'p', status: 'parcial', amount: 1000, due_date: '2026-08-01',
        receipts: [recibo({ amount: 400 })],
      }),
    ], HOJE)
    expect(totais.atrasado).toBe(600)
    expect(totais.recebidoNoPeriodo).toBe(400)
  })

  it('pedaço estornado deixa de contar como recebido', () => {
    const alvo = cobranca({
      id: 'e', status: 'aberta', amount: 1000, due_date: '2026-08-30',
      receipts: [recibo({ amount: 400, reversed_at: '2026-08-20T10:00:00Z', reversal_reason: 'Pix errado' })],
    })
    expect(receivedTotal(alvo)).toBe(0)
    expect(remainingAmount(alvo)).toBe(1000)
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
    aguardando_conferencia: false,
    ...overrides,
  })

  it('pedido de cliente sem prazo nao pode ser cobrado', () => {
    expect(pjOrderCanBeBilled(pedido())).toBe(true)
    expect(pjOrderCanBeBilled(pedido({ payment_term_days: null }))).toBe(false)
    // Zero é à vista, não é ausência de prazo.
    expect(pjOrderCanBeBilled(pedido({ payment_term_days: 0 }))).toBe(true)
  })

  it('pedido esperando conferencia da Expedicao nao pode ser cobrado', () => {
    // O caso da Ines Vizioli, 25/08: entrega vencida, ninguem conferiu, e a
    // fatura saiu por deducao de calendario. Depois nem podia mais ser
    // conferida, porque pedido faturado fica congelado.
    expect(pjOrderCanBeBilled(pedido({ aguardando_conferencia: true }))).toBe(false)
    expect(pjOrderBillingBlock(pedido({ aguardando_conferencia: true })))
      .toBe('aguardando-conferencia')
  })

  it('a conferencia pesa mais que o prazo quando faltam os dois', () => {
    // Sem prazo a cobranca espera um cadastro; sem conferencia ela sairia com
    // o numero errado. Quem le precisa ouvir o mais grave primeiro.
    expect(pjOrderBillingBlock(pedido({
      aguardando_conferencia: true,
      payment_term_days: null,
    }))).toBe('aguardando-conferencia')
  })

  it('pedido com envio confirmado nao espera conferencia', () => {
    // Confirmar o envio exige tudo conferido, entao os dois nunca se cruzam.
    expect(pjOrderBillingBlock(pedido({
      dispatched_at: '2026-08-26T10:00:00Z',
      aguardando_conferencia: false,
    }))).toBeNull()
  })

  it('separa no resumo o que espera conferencia do que espera prazo', () => {
    const resumo = summarizePjOrdersToBill([
      pedido({ order_group_id: 'a', amount: 150 }),
      pedido({ order_group_id: 'b', amount: 80, payment_term_days: null }),
      pedido({ order_group_id: 'c', amount: 388, aguardando_conferencia: true }),
    ])
    expect(resumo.total).toBe(618)
    expect(resumo.bloqueados).toBe(2)
    expect(resumo.valorBloqueado).toBe(468)
    expect(resumo.semPrazo).toBe(1)
    expect(resumo.valorSemPrazo).toBe(80)
    expect(resumo.aguardandoConferencia).toBe(1)
    expect(resumo.valorAguardandoConferencia).toBe(388)
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

describe('vencimentos da fatura dividida', () => {
  it('o prazo do cliente e o teto: a ultima parcela cai nele', () => {
    expect(vencimentosDaFatura('2026-08-01', 21, 3))
      .toEqual(['2026-08-08', '2026-08-15', '2026-08-22'])
  })

  it('cliente de 28 dias em duas vezes vence no meio e no fim', () => {
    expect(vencimentosDaFatura('2026-08-01', 28, 2)).toEqual(['2026-08-15', '2026-08-29'])
  })

  it('fatura inteira mantem o vencimento de sempre', () => {
    expect(vencimentosDaFatura('2026-08-01', 7, 1)).toEqual(['2026-08-08'])
  })

  it('sem prazo combinado nao ha vencimento que se possa calcular', () => {
    expect(vencimentosDaFatura('2026-08-01', null, 2)).toEqual([])
  })
})

describe('podeDividirEm', () => {
  it('recusa dividir em mais vezes do que o prazo tem dias', () => {
    // Duas parcelas cairiam no mesmo dia, e ai nao sao duas parcelas.
    expect(podeDividirEm(2, 3)).toBe(false)
    expect(podeDividirEm(3, 3)).toBe(true)
    expect(podeDividirEm(0, 2)).toBe(false)
  })

  it('fatura inteira cabe em qualquer prazo, inclusive a vista', () => {
    expect(podeDividirEm(0, 1)).toBe(true)
  })
})

describe('parcelamento — casos de borda', () => {
  it('prazo à vista (0 dias) com fatura inteira', () => {
    expect(vencimentosDaFatura('2026-08-01', 0, 1)).toEqual(['2026-08-01'])
  })

  it('normaliza parcelas zero ou negativas para uma parcela única', () => {
    expect(vencimentosDaFatura('2026-08-01', 10, 0)).toEqual(['2026-08-11'])
    expect(vencimentosDaFatura('2026-08-01', 10, -5)).toEqual(['2026-08-11'])
  })

  it('distribuição com arredondamento não exato', () => {
    // Prazo 20 em 3x: 20*1/3 = 6.66 -> 7; 20*2/3 = 13.33 -> 13; 20*3/3 = 20
    expect(vencimentosDaFatura('2026-08-01', 20, 3))
      .toEqual(['2026-08-08', '2026-08-14', '2026-08-21'])
  })

  it('fatura que cruza o fim do mês', () => {
    expect(vencimentosDaFatura('2026-08-25', 10, 1)).toEqual(['2026-09-04'])
  })

  it('retorna lista vazia se a data do faturamento for vazia', () => {
    expect(vencimentosDaFatura('', 10, 1)).toEqual([])
  })

  it('podeDividirEm retorna falso se o prazo for nulo, independente das parcelas', () => {
    expect(podeDividirEm(null, 1)).toBe(false)
    expect(podeDividirEm(null, 2)).toBe(false)
  })
})
