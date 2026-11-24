import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
import { matchesPayablePurchaseSearch, searchPayableInstallments } from './payablesSearch'
import type { PaymentSearchCriteria } from './financeSearch'
import type { PayablePurchaseRow } from './payables'

const purchase: PayablePurchaseRow = {
  id: 'purchase', purchase_date: '2026-08-15', document_type: 'nfe', payment_method: 'boleto',
  status: 'aberta', total_value: '2962.95', notes: 'Energia Elétrica e Açúcar',
  suppliers: { name: 'Fornecedor A' }, nfe_number: '0010101', nfe_key: '1'.repeat(44),
  payable_installments: [
    { id: 'paid', installment_number: 1, status: 'paga', amount: '987.65', paid_amount: '990', paid_date: '2026-09-18', due_date: '2026-09-15' },
    { id: 'open', installment_number: 2, status: 'pendente', amount: '980', due_date: '2026-10-15', current_due_date: '2026-11-30' },
    { id: 'cancelled', installment_number: 3, status: 'cancelada', amount: '995.30', due_date: '2026-11-15' },
  ],
}
const criteria = (term: string, changes: Partial<PaymentSearchCriteria> = {}): PaymentSearchCriteria => ({ term, period: 'all', date: 'paid_date', month: '2026-09', ...changes })

describe('filtro de texto da lista de contas a pagar', () => {
  it.each(['987,65', 'acucar', '990,00', '2.962,95', '980,00', '1'.repeat(44)])('encontra %s em qualquer mês e situação da parcela', term => {
    expect(matchesPayablePurchaseSearch(purchase, term)).toBe(true)
  })
  it.each(['fornecedor a', '10101', 'energia', 'elétrica', ' FORNECEDOR A '])('preserva a busca anterior por %s, mesmo sem parcelas', term => {
    expect(matchesPayablePurchaseSearch({ ...purchase, payable_installments: [] }, term)).toBe(true)
  })
  it.each(['', '   ', 'a', 'recibo', '11111'])('preserva termos vazios, curtos, rótulos e trechos da chave: %s', term => {
    expect(matchesPayablePurchaseSearch(purchase, term)).toBe(true)
  })
  it('preserva os rótulos de nota e fornecedor sem parcelas', () => {
    const withoutInstallments = { ...purchase, payable_installments: [] }
    expect(matchesPayablePurchaseSearch({ ...withoutInstallments, origin: 'xml' }, 'NF-e 0010101')).toBe(true)
    expect(matchesPayablePurchaseSearch({ ...withoutInstallments, document_type: 'sem_nota' }, 'sem nota')).toBe(true)
    expect(matchesPayablePurchaseSearch({ ...withoutInstallments, suppliers: null }, 'fornecedor não identificado')).toBe(true)
  })
  it('mantém fora uma compra sem correspondência', () => {
    expect(matchesPayablePurchaseSearch(purchase, 'fornecedor inexistente')).toBe(false)
  })
})

describe('busca por parcela', () => {
  it.each(['01/08', 'Aluguel 01/08', 'NF 10101', 'NF 0010101', 'valor 1.000,00'])('preserva datas e moeda no texto e normaliza números puros: %s', term => {
    const dated = { ...purchase, notes: 'Aluguel 01/08 valor 1.000,00 NF 0010101' }
    expect(searchPayableInstallments([dated], criteria(term))).toHaveLength(3)
  })
  it('não confunde datas nem valores escritos de formas diferentes', () => {
    const dated = { ...purchase, notes: 'Aluguel 01/08 valor 1.000,00' }
    expect(searchPayableInstallments([dated], criteria('aluguel 1/8'))).toHaveLength(0)
    expect(searchPayableInstallments([dated], criteria('valor 1.0,00'))).toHaveLength(0)
  })
  it.each(['10101', '0010101', 'fornecedor a', '10101 fornecedor', 'eletrica', 'ENERGIA', 'acucar'])('encontra %s com motivo', term => {
    const results = searchPayableInstallments([purchase], criteria(term))
    expect(results).toHaveLength(3)
    expect(results.every(result => result.reasons.length > 0)).toBe(true)
  })
  it('parcela paga segue paga independentemente de histórico estornado no livro', () => {
    const [result] = searchPayableInstallments([purchase], criteria('987,65'))
    expect(result.installment.status).toBe('paga')
    expect(result.installment.paid_date).toBe('2026-09-18')
    expect(result.reasons).toEqual(['valor da parcela'])
  })
  it('distingue valor da parcela, valor pago e total da compra', () => {
    expect(searchPayableInstallments([purchase], criteria('990,00')).map(result => result.reasons)).toEqual([['valor pago']])
    expect(searchPayableInstallments([purchase], criteria('2.962,95'))).toHaveLength(3)
    expect(searchPayableInstallments([purchase], criteria('980,00'))[0].installment.id).toBe('open')
  })
  it('não combina o valor de uma parcela com a data paga de outra', () => {
    expect(searchPayableInstallments([purchase], criteria('980,00', { period: 'chosen' }))).toEqual([])
    expect(searchPayableInstallments([purchase], criteria('987,65', { period: 'chosen', month: '2026-10' }))).toEqual([])
    expect(searchPayableInstallments([purchase], criteria('987,65', { period: 'chosen' }))).toHaveLength(1)
  })
  it('agosto na competência, setembro no pagamento', () => {
    const find = (month: string, date: PaymentSearchCriteria['date']) => searchPayableInstallments([purchase], criteria('987,65', { period: 'chosen', month, date }))
    expect(find('2026-08', 'competence_month')).toHaveLength(1)
    expect(find('2026-09', 'competence_month')).toHaveLength(0)
    expect(find('2026-08', 'paid_date')).toHaveLength(0)
    expect(find('2026-09', 'paid_date')).toHaveLength(1)
  })
  it('chave exata com espaços e termos que não existem', () => {
    expect(searchPayableInstallments([purchase], criteria('1'.repeat(22) + ' ' + '1'.repeat(22)))[0].reasons).toEqual(['chave da nota'])
    expect(searchPayableInstallments([purchase], criteria('fornecedor inexistente'))).toHaveLength(0)
    expect(searchPayableInstallments([purchase], criteria('.*'))).toHaveLength(0)
    expect(searchPayableInstallments([purchase], criteria('a'))).toHaveLength(0)
  })
  it('não transforma o rótulo de fornecedor desconhecido em correspondência de nome', () => {
    expect(searchPayableInstallments([{ ...purchase, suppliers: null }], criteria('fornecedor'))).toHaveLength(0)
  })
})
