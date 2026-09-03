import { describe, expect, it } from 'vitest'
import {
  pjLineValue,
  pjLineEstimatedValue,
  pjLineVerdict,
  summarizePjOrderValue,
  pjOrderDisplayValue,
} from './pjOrderValue'

const ENVIADO_HOJE = '2026-09-03T13:00:00.000Z'
const ENVIADO_ANTES_DO_MARCO = '2026-08-15T13:00:00.000Z'

describe('pjLineValue', () => {
  it('usa a quantidade conferida quando ela existe', () => {
    // O caso do pedido de 02/09: pediu 2 kg, saiu 1,7 kg, preço 32,70.
    expect(pjLineValue({
      quantity: 2, dispatchedQuantity: 1.7, unitPrice: 32.7, dispatchedAt: ENVIADO_HOJE,
    })).toBe(55.59)
  })

  it('cobra a mais quando saiu a mais', () => {
    expect(pjLineValue({
      quantity: 60, dispatchedQuantity: 64, unitPrice: 6.6, dispatchedAt: ENVIADO_HOJE,
    })).toBe(422.4)
  })

  it('zero conferido vale zero, e não vira a estimativa', () => {
    expect(pjLineValue({
      quantity: 10, dispatchedQuantity: 0, unitPrice: 5, dispatchedAt: ENVIADO_HOJE,
    })).toBe(0)
  })

  it('legado enviado antes do marco continua pela estimativa', () => {
    expect(pjLineValue({
      quantity: 3, dispatchedQuantity: null, unitPrice: 10, dispatchedAt: ENVIADO_ANTES_DO_MARCO,
    })).toBe(30)
  })

  it('enviado depois do marco sem conferência não tem valor cobrável', () => {
    expect(pjLineValue({
      quantity: 3, dispatchedQuantity: null, unitPrice: 10, dispatchedAt: ENVIADO_HOJE,
    })).toBeNull()
  })

  it('pedido ainda não enviado não tem valor cobrável', () => {
    expect(pjLineValue({
      quantity: 3, dispatchedQuantity: null, unitPrice: 10, dispatchedAt: null,
    })).toBeNull()
  })

  it('arredonda a linha a centavos antes de qualquer soma', () => {
    // 1,067 kg × 32,70 = 34,8909, e a linha vale 34,89.
    expect(pjLineValue({
      quantity: 1, dispatchedQuantity: 1.067, unitPrice: 32.7, dispatchedAt: ENVIADO_HOJE,
    })).toBe(34.89)
  })

  it('arredonda como o banco arredonda, e não como o binário arredonda', () => {
    // 1,005 × 1,00 vale 100.49999999999999 em ponto flutuante: com Math.round
    // puro a tela mostraria R$ 1,00 e a cobrança sairia R$ 1,01.
    expect(pjLineValue({
      quantity: 1, dispatchedQuantity: 1.005, unitPrice: 1, dispatchedAt: ENVIADO_HOJE,
    })).toBe(1.01)
    expect(pjLineValue({
      quantity: 1, dispatchedQuantity: 2.675, unitPrice: 1, dispatchedAt: ENVIADO_HOJE,
    })).toBe(2.68)
  })

  it('preço ausente não quebra a conta', () => {
    expect(pjLineValue({
      quantity: 2, dispatchedQuantity: 2, unitPrice: null, dispatchedAt: ENVIADO_HOJE,
    })).toBe(0)
  })
})

