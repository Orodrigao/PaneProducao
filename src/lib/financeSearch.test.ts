import { describe, expect, it, vi } from 'vitest'
import {
  createSearchSequence, ledgerPaymentKey, ledgerSearchFilter, normalizeSearchText, parsePaymentSearch,
  postgrestQuoted, readCompletePages, searchMonth, searchRegex, uniqueLedgerPayments,
  type PaymentSearchCriteria,
} from './financeSearch'

const criteria: PaymentSearchCriteria = { term: 'Fornecedor A', period: 'all', date: 'paid_date', month: '2026-08' }

describe('leitura do termo e filtros seguros', () => {
  it.each([['987,65', 98765], ['1.250,00', 125000], ['R$ 300,00', 30000], ['1.250', 125000], ['10101', 1010100], ['0010101', 1010100]])('lê %s em centavos', (text, cents) => {
    expect(parsePaymentSearch(text).cents).toBe(cents)
  })
  it('inteiro também é texto sem zeros à esquerda; moeda só é valor', () => {
    expect(parsePaymentSearch('0010101')).toMatchObject({ tokens: ['10101'], moneyOnly: false })
    expect(ledgerSearchFilter(parsePaymentSearch('987,65'))).toBe('amount.eq.987.65,planned_amount.eq.987.65')
    expect(ledgerSearchFilter(parsePaymentSearch('R$ ' + '9'.repeat(60) + ',00'))).toBe('id.is.null')
  })
  it('44 dígitos, mesmo com espaços, são chave e não valor', () => {
    const key = '1'.repeat(44)
    expect(parsePaymentSearch(`${key.slice(0, 22)} ${key.slice(22)}`)).toMatchObject({ key, cents: null })
  })
  it.each([['eletrica', 'Energia Elétrica'], ['ENERGIA', 'Energia Elétrica'], ['acucar', 'AÇÚCAR']])('%s encontra %s mesmo em caixa acentuada', (term, description) => {
    expect(new RegExp(searchRegex(term), 'i').test(description)).toBe(true)
    expect(normalizeSearchText(description)).toContain(normalizeSearchText(term))
  })
  it.each(['a,b', 'a"b', 'a(b)', 'a\\b', 'a/b', '.*', 'a|b', 'a[bc]', 'a$b'])('trata %s literalmente na regex e entre aspas no PostgREST', term => {
    const pattern = searchRegex(term)
    expect(new RegExp(pattern, 'i').test(term)).toBe(true)
    expect(new RegExp(pattern, 'i').test('qualquer lançamento')).toBe(false)
    const encoded = ledgerSearchFilter(parsePaymentSearch(term))
    expect(encoded).toBe(`description.imatch.${postgrestQuoted(pattern)}`)
    // A remoção das aspas externas deixa apenas escapes de aspas/backslash válidos.
    expect(JSON.parse(postgrestQuoted(pattern))).toBe(pattern)
  })
  it('todas as palavras são AND, independentemente da ordem na descrição', () => {
    const filter = ledgerSearchFilter(parsePaymentSearch('fornecedor 0010101'))
    expect(filter).toMatch(/^and\(description\.imatch\./)
    expect(filter).toContain(',description.imatch."10101"')
    expect(filter).not.toContain('0010101')
  })
  it('calcula meses no dia de Brasília, incluindo virada do ano', () => {
    expect(searchMonth({ ...criteria, period: 'current' }, '2026-12-31')).toBe('2026-12')
    expect(searchMonth({ ...criteria, period: 'previous' }, '2027-01-01')).toBe('2026-12')
    expect(searchMonth({ ...criteria, period: 'chosen' })).toBe('2026-08')
    expect(searchMonth(criteria)).toBeNull()
  })
})

describe('leituras completas', () => {
  it('atravessa 2.500 linhas mesmo sob teto de 1.000', async () => {
    const all = Array.from({ length: 2500 }, (_, id) => ({ id: String(id), amount: 2 }))
    const read = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), count: all.length, error: null }))
    const rows = await readCompletePages(read)
    expect(rows).toHaveLength(2500)
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(5000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(read.mock.calls[4]).toEqual([2000, 2499])
  })
  it('falha na segunda página não entrega meia lista', async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [{ id: '1' }], count: 2, error: null })
      .mockResolvedValueOnce({ data: null, count: null, error: new Error('sem rede') })
    await expect(readCompletePages(read)).rejects.toThrow('sem rede')
  })
  it.each([
    [{ data: [], count: null, error: null }],
    [{ data: [], count: 1, error: null }],
    [{ data: [{ id: '1' }], count: 2, error: null }, { data: [{ id: '2' }], count: 3, error: null }],
    [{ data: [{ id: '1' }, { id: '1' }], count: 2, error: null }],
  ])('recusa contagem ausente, página vazia, contagem alterada e repetição: %j', async (...pages) => {
    const read = vi.fn()
    for (const page of pages) read.mockResolvedValueOnce(page)
    await expect(readCompletePages(read)).rejects.toThrow()
  })
})

describe('pagamentos e concorrência', () => {
  it('deduplica rateios e exclui somente parcelas que apareceram na parte a', () => {
    const rows = [
      { id: 'a', source: 'contas_pagar' as const, source_ref: 'parcela-1' },
      { id: 'b', source: 'contas_pagar' as const, source_ref: 'parcela-1' },
      { id: 'c', source: 'contas_pagar' as const, source_ref: 'parcela-2' },
      { id: 'd', source: 'avulso' as const, source_ref: 'parcela-2' },
    ]
    expect(uniqueLedgerPayments(rows, new Set()).map(ledgerPaymentKey)).toEqual(['payable:parcela-1', 'payable:parcela-2', 'entry:d'])
    expect(uniqueLedgerPayments(rows, new Set(['parcela-1']))).toEqual([rows[2], rows[3]])
  })
  it('só a última resposta pode preencher; limpar também invalida a pendente', async () => {
    const sequence = createSearchSequence()
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let view = ''
    const first = sequence.next()
    const delayed = held.then(() => { if (sequence.isCurrent(first)) view = 'antiga' })
    const second = sequence.next()
    if (sequence.isCurrent(second)) view = 'nova'
    release()
    await delayed
    expect(view).toBe('nova')
    sequence.next()
    expect(sequence.isCurrent(second)).toBe(false)
  })
})
