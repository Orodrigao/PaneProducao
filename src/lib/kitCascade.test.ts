import { describe, it, expect } from 'vitest'
import { filterKitDiscards, buildKitCascadeMovements, type DiscardRow, type KitComponent } from './kitCascade'

// Cenário base: "Kit Pão de Hamburguer" composto por 4 pães de hamburguer.
// Descartar 3 kits na loja JC deve debitar 12 pães do estoque da JC.

const KIT_ID = 'kit-hamburguer'
const kitIds = new Set([KIT_ID])

function discard(over: Partial<DiscardRow> = {}): DiscardRow {
  return { id: 'descarte-1', product_id: KIT_ID, product_source: 'catalog', quantity: 3, ...over }
}

function comp(over: Partial<KitComponent> = {}): KitComponent {
  return { parent_product_id: KIT_ID, component_source: 'bread', component_id: 'pao-hamburguer', quantity: 4, ...over }
}

describe('filterKitDiscards — quais linhas de descarte disparam cascata', () => {
  it('mantém kit do catálogo com quantidade positiva', () => {
    expect(filterKitDiscards([discard()], kitIds)).toHaveLength(1)
  })

  it('ignora pão descartado direto (product_source=bread) — esse já debita sem cascata', () => {
    expect(filterKitDiscards([discard({ product_source: 'bread' })], kitIds)).toHaveLength(0)
  })

  it('ignora produto do catálogo que não é kit', () => {
    expect(filterKitDiscards([discard({ product_id: 'bolo-comum' })], kitIds)).toHaveLength(0)
  })

  it('ignora quantidade zero', () => {
    expect(filterKitDiscards([discard({ quantity: 0 })], kitIds)).toHaveLength(0)
  })

  it('aceita quantidade vinda como string do banco (numeric do Postgres)', () => {
    expect(filterKitDiscards([discard({ quantity: '2' })], kitIds)).toHaveLength(1)
  })

  it('num save misto (pão direto + kit + produto comum), só a linha do kit sai do filtro', () => {
    const paoDireto = discard({ id: 'd-pao', product_id: 'pao-frances', product_source: 'bread' })
    const boloComum = discard({ id: 'd-bolo', product_id: 'bolo-comum' })
    const kitRow = discard()
    expect(filterKitDiscards([paoDireto, kitRow, boloComum], kitIds)).toEqual([kitRow])
  })
})

describe('buildKitCascadeMovements — débito dos pães-componentes', () => {
  it('multiplica qtd do kit × qtd do componente e debita (negativo): 3 kits × 4 pães = -12', () => {
    const movements = buildKitCascadeMovements([discard()], [comp()], 'jc', 'Suélen')
    expect(movements).toHaveLength(1)
    expect(movements[0]).toEqual({
      movement_type: 'descarte_loja',
      bread_id: 'pao-hamburguer',
      location: 'jc',
      quantity: -12,
      reference_id: 'descarte-1',
      reference_type: 'descarte_kit',
      recorded_by: 'Suélen',
    })
  })

  it('gera um movimento por componente-pão do kit', () => {
    const comps = [comp({ component_id: 'pao-1' }), comp({ component_id: 'pao-2', quantity: 1 })]
    const movements = buildKitCascadeMovements([discard()], comps, 'jc', 'Suélen')
    expect(movements).toHaveLength(2)
    expect(movements.map(m => m.quantity)).toEqual([-12, -3])
  })

  it('não mistura componentes de outro kit (filtra por parent_product_id)', () => {
    const compOutroKit = comp({ parent_product_id: 'kit-outro', component_id: 'pao-do-outro' })
    const movements = buildKitCascadeMovements([discard()], [comp(), compOutroKit], 'jc', 'Suélen')
    expect(movements).toHaveLength(1)
    expect(movements[0].bread_id).toBe('pao-hamburguer')
  })

  it('ignora componente que não é pão (component_source=product) — só pão cascateia', () => {
    const compProduto = comp({ component_source: 'product', component_id: 'molho' })
    const movements = buildKitCascadeMovements([discard()], [compProduto], 'jc', 'Suélen')
    expect(movements).toHaveLength(0)
  })

  it('kit sem composição cadastrada vira no-op (nenhum débito)', () => {
    expect(buildKitCascadeMovements([discard()], [], 'jc', 'Suélen')).toHaveLength(0)
  })

  it('vários kits descartados: cada um debita seus próprios componentes com seu próprio reference_id', () => {
    const kits = new Set([KIT_ID, 'kit-baguete'])
    const rows = [
      discard(),
      discard({ id: 'descarte-2', product_id: 'kit-baguete', quantity: 2 }),
    ]
    const comps = [comp(), comp({ parent_product_id: 'kit-baguete', component_id: 'baguete', quantity: 1 })]
    const movements = buildKitCascadeMovements(filterKitDiscards(rows, kits), comps, 'ja', 'Elis')
    expect(movements).toHaveLength(2)
    // location/recorded_by assertados aqui de propósito, com valores DIFERENTES do
    // teste principal: pega regressão que fixe loja ou responsável (mutation test)
    expect(movements[0]).toMatchObject({ bread_id: 'pao-hamburguer', quantity: -12, reference_id: 'descarte-1', location: 'ja', recorded_by: 'Elis' })
    expect(movements[1]).toMatchObject({ bread_id: 'baguete', quantity: -2, reference_id: 'descarte-2', location: 'ja', recorded_by: 'Elis' })
  })

  it('dois kits que usam o MESMO pão geram movimentos separados, um por descarte (não somados)', () => {
    const kits = new Set([KIT_ID, 'kit-lanche'])
    const rows = [
      discard(),
      discard({ id: 'descarte-2', product_id: 'kit-lanche', quantity: 1 }),
    ]
    const comps = [comp(), comp({ parent_product_id: 'kit-lanche', quantity: 2 })]
    const movements = buildKitCascadeMovements(filterKitDiscards(rows, kits), comps, 'jc', 'Suélen')
    expect(movements).toHaveLength(2)
    expect(movements.map(m => m.bread_id)).toEqual(['pao-hamburguer', 'pao-hamburguer'])
    // reference_ids distintos preservam o vínculo 1 movimento ↔ 1 descarte,
    // que a idempotência do re-save em /sobras usa pra limpar movimentos antigos
    expect(movements.map(m => m.reference_id)).toEqual(['descarte-1', 'descarte-2'])
    expect(movements.map(m => m.quantity)).toEqual([-12, -2])
  })

  it('quantidades vindas como string do banco multiplicam como número, não concatenam', () => {
    const movements = buildKitCascadeMovements(
      [discard({ quantity: '3' })], [comp({ quantity: '1.5' })], 'ex', 'Rodrigão'
    )
    expect(movements[0].quantity).toBe(-4.5)
  })
})
