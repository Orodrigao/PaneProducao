import { describe, expect, it } from 'vitest'

import {
  canGenerateReceivable,
  formatPaymentTerm,
  isDuplicateCustomerDocError,
  normalizeCustomerDoc,
  parsePaymentTermDays,
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

describe('parsePaymentTermDays', () => {
  it('aceita campo vazio como prazo ainda não combinado', () => {
    expect(parsePaymentTermDays('')).toEqual({ ok: true, days: null })
    expect(parsePaymentTermDays('   ')).toEqual({ ok: true, days: null })
    expect(parsePaymentTermDays(null)).toEqual({ ok: true, days: null })
  })

  it('aceita prazos usuais da operação', () => {
    expect(parsePaymentTermDays('7')).toEqual({ ok: true, days: 7 })
    expect(parsePaymentTermDays('28')).toEqual({ ok: true, days: 28 })
    expect(parsePaymentTermDays(0)).toEqual({ ok: true, days: 0 })
  })

  it('recusa texto, decimal e negativo', () => {
    expect(parsePaymentTermDays('duas semanas').ok).toBe(false)
    expect(parsePaymentTermDays('7,5').ok).toBe(false)
    expect(parsePaymentTermDays('-3').ok).toBe(false)
  })

  it('recusa prazo acima do limite combinado', () => {
    expect(parsePaymentTermDays('181').ok).toBe(false)
    expect(parsePaymentTermDays('180')).toEqual({ ok: true, days: 180 })
  })
})

describe('formatPaymentTerm', () => {
  it('distingue prazo ausente de pagamento à vista', () => {
    expect(formatPaymentTerm(null)).toBe('sem prazo definido')
    expect(formatPaymentTerm(0)).toBe('à vista')
  })

  it('escreve o prazo em dias', () => {
    expect(formatPaymentTerm(1)).toBe('1 dia')
    expect(formatPaymentTerm(28)).toBe('28 dias')
  })
})

describe('canGenerateReceivable', () => {
  it('libera cliente com prazo combinado, inclusive à vista', () => {
    expect(canGenerateReceivable(0)).toBe(true)
    expect(canGenerateReceivable(28)).toBe(true)
  })

  it('bloqueia cliente sem prazo, para não inventar vencimento', () => {
    expect(canGenerateReceivable(null)).toBe(false)
    expect(canGenerateReceivable(undefined)).toBe(false)
  })
})
