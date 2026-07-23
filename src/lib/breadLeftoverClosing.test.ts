import { describe, expect, it } from 'vitest'
import {
  blocksClosing,
  closingBreadIds,
  closingResumePath,
  isPendingLeftoversError,
  isValidClosingDate,
  leftoverPendingPath,
} from './breadLeftoverClosing'

describe('fechamento físico de sobras', () => {
  it('une pedido, Forno, registro salvo e inclusão manual sem duplicar pães', () => {
    const ids = closingBreadIds(
      [{ bread_id: 'integral' }, { bread_id: 'ciabatta' }],
      [{ bread_id: 'integral' }, { bread_id: 'italiano' }],
      [{ product_id: 'multigraos' }],
      ['azeitonas', 'italiano'],
    )

    expect([...ids]).toEqual([
      'integral',
      'ciabatta',
      'italiano',
      'multigraos',
      'azeitonas',
    ])
  })

  it('leva a loja e a data do fechamento para a Central', () => {
    expect(leftoverPendingPath('ja', '2026-07-13'))
      .toBe('/sobras/pendencias?store=ja&date=2026-07-13')
  })

  it('sinaliza quando a ida à Central veio de um fechamento recusado', () => {
    expect(leftoverPendingPath('jc', '2026-07-22', { blocked: true }))
      .toBe('/sobras/pendencias?store=jc&date=2026-07-22&blocked=1')
  })

  it('sabe voltar para o fechamento que ficou preso', () => {
    expect(closingResumePath('jc', '2026-07-22'))
      .toBe('/sobras?resume=jc&date=2026-07-22')
  })

  it('só considera bloqueador o lote sem destino de dia anterior', () => {
    const closing = '2026-07-22'

    expect(blocksClosing({ pending_quantity: 8, record_date: '2026-07-21' }, closing)).toBe(true)
    expect(blocksClosing({ pending_quantity: 0, record_date: '2026-07-21' }, closing)).toBe(false)
    expect(blocksClosing({ pending_quantity: 8, record_date: '2026-07-22' }, closing)).toBe(false)
  })

  it('reconhece o bloqueio de pendências retornado pelo banco', () => {
    expect(isPendingLeftoversError(
      'Resolva as sobras pendentes do dia anterior antes de fechar hoje.',
    )).toBe(true)
    expect(isPendingLeftoversError('Falha de conexão')).toBe(false)
  })

  it('aceita hoje e datas anteriores, mas rejeita futuro ou formato inválido', () => {
    expect(isValidClosingDate('2026-07-13', '2026-07-13')).toBe(true)
    expect(isValidClosingDate('2026-07-12', '2026-07-13')).toBe(true)
    expect(isValidClosingDate('2026-07-14', '2026-07-13')).toBe(false)
    expect(isValidClosingDate('13/07/2026', '2026-07-13')).toBe(false)
  })
})
