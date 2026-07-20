import { describe, expect, it } from 'vitest'
import {
  buildRomaneioProductOptions,
  exceedsRomaneioWeightLimit,
  filterCatalogBreadsForSearch,
  formatRomaneioWeightInGrams,
  nextRomaneioTripNumber,
  orderQuantitiesByBreadId,
  parseRomaneioQty,
  sentQuantitiesByProductId,
} from './romaneioDraft'

describe('romaneioDraft', () => {
  it('cria duas opcoes para ciabatta', () => {
    const options = buildRomaneioProductOptions([
      { id: 'ciabatta', name: 'Ciabatta', unit: 'un' },
    ])

    expect(options).toMatchObject([
      { key: 'ciabatta', productId: 'ciabatta', unit: 'un', allowDecimal: false },
      { key: 'ciabatta__kg', productId: 'ciabatta', unit: 'kg', allowDecimal: true },
    ])
    expect(options.map(option => option.productName)).toEqual(['Ciabatta (un)', 'Ciabatta (kg)'])
  })

  it('trata mini croissant como kg mesmo se o cadastro vier como unidade', () => {
    const [option] = buildRomaneioProductOptions([
      { id: 'mini-croissant', name: 'Mini Croissant', unit: 'un' },
    ])

    expect(option).toMatchObject({
      key: 'mini-croissant__kg',
      productId: 'mini-croissant',
      productName: 'Mini Croissant (kg)',
      unit: 'kg',
      allowDecimal: true,
      step: 0.1,
    })
  })

  it('mantém ciabatta somente em kg para a EX', () => {
    const options = buildRomaneioProductOptions([
      { id: 'ciabatta', name: 'Ciabatta', unit: 'un' },
    ], { ciabattaOnlyKg: true })

    expect(options).toMatchObject([
      { key: 'ciabatta__kg', productId: 'ciabatta', unit: 'kg', allowDecimal: true },
    ])
  })

  it('aceita quantidade decimal com virgula', () => {
    expect(parseRomaneioQty('1,25')).toBe(1.25)
  })

  it('converte o peso digitado em kg para a orientacao em gramas', () => {
    expect(parseRomaneioQty('1,450')).toBe(1.45)
    expect(formatRomaneioWeightInGrams(1.45)).toBe('1.450')
  })

  it('bloqueia ciabatta e mini croissant acima de 10 kg', () => {
    expect(exceedsRomaneioWeightLimit('Ciabatta (kg)', 10)).toBe(false)
    expect(exceedsRomaneioWeightLimit('Ciabatta (kg)', 10.001)).toBe(true)
    expect(exceedsRomaneioWeightLimit('Ciabatta (un)', 11)).toBe(false)
    expect(exceedsRomaneioWeightLimit('Mini Croissant (kg)', 1450)).toBe(true)
    expect(exceedsRomaneioWeightLimit('Baguete', 1450)).toBe(false)
  })

  it('busca no catalogo ignorando acento, caixa e itens ja adicionados', () => {
    const catalog = [
      { id: 'ciabatta', name: 'Ciabatta' },
      { id: 'baguete', name: 'Baguete' },
      { id: 'mini-croissant', name: 'Mini Croissant' },
      { id: 'pao-de-mel', name: 'Pão de Mel' },
    ]
    expect(filterCatalogBreadsForSearch(catalog, [], 'CIA').map(b => b.id)).toEqual(['ciabatta'])
    expect(filterCatalogBreadsForSearch(catalog, [], 'pao').map(b => b.id)).toEqual(['pao-de-mel'])
    expect(filterCatalogBreadsForSearch(catalog, [], 'mini croi').map(b => b.id)).toEqual(['mini-croissant'])
    expect(filterCatalogBreadsForSearch(catalog, ['ciabatta'], 'cia')).toEqual([])
    expect(filterCatalogBreadsForSearch(catalog, [], '   ')).toEqual([])
  })

  it('limita a quantidade de sugestoes do catalogo', () => {
    const catalog = Array.from({ length: 20 }, (_, i) => ({ id: `pao-${i}`, name: `Pao ${i}` }))
    expect(filterCatalogBreadsForSearch(catalog, [], 'pao', 3)).toHaveLength(3)
  })

  it('calcula a proxima viagem pela maior viagem existente', () => {
    expect(nextRomaneioTripNumber([1, 3, 2])).toBe(4)
  })

  it('ignora viagens vazias ou invalidas', () => {
    expect(nextRomaneioTripNumber([null, undefined, 0, -1])).toBe(1)
  })

  it('soma os pedidos por produto e ignora linhas invalidas', () => {
    expect(orderQuantitiesByBreadId([
      { bread_id: 'baguete', quantity: 12 },
      { bread_id: 'baguete', quantity: '3' },
      { bread_id: 'croissant', quantity: 40 },
      { bread_id: null, quantity: 10 },
      { bread_id: 'invalido', quantity: 0 },
    ])).toEqual({ baguete: 15, croissant: 40 })
  })

  it('soma o que ja foi enviado nas viagens anteriores', () => {
    expect(sentQuantitiesByProductId([
      { product_id: 'b-brasil', qty_sent: 6 },
      { product_id: 'baguete', qty_sent: 12 },
      { product_id: 'b-brasil', qty_sent: '2' },
      { product_id: null, qty_sent: 10 },
    ])).toEqual({ 'b-brasil': 8, baguete: 12 })
  })
})
