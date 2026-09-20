import { describe, expect, it } from 'vitest'
import {
  buildInventoryCountBoard,
  collectDirtyQuantityEdits,
  isInventoryWeeklyCountEditable,
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
})
