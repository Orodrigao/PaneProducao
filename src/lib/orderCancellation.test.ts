import { describe, expect, it } from 'vitest'
import {
  allOrderRowsCancelled,
  canCancelOrder,
  cancellationAvailability,
  cancellationReferenceDate,
  normalizeCancellationReason,
} from './orderCancellation'

describe('prazo do cancelamento', () => {
  it('permite antes das 5h e bloqueia exatamente às 5h', () => {
    const schedule = { productionDate: '2026-07-21', deliveryDate: '2026-07-22' }

    expect(cancellationAvailability('pj', schedule, new Date('2026-07-21T04:59:59')).allowed).toBe(true)
    expect(cancellationAvailability('pj', schedule, new Date('2026-07-21T05:00:00'))).toEqual({
      allowed: false,
      cutoffDate: '2026-07-21',
      message: 'Produção deste pedido já iniciou. Cancelamento encerrou às 5h de 21/07/2026. Fale com o Rodrigo.',
    })
  })

  it('usa entrega para encomenda sem produção ou sem data de produção', () => {
    expect(cancellationReferenceDate('encomenda', {
      productionDate: '2026-07-21', deliveryDate: '2026-07-22', needsProduction: false,
    })).toBe('2026-07-22')
    expect(cancellationReferenceDate('encomenda', {
      productionDate: null, deliveryDate: '2026-07-22', needsProduction: true,
    })).toBe('2026-07-22')
  })

  it('bloqueia quando o pedido não tem nenhuma data utilizável', () => {
    expect(cancellationAvailability('pj', { productionDate: null, deliveryDate: null }).allowed).toBe(false)
  })
})

describe('regras do cancelamento', () => {
  it('mantém a matriz de perfis aprovada', () => {
    expect(canCancelOrder('admin', 'pj')).toBe(true)
    expect(canCancelOrder('financeiro', 'encomenda')).toBe(true)
    expect(canCancelOrder('vendas', 'encomenda')).toBe(true)
    expect(canCancelOrder('vendas', 'pj')).toBe(false)
    expect(canCancelOrder('producao', 'encomenda')).toBe(false)
  })

  it('transforma o motivo em uma linha curta', () => {
    expect(normalizeCancellationReason('  Cliente\n desistiu   da compra  ')).toBe('Cliente desistiu da compra')
    expect(normalizeCancellationReason('x'.repeat(200))).toHaveLength(160)
  })

  it('só confirma sucesso quando todas as linhas do grupo estão canceladas', () => {
    const ids = ['1', '2']
    expect(allOrderRowsCancelled([
      { id: '1', cancelled_at: '2026-07-20T12:00:00Z' },
      { id: '2', cancelled_at: '2026-07-20T12:00:00Z' },
    ], ids)).toBe(true)
    expect(allOrderRowsCancelled([
      { id: '1', cancelled_at: '2026-07-20T12:00:00Z' },
      { id: '2', cancelled_at: null },
    ], ids)).toBe(false)
  })
})