describe('pjLineVerdict', () => {
  it('aceita a variação normal da padaria', () => {
    // O histórico real ficou entre 0,69 e 1,57 vezes o pedido.
    expect(pjLineVerdict({
      quantity: 3, dispatchedQuantity: 3.067, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg',
    })).toBe('ok')
    expect(pjLineVerdict({
      quantity: 42, dispatchedQuantity: 66, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un',
    })).toBe('ok')
  })

  it('recusa grama digitada em campo de quilo', () => {
    expect(pjLineVerdict({
      quantity: 3, dispatchedQuantity: 3000, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg',
    })).toBe('acima_do_teto')
  })

  it('recusa quando sai menos de um terço do pedido', () => {
    expect(pjLineVerdict({
      quantity: 30, dispatchedQuantity: 3, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg',
    })).toBe('fora_da_faixa')
  })

  it('recusa quando sai mais que o triplo', () => {
    expect(pjLineVerdict({
      quantity: 10, dispatchedQuantity: 40, unitPrice: 1, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un',
    })).toBe('fora_da_faixa')
  })

  it('nunca recusa o zero, que é falta declarada', () => {
    expect(pjLineVerdict({
      quantity: 100, dispatchedQuantity: 0, unitPrice: 1, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un',
    })).toBe('ok')
  })

  it('respeita o teto de unidade separado do teto de quilo', () => {
    expect(pjLineVerdict({
      quantity: 1500, dispatchedQuantity: 2500, unitPrice: 1, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un',
    })).toBe('acima_do_teto')
    expect(pjLineVerdict({
      quantity: 40, dispatchedQuantity: 60, unitPrice: 1, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg',
    })).toBe('acima_do_teto')
  })
})

describe('summarizePjOrderValue', () => {
  const pedidoDeHoje = [
    { quantity: 2, dispatchedQuantity: 1.7, unitPrice: 32.7, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg' },
    { quantity: 60, dispatchedQuantity: 64, unitPrice: 6.6, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un' },
  ]

  it('soma as linhas já arredondadas', () => {
    const resumo = summarizePjOrderValue(pedidoDeHoje)
    expect(resumo.valor).toBe(477.99)
    expect(resumo.valorEstimado).toBe(461.4)
    expect(resumo.linhasConferidas).toBe(2)
    expect(resumo.linhasSemValor).toBe(0)
    expect(resumo.nadaEnviado).toBe(false)
  })

  it('devolve valor nulo quando alguma linha não tem valor cobrável', () => {
    const resumo = summarizePjOrderValue([
      ...pedidoDeHoje,
      { quantity: 5, dispatchedQuantity: null, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un' },
    ])
    expect(resumo.valor).toBeNull()
    expect(resumo.linhasSemValor).toBe(1)
  })

  it('reconhece o pedido em que nada saiu', () => {
    const resumo = summarizePjOrderValue([
      { quantity: 10, dispatchedQuantity: 0, unitPrice: 5, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'un' },
      { quantity: 3, dispatchedQuantity: 0, unitPrice: 20, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg' },
    ])
    expect(resumo.valor).toBe(0)
    expect(resumo.nadaEnviado).toBe(true)
  })

  it('conta a linha fora da trava sem deixar de somar as outras', () => {
    const resumo = summarizePjOrderValue([
      ...pedidoDeHoje,
      { quantity: 3, dispatchedQuantity: 3000, unitPrice: 10, dispatchedAt: ENVIADO_HOJE, pricingUnit: 'kg' },
    ])
    expect(resumo.linhasForaDaTrava).toBe(1)
  })

  it('pedido vazio não é "nada enviado"', () => {
    expect(summarizePjOrderValue([]).nadaEnviado).toBe(false)
  })
})

describe('pjOrderDisplayValue', () => {
  it('mostra o cobrável quando ele existe', () => {
    expect(pjOrderDisplayValue([
      { quantity: 2, dispatchedQuantity: 1.7, unitPrice: 32.7, dispatchedAt: ENVIADO_HOJE },
    ])).toBe(55.59)
  })

  it('cai para a estimativa quando ainda não há conferência', () => {
    expect(pjOrderDisplayValue([
      { quantity: 2, dispatchedQuantity: null, unitPrice: 32.7, dispatchedAt: null },
    ])).toBe(65.4)
  })
})

describe('pjLineEstimatedValue', () => {
  it('é sempre a estimativa, mesmo com conferência gravada', () => {
    expect(pjLineEstimatedValue({
      quantity: 2, dispatchedQuantity: 1.7, unitPrice: 32.7, dispatchedAt: ENVIADO_HOJE,
    })).toBe(65.4)
  })
})
