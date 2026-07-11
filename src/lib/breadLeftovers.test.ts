import { describe, expect, it } from 'vitest'
import {
  aggregateConfirmedReuse,
  aggregateWholePending,
  clampReuseProposal,
  leftoverAgeDays,
  subtractConfirmedReuse,
  validateDestinationQuantity,
} from './breadLeftovers'

describe('aggregateWholePending', () => {
  it('soma por loja e pão sem prometer frações como unidades reaproveitáveis', () => {
    const result = aggregateWholePending([
      { store: 'jc', product_id: 'integral', pending_quantity: 4.8 },
      { store: 'jc', product_id: 'integral', pending_quantity: 2.2 },
      { store: 'ja', product_id: 'integral', pending_quantity: 3 },
      { store: 'ex', product_id: 'integral', pending_quantity: 20 },
    ])

    expect(result.get('jc-integral')).toBe(6)
    expect(result.get('ja-integral')).toBe(3)
    expect(result.has('ex-integral')).toBe(false)
  })
})

describe('reaproveitamento confirmado', () => {
  it('reduz somente o previsto do pão correspondente', () => {
    const confirmed = aggregateConfirmedReuse([
      { bread_id: 'integral', confirmed_quantity: 4, status: 'confirmed' },
      { bread_id: 'italiano', confirmed_quantity: 3, status: 'proposed' },
    ])
    const adjusted = subtractConfirmedReuse(
      new Map([['integral', 30], ['italiano', 12]]),
      confirmed,
    )

    expect(adjusted.get('integral')).toBe(26)
    expect(adjusted.get('italiano')).toBe(12)
  })

  it('nunca produz um previsto negativo', () => {
    const result = subtractConfirmedReuse(new Map([['integral', 2]]), new Map([['integral', 4]]))
    expect(result.get('integral')).toBe(0)
  })
})

describe('validações operacionais', () => {
  it('limita a proposta pelo pedido e pelo saldo inteiro disponível', () => {
    expect(clampReuseProposal(8, 30, 6)).toBe(6)
    expect(clampReuseProposal(-2, 30, 6)).toBe(0)
  })

  it('aceita destino parcial e rejeita quantidade acima do saldo', () => {
    expect(validateDestinationQuantity('2,5', 4)).toBe(2.5)
    expect(validateDestinationQuantity('5', 4)).toBeNull()
  })

  it('calcula a idade por data operacional', () => {
    expect(leftoverAgeDays('2026-07-10', '2026-07-11')).toBe(1)
    expect(leftoverAgeDays('2026-07-12', '2026-07-11')).toBe(0)
  })
})
