import { describe, expect, it } from 'vitest'
import {
  closingBreadIds,
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

  it('aceita hoje e datas anteriores, mas rejeita futuro ou formato inválido', () => {
    expect(isValidClosingDate('2026-07-13', '2026-07-13')).toBe(true)
    expect(isValidClosingDate('2026-07-12', '2026-07-13')).toBe(true)
    expect(isValidClosingDate('2026-07-14', '2026-07-13')).toBe(false)
    expect(isValidClosingDate('13/07/2026', '2026-07-13')).toBe(false)
  })
})
