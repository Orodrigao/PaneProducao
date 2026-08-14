import { describe, expect, it } from 'vitest'

import {
  canGenerateReceivable,
  formatPaymentTerms,
  isDuplicateCustomerDocError,
  normalizeCustomerDoc,
  parsePaymentTerms,
  sameCustomerDoc,
} from './customers'

describe('normalizeCustomerDoc', () => {
  it('mantém somente os dígitos do CNPJ', () => {
    expect(normalizeCustomerDoc('54.338.407/0001-52')).toBe('54338407000152')
  })

  it('trata ausência de documento como texto vazio', () => {
    expect(normalizeCustomerDoc(null)).toBe('')
    expect(normalizeCustomerDoc(undefined)).toBe('')
    expect(normalizeCustomerDoc('   ')).toBe('')
  })
})

describe('sameCustomerDoc', () => {
  // O caso real: o mesmo NDCG cadastrado duas vezes, uma com pontuação e
  // outra sem, virou dois clientes e viraria dois extratos.
  it('reconhece o mesmo CNPJ escrito com e sem pontuação', () => {
    expect(sameCustomerDoc('54.338.407/0001-52', '54338407000152')).toBe(true)
  })

  it('não considera iguais dois clientes sem documento', () => {
    expect(sameCustomerDoc(null, null)).toBe(false)
    expect(sameCustomerDoc('', '   ')).toBe(false)
  })

  it('separa CNPJs diferentes da mesma empresa', () => {
    expect(sameCustomerDoc('49.520.405/0001-40', '65.572.038/0001-84')).toBe(false)
  })
})

describe('isDuplicateCustomerDocError', () => {
  it('reconhece a recusa do banco por CNPJ repetido', () => {
    expect(isDuplicateCustomerDocError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "customers_doc_numerico_ativo_unico"',
    })).toBe(true)
  })

  it('não confunde com outra violação de unicidade', () => {
    expect(isDuplicateCustomerDocError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "price_tiers_name_key"',
    })).toBe(false)
  })

  it('não reage a erro comum nem a ausência de erro', () => {
    expect(isDuplicateCustomerDocError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isDuplicateCustomerDocError(null)).toBe(false)
  })
})

describe('parsePaymentTerms', () => {
  it('trata vazio como prazo ainda não combinado', () => {
    expect(parsePaymentTerms('')).toEqual({ ok: true, terms: null })
    expect(parsePaymentTerms(null)).toEqual({ ok: true, terms: null })
  })

  it('lê um prazo único', () => {
    expect(parsePaymentTerms('7')).toEqual({ ok: true, terms: [7] })
    expect(parsePaymentTerms('0')).toEqual({ ok: true, terms: [0] })
  })

  it('lê um plano parcelado, com qualquer separador', () => {
    expect(parsePaymentTerms('7, 14, 21')).toEqual({ ok: true, terms: [7, 14, 21] })
    expect(parsePaymentTerms('7/14/21')).toEqual({ ok: true, terms: [7, 14, 21] })
    expect(parsePaymentTerms('7 14 21')).toEqual({ ok: true, terms: [7, 14, 21] })
  })

  it('ordena o plano, para a parcela 1 ser sempre a que vence antes', () => {
    expect(parsePaymentTerms('21,7,14')).toEqual({ ok: true, terms: [7, 14, 21] })
  })

  it('recusa prazo repetido: duas parcelas no mesmo dia são uma só', () => {
    expect(parsePaymentTerms('7, 7').ok).toBe(false)
  })

  it('recusa texto que não é número de dias', () => {
    expect(parsePaymentTerms('sete').ok).toBe(false)
    expect(parsePaymentTerms('7.5').ok).toBe(false)
  })

  it('recusa prazo acima do limite combinado', () => {
    expect(parsePaymentTerms('181').ok).toBe(false)
    expect(parsePaymentTerms('180')).toEqual({ ok: true, terms: [180] })
  })
})

describe('formatPaymentTerms', () => {
  it('distingue prazo ausente de pagamento à vista', () => {
    expect(formatPaymentTerms(null)).toBe('sem prazo definido')
    expect(formatPaymentTerms([])).toBe('sem prazo definido')
    expect(formatPaymentTerms([0])).toBe('à vista')
  })

  it('escreve o prazo único em dias', () => {
    expect(formatPaymentTerms([1])).toBe('1 dia')
    expect(formatPaymentTerms([28])).toBe('28 dias')
  })

  it('mostra o plano parcelado de forma curta', () => {
    expect(formatPaymentTerms([7, 14, 21])).toBe('3x — 7/14/21 dias')
  })
})

describe('canGenerateReceivable', () => {
  it('libera cliente com prazo combinado, inclusive à vista e parcelado', () => {
    expect(canGenerateReceivable([0])).toBe(true)
    expect(canGenerateReceivable([28])).toBe(true)
    expect(canGenerateReceivable([7, 14, 21])).toBe(true)
  })

  it('bloqueia cliente sem prazo, para não inventar vencimento', () => {
    expect(canGenerateReceivable(null)).toBe(false)
    expect(canGenerateReceivable(undefined)).toBe(false)
    expect(canGenerateReceivable([])).toBe(false)
  })
})
