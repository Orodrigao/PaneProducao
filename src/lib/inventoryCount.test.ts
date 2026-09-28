import { describe, expect, it } from 'vitest'
import { bakeryDayKey } from './bakeryClock'
import {
  buildInventoryCountBoard,
  collectDirtyQuantityEdits,
  formatDayMonth,
  inventoryCountReopenAccess,
  inventoryCountReopenDeadline,
  inventoryCountWeekStart,
  isInventoryCountOfCurrentWeek,
  isInventoryWeeklyCountEditable,
  listPendingInventoryCountNames,
  summarizeInventoryCountBoard,
  type InventoryCountProductLookup,
  type InventoryWeeklyCountItemRow,
} from './inventoryCount'

const products: Record<string, InventoryCountProductLookup> = {
  farinha: { id: 'farinha', name: 'Farinha de trigo', category: 'INSUMOS' },
  fermento: { id: 'fermento', name: 'Fermento biológico', category: 'INSUMOS' },
}

const itemFarinha: InventoryWeeklyCountItemRow = {
  id: 'item-farinha', product_id: 'farinha', quantity: null, unit: 'kg',
  updated_at: '2026-09-20T10:00:00Z', updated_by_name: null,
}
const itemFermento: InventoryWeeklyCountItemRow = {
  id: 'item-fermento', product_id: 'fermento', quantity: 2, unit: 'g',
  updated_at: '2026-09-20T10:00:00Z', updated_by_name: 'Rafaela',
}

describe('contagem semanal de estoque', () => {
  it('marca como não contado o item sem quantidade salva ainda', () => {
    const [row] = buildInventoryCountBoard([itemFarinha], products)
    expect(row.counted).toBe(false)
    expect(row.quantity).toBeNull()
    expect(row.displayUnit).toBe('kg')
  })

  it('trata zero contado como contagem válida, diferente de não contado', () => {
    const [row] = buildInventoryCountBoard([{ ...itemFarinha, quantity: 0 }], products)
    expect(row.counted).toBe(true)
    expect(row.quantity).toBe(0)
  })

  it('ordena por nome e resume contados/pendentes', () => {
    const rows = buildInventoryCountBoard([itemFarinha, itemFermento], products)
    expect(rows.map(row => row.productId)).toEqual(['farinha', 'fermento'])
    expect(summarizeInventoryCountBoard(rows)).toEqual({ total: 2, counted: 1, pending: 1 })
  })

  it('mostra insumo removido do catálogo em vez de quebrar a lista', () => {
    const [row] = buildInventoryCountBoard([{ ...itemFarinha, product_id: 'sumiu' }], products)
    expect(row.productName).toBe('(insumo removido do catálogo)')
  })

  it('usa a unidade canônica salva no item, mesmo se o cadastro mudou depois', () => {
    const [row] = buildInventoryCountBoard([{ ...itemFarinha, unit: 'quilos' }], products)
    expect(row.displayUnit).toBe('kg')
  })

  it('só permite edição com a contagem aberta', () => {
    expect(isInventoryWeeklyCountEditable(null)).toBe(false)
    expect(isInventoryWeeklyCountEditable({ status: 'aberta' })).toBe(true)
    expect(isInventoryWeeklyCountEditable({ status: 'fechada' })).toBe(false)
  })

  it('identifica edições digitadas ainda não salvas, para descarregar antes de fechar', () => {
    const rows = buildInventoryCountBoard([itemFarinha, itemFermento], products)
    const dirty = collectDirtyQuantityEdits(rows, { farinha: '12.5', fermento: '2' })
    expect(dirty).toEqual([{ productId: 'farinha', rawValue: '12.5' }])
  })

  it('lista pelo nome o que ainda falta contar, considerando o que foi digitado e não salvou', () => {
    const rows = buildInventoryCountBoard([itemFarinha, itemFermento], products)
    expect(listPendingInventoryCountNames(rows, {})).toEqual(['Farinha de trigo'])
    expect(listPendingInventoryCountNames(rows, { farinha: '3' })).toEqual([])
    expect(listPendingInventoryCountNames(rows, { farinha: '  ' })).toEqual(['Farinha de trigo'])
    expect(listPendingInventoryCountNames(rows, { fermento: '' })).toEqual(['Farinha de trigo', 'Fermento biológico'])
  })
})

