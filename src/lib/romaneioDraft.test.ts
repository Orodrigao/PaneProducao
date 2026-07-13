import { describe, expect, it } from 'vitest'
import { buildRomaneioProductOptions, nextRomaneioTripNumber, parseRomaneioQty } from './romaneioDraft'

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

  it('calcula a proxima viagem pela maior viagem existente', () => {
    expect(nextRomaneioTripNumber([1, 3, 2])).toBe(4)
  })

  it('ignora viagens vazias ou invalidas', () => {
    expect(nextRomaneioTripNumber([null, undefined, 0, -1])).toBe(1)
  })
})
