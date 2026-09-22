import { describe, expect, it } from 'vitest'
import { buildSentSummary, type SentSummaryItem, type SentSummaryRomaneio } from './romaneioSentSummary'

const roms: SentSummaryRomaneio[] = [
  { id: 'r1', status: 'enviado', destinations: { name: 'Julio/JC', code: 'JC' } },
  { id: 'r2', status: 'separado', destinations: { name: 'Julio/JC', code: 'JC' } },
  { id: 'r3', status: 'conferido', destinations: { name: 'Exposição', code: 'EX' } },
  { id: 'r4', status: 'separado', destinations: { name: 'Jardim América', code: 'JA' } },
]

function item(romaneio_id: string, product_id: string | null, product_name: string, qty_sent: number | string | null): SentSummaryItem {
  return { romaneio_id, product_id, product_source: 'breads', product_name, qty_sent }
}

describe('buildSentSummary', () => {
  it('soma o mesmo produto de várias viagens e lojas', () => {
    const s = buildSentSummary(roms, [
      item('r1', 'p1', 'Pão francês', 40),
      item('r2', 'p1', 'Pão francês', 10),
      item('r3', 'p1', 'Pão francês', '30'),
      item('r4', 'p1', 'Pão francês', 25),
      item('r3', 'p2', 'Baguete', 5),
    ])
    const frances = s.rows.find(r => r.productName === 'Pão francês')!
    expect(frances.byStore.JC).toEqual({ total: 50, pending: 10 })
    expect(frances.byStore.EX).toEqual({ total: 30, pending: 0 })
    expect(frances.byStore.JA).toEqual({ total: 25, pending: 25 })
    expect(frances.total).toEqual({ total: 105, pending: 35 })
    expect(s.totals).toHaveLength(1)
    expect(s.totals[0].unit).toBe('un')
    expect(s.totals[0].total).toEqual({ total: 110, pending: 35 })
    expect(s.totals[0].byStore.EX.total).toBe(35)
  })

  it('ordena lojas JC, JA, EX e produtos por nome', () => {
    const s = buildSentSummary(roms, [item('r3', 'p2', 'Baguete', 1), item('r4', 'p1', 'Alemão', 1), item('r1', 'p3', 'Ciabatta', 1)])
    expect(s.stores.map(x => x.code)).toEqual(['JC', 'JA', 'EX'])
    expect(s.rows.map(r => r.productName)).toEqual(['Alemão', 'Baguete', 'Ciabatta'])
  })

  it('ignora quantidade zero, vazia, inválida e item de romaneio de outro dia', () => {
    const s = buildSentSummary(roms, [
      item('r1', 'p1', 'Pão', 0),
      item('r1', 'p1', 'Pão', null),
      item('r1', 'p1', 'Pão', 'abc'),
      item('r1', 'p1', 'Pão', -3),
      item('outro', 'p1', 'Pão', 9),
    ])
    expect(s.rows).toEqual([])
    expect(s.stores).toEqual([])
    expect(s.totals).toEqual([])
  })

  it('aceita decimal com vírgula e agrupa por nome quando falta o id do produto', () => {
    const s = buildSentSummary(roms, [item('r1', null, 'Massa (kg) ', '1,5'), item('r3', null, 'massa (kg)', 2)])
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0].total.total).toBe(3.5)
  })

  it('nunca soma quilo com unidade: totais separados por unidade', () => {
    const s = buildSentSummary(roms, [item('r1', 'p1', 'Pão francês', 40), item('r1', 'p9', 'Ciabatta', '1,5')])
    expect(s.rows.find(r => r.productName === 'Ciabatta')!.unit).toBe('kg')
    expect(s.totals.map(t => [t.unit, t.total.total])).toEqual([['un', 40], ['kg', 1.5]])
    expect(s.totals[0].byStore.JC.total).toBe(40)
  })

  it('junta o mesmo extra de viagens diferentes e lista extras depois dos pães', () => {
    const extra = (rom: string, id: string, qty: number): SentSummaryItem =>
      ({ romaneio_id: rom, product_id: id, product_source: 'extra', product_name: 'Bolo de cenoura', qty_sent: qty })
    const s = buildSentSummary(roms, [extra('r1', 'extra_1', 2), extra('r3', 'extra_2', 3), item('r1', 'p1', 'Pão francês', 10)])
    expect(s.rows.map(r => [r.productName, r.isExtra, r.total.total])).toEqual([
      ['Pão francês', false, 10],
      ['Bolo de cenoura', true, 5],
    ])
  })

  it('conta romaneios e quantos ainda não saíram', () => {
    const s = buildSentSummary(roms, [])
    expect(s.romaneioCount).toBe(4)
    expect(s.pendingRomaneioCount).toBe(2)
  })
})