describe('prazo para quem conta reabrir a contagem', () => {
  const closedCount = (week_start: string) => ({ status: 'fechada' as const, week_start })
  const counter = { isAdmin: false, canCount: true }

  it('acha a segunda-feira da semana, como date_trunc(week) do banco', () => {
    expect(inventoryCountWeekStart('2026-09-28')).toBe('2026-09-28')
    expect(inventoryCountWeekStart('2026-10-03')).toBe('2026-09-28')
    expect(inventoryCountWeekStart('2026-10-04')).toBe('2026-09-28')
    expect(inventoryCountWeekStart('2026-10-05')).toBe('2026-10-05')
    expect(inventoryCountWeekStart('2027-01-01')).toBe('2026-12-28')
    expect(inventoryCountWeekStart('')).toBe('')
    expect(inventoryCountWeekStart('2026-02-31')).toBe('')
  })

  it('o prazo termina no domingo da semana da contagem', () => {
    expect(inventoryCountReopenDeadline('2026-09-28')).toBe('2026-10-04')
    expect(inventoryCountReopenDeadline('2026-12-28')).toBe('2027-01-03')
    expect(inventoryCountReopenDeadline('2026-09-29')).toBe('')
    expect(inventoryCountReopenDeadline('lixo')).toBe('')
    expect(formatDayMonth('2026-10-04')).toBe('04/10')
  })

  it('reconhece a contagem da semana de hoje', () => {
    expect(isInventoryCountOfCurrentWeek({ week_start: '2026-09-28' }, '2026-10-03')).toBe(true)
    expect(isInventoryCountOfCurrentWeek({ week_start: '2026-09-21' }, '2026-10-03')).toBe(false)
    expect(isInventoryCountOfCurrentWeek(null, '2026-10-03')).toBe(false)
    expect(isInventoryCountOfCurrentWeek({ week_start: '2026-09-28' }, '')).toBe(false)
  })

  it('quem conta reabre de sábado até domingo; na segunda, só o admin', () => {
    const count = closedCount('2026-09-28')
    expect(inventoryCountReopenAccess({ count, ...counter, todayKey: '2026-10-03' })).toBe('counter-in-time')
    expect(inventoryCountReopenAccess({ count, ...counter, todayKey: '2026-10-04' })).toBe('counter-in-time')
    expect(inventoryCountReopenAccess({ count, ...counter, todayKey: '2026-10-05' })).toBe('counter-late')
    expect(inventoryCountReopenAccess({ count, isAdmin: true, canCount: true, todayKey: '2026-10-20' })).toBe('admin')
  })

  it('contagem real de 26/09 já passou do prazo em 28/09: continua só com o admin', () => {
    expect(inventoryCountReopenAccess({ count: closedCount('2026-09-21'), ...counter, todayKey: '2026-09-28' }))
      .toBe('counter-late')
  })

  it('a virada é meia-noite de Brasília, não de UTC nem do aparelho', () => {
    const count = closedCount('2026-09-28')
    const domingoNoite = bakeryDayKey(new Date('2026-10-05T02:59:59Z'))
    const segundaCedo = bakeryDayKey(new Date('2026-10-05T03:00:00Z'))
    expect(inventoryCountReopenAccess({ count, ...counter, todayKey: domingoNoite })).toBe('counter-in-time')
    expect(inventoryCountReopenAccess({ count, ...counter, todayKey: segundaCedo })).toBe('counter-late')
  })

  it('não oferece reabrir para contagem aberta, inexistente ou sem permissão; data inválida bloqueia', () => {
    expect(inventoryCountReopenAccess({ count: null, ...counter, todayKey: '2026-10-03' })).toBe('none')
    expect(inventoryCountReopenAccess({ count: { status: 'aberta', week_start: '2026-09-28' }, ...counter, todayKey: '2026-10-03' }))
      .toBe('none')
    expect(inventoryCountReopenAccess({ count: closedCount('2026-09-28'), isAdmin: false, canCount: false, todayKey: '2026-10-03' }))
      .toBe('none')
    expect(inventoryCountReopenAccess({ count: closedCount('2026-09-28'), ...counter, todayKey: '' })).toBe('counter-late')
  })
})
