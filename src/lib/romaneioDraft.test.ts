import { describe, expect, it } from 'vitest'
import {
  buildRomaneioProductOptions,
  compositionsFollowingOrder,
  exceedsRomaneioWeightLimit,
  filterPendingRomaneioBreads,
  filterCatalogBreadsForSearch,
  formatRomaneioWeightInGrams,
  isWeightControlledRomaneioProduct,
  labelRomaneioExtraName,
  nextRomaneioTripNumber,
  orderQuantitiesByBreadId,
  pendingReplacementQuantitiesByProductId,
  romaneioCandidateBreadIds,
  romaneioEmptyDraftReason,
  romaneioExcessOverRequestedQty,
  parseRomaneioQty,
  romaneioOrderDiffersFromPlan,
  romaneioOrderProgressLabel,
  romaneioRequestedQuantities,
  restoreRomaneioDraft,
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

  it('trata mini croissant e pizza romana como kg mesmo se o cadastro vier como unidade', () => {
    const [option] = buildRomaneioProductOptions([
      { id: 'mini-croissant', name: 'Mini Croissant', unit: 'un' },
    ])
    const [pizzaOption] = buildRomaneioProductOptions([
      { id: 'pizza-romana-calabresa', name: 'Pizza Romana de Calabresa', unit: 'un' },
    ])

    expect(option).toMatchObject({
      key: 'mini-croissant__kg',
      productId: 'mini-croissant',
      productName: 'Mini Croissant (kg)',
      unit: 'kg',
      allowDecimal: true,
      step: 0.1,
    })
    expect(pizzaOption).toMatchObject({
      key: 'pizza-romana-calabresa__kg',
      productId: 'pizza-romana-calabresa',
      productName: 'Pizza Romana de Calabresa (kg)',
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

  it('bloqueia ciabatta, mini croissant e pizza romana acima de 10 kg', () => {
    expect(exceedsRomaneioWeightLimit('Ciabatta (kg)', 10)).toBe(false)
    expect(exceedsRomaneioWeightLimit('Ciabatta (kg)', 10.001)).toBe(true)
    expect(exceedsRomaneioWeightLimit('Ciabatta (un)', 11)).toBe(false)
    expect(exceedsRomaneioWeightLimit('Mini Croissant (kg)', 1450)).toBe(true)
    expect(exceedsRomaneioWeightLimit('Pizza Romana de Calabresa', 1450)).toBe(true)
    expect(exceedsRomaneioWeightLimit('Baguete', 1450)).toBe(false)
  })

  it('trata qualquer nome com (kg) como controlado por peso', () => {
    expect(isWeightControlledRomaneioProduct('Pão de mortadela (kg)')).toBe(true)
    expect(isWeightControlledRomaneioProduct('Pão de mortadela (un)')).toBe(false)
    expect(isWeightControlledRomaneioProduct('Pão de mortadela')).toBe(false)
    expect(exceedsRomaneioWeightLimit('Pão de mortadela (kg)', 1450)).toBe(true)
  })

  it('rotula o avulso com a unidade escolhida', () => {
    expect(labelRomaneioExtraName('Pão de mortadela', 'kg')).toBe('Pão de mortadela (kg)')
    expect(labelRomaneioExtraName('Pão de mortadela', 'un')).toBe('Pão de mortadela')
    expect(labelRomaneioExtraName('Ciabatta', 'un')).toBe('Ciabatta (un)')
    expect(labelRomaneioExtraName('Ciabatta', 'kg')).toBe('Ciabatta (kg)')
    expect(labelRomaneioExtraName('Pão de mortadela (kg)', 'kg')).toBe('Pão de mortadela (kg)')
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

  it('mantem no romaneio o pao que so existe na composicao do planejamento', () => {
    expect(romaneioCandidateBreadIds(
      [{ bread_id: 'baguete', quantity: 3 }],
      ['ciabatta'],
      [],
    )).toEqual(['baguete', 'ciabatta'])
  })

  // 08/10/2026: o pedido da JC baixou o gorgonzola de 8 para 4 depois de gerado
  // pelo Planejamento; Producao, Forno e Geolar mostraram 4 e o Romaneio pediu 8.
  it('segue o pedido editado depois do Planejamento e guarda o pao novo planejado', () => {
    const compositions = compositionsFollowingOrder(
      { gorgonzola: { total: 8, newQuantity: 8, leftoverQuantity: 0, frozenQuantity: 0 } },
      { gorgonzola: 4 },
    )

    expect(compositions.gorgonzola).toEqual({
      total: 4, newQuantity: 4, leftoverQuantity: 0, frozenQuantity: 0, plannedNewQuantity: 8,
    })
    expect(romaneioRequestedQuantities({ gorgonzola: 4 }, compositions)).toEqual({ gorgonzola: 4 })
    expect(romaneioOrderDiffersFromPlan(compositions.gorgonzola)).toBe(true)
  })

  it('soma congelado e sobra ao pedido: sem edicao, a meta e o planejado', () => {
    const planejado = { baguete: { total: 10, newQuantity: 3, leftoverQuantity: 2, frozenQuantity: 5 } }

    const semEdicao = compositionsFollowingOrder(planejado, { baguete: 3 })
    expect(romaneioRequestedQuantities({ baguete: 3 }, semEdicao)).toEqual({ baguete: 10 })
    expect(romaneioOrderDiffersFromPlan(semEdicao.baguete)).toBe(false)

    const editado = compositionsFollowingOrder(planejado, { baguete: 1 })
    expect(romaneioRequestedQuantities({ baguete: 1 }, editado)).toEqual({ baguete: 8 })
    expect(editado.baguete).toMatchObject({ newQuantity: 1, frozenQuantity: 5, leftoverQuantity: 2 })
  })

  it('loja so com congelado e sobra, sem pedido, continua com a meta do Planejamento', () => {
    const compositions = compositionsFollowingOrder(
      { ciabatta: { total: 10, newQuantity: 0, leftoverQuantity: 2, frozenQuantity: 8 } },
      {},
    )

    expect(romaneioRequestedQuantities({}, compositions)).toEqual({ ciabatta: 10 })
    expect(romaneioOrderDiffersFromPlan(compositions.ciabatta)).toBe(false)
  })

  it('pao tirado do pedido sai da meta; pao pedido fora do Planejamento fica com o pedido', () => {
    const pedido = { rugbrod: 5, sarraceno: 4 }
    const compositions = compositionsFollowingOrder({
      multi: { total: 16, newQuantity: 16, leftoverQuantity: 0, frozenQuantity: 0 },
      rugbrod: { total: 0, newQuantity: 0, leftoverQuantity: 0, frozenQuantity: 0 },
    }, pedido)

    expect(romaneioRequestedQuantities(pedido, compositions)).toEqual({ rugbrod: 5, sarraceno: 4 })
    expect(compositions.multi).toMatchObject({ total: 0, newQuantity: 0, plannedNewQuantity: 16 })
    expect(romaneioOrderDiffersFromPlan(compositions.multi)).toBe(true)
    expect(romaneioOrderDiffersFromPlan(compositions.rugbrod)).toBe(true)
  })

  it('reaplicar o pedido numa composicao ja ajustada nao perde o pao novo planejado', () => {
    const ajustada = compositionsFollowingOrder(
      { gorgonzola: { total: 8, newQuantity: 8, leftoverQuantity: 0, frozenQuantity: 0 } },
      { gorgonzola: 4 },
    )

    expect(compositionsFollowingOrder(ajustada, { gorgonzola: 4 }).gorgonzola.plannedNewQuantity).toBe(8)
    expect(romaneioOrderDiffersFromPlan(undefined)).toBe(false)
    expect(romaneioOrderDiffersFromPlan({ total: 8, newQuantity: 8, leftoverQuantity: 0, frozenQuantity: 0 })).toBe(false)
  })

  // Seed do proximo dia: 10 baguetes, 5 congeladas e 2 sobras propostas ainda
  // nao conferidas; o pedido gerado tem 3. A composicao so conta sobra conferida.
  it('sobra proposta e ainda nao conferida fica fora da meta e aparece como diferenca', () => {
    const compositions = compositionsFollowingOrder(
      { baguete: { total: 10, newQuantity: 5, leftoverQuantity: 0, frozenQuantity: 5 } },
      { baguete: 3 },
    )

    expect(romaneioRequestedQuantities({ baguete: 3 }, compositions)).toEqual({ baguete: 8 })
    expect(romaneioOrderDiffersFromPlan(compositions.baguete)).toBe(true)
  })

  it('pao tirado do pedido continua na lista, sem meta, para o aviso aparecer', () => {
    const compositions = compositionsFollowingOrder(
      { multi: { total: 16, newQuantity: 16, leftoverQuantity: 0, frozenQuantity: 0 } },
      {},
    )
    const requested = romaneioRequestedQuantities({}, compositions)

    expect(requested).toEqual({})
    expect(filterPendingRomaneioBreads([{ id: 'multi', name: 'Multi' }], requested, {}))
      .toEqual([{ id: 'multi', name: 'Multi' }])
  })

  it('rascunho recuperado mantem o que foi digitado e pega pedido e composicao atuais', () => {
    const salvo = {
      breads: [{ id: 'baguete' }, { id: 'focaccia' }],
      qtys: { baguete: 1, focaccia: 2, extra_1: 3 },
      extras: { extra_1: 'Pao de mortadela' },
      obs: 'Levar cedo',
      extraInput: 'pao',
      orderQtys: { baguete: 4 },
      trip: 1,
    }
    const atual = {
      breads: [{ id: 'baguete' }],
      qtys: {},
      extras: {},
      obs: '',
      extraInput: '',
      orderQtys: { baguete: 6 },
      trip: 2,
    }

    expect(restoreRomaneioDraft(salvo, atual)).toEqual({
      breads: [{ id: 'baguete' }, { id: 'focaccia' }],
      qtys: { baguete: 1, focaccia: 2, extra_1: 3 },
      extras: { extra_1: 'Pao de mortadela' },
      obs: 'Levar cedo',
      extraInput: 'pao',
      orderQtys: { baguete: 6 },
      trip: 2,
    })
  })

  it('total zero nao sobrepoe o pedido (bug de 15/09)', () => {
    expect(romaneioRequestedQuantities(
      { baguete: 12 },
      { baguete: { total: 0, newQuantity: 0, leftoverQuantity: 0, frozenQuantity: 0 } },
    )).toEqual({ baguete: 12 })
  })

  it('soma o que ja foi enviado nas viagens anteriores', () => {
    expect(sentQuantitiesByProductId([
      { product_id: 'b-brasil', qty_sent: 6 },
      { product_id: 'baguete', qty_sent: 12 },
      { product_id: 'b-brasil', qty_sent: '2' },
      { product_id: null, qty_sent: 10 },
    ])).toEqual({ 'b-brasil': 8, baguete: 12 })
  })

  it('retira da proxima viagem o pao cujo pedido ja foi totalmente enviado', () => {
    const breads = [
      { id: 'baguete', name: 'Baguete' },
      { id: 'croissant', name: 'Croissant' },
      { id: 'especial', name: 'Pao especial' },
    ]

    expect(filterPendingRomaneioBreads(
      breads,
      { baguete: 20, croissant: 30 },
      { baguete: 20, croissant: 12 },
    )).toEqual([
      { id: 'croissant', name: 'Croissant' },
      { id: 'especial', name: 'Pao especial' },
    ])
  })

  it('mantem visivel o pao com reposicao pendente mesmo se o pedido ja foi enviado', () => {
    const breads = [
      { id: 'baguete', name: 'Baguete' },
      { id: 'croissant', name: 'Croissant' },
    ]

    expect(filterPendingRomaneioBreads(
      breads,
      { baguete: 20, croissant: 30 },
      { baguete: 20, croissant: 30 },
      { baguete: 2 },
    )).toEqual([
      { id: 'baguete', name: 'Baguete' },
    ])
  })

  // Cenario da EX no Banco Preview: o pedido do dia e de 8 baguetes e as viagens
  // anteriores ja levaram 18. A unica coisa que mantem a baguete na tela de
  // criacao e a reposicao aberta; quando ela e baixada, a lista fica VAZIA.
  // O smoke do navegador depende desse fio de cabelo, e a tela nao distingue
  // lista vazia de lista ainda carregando (ver lessons.md 2026-08-21).
  it('esvazia a lista quando a reposicao da EX e baixada e o pedido ja foi superado', () => {
    const breads = [{ id: 'teste-baguete', name: '[TESTE] Baguete' }]
    const pedidoDoDia = { 'teste-baguete': 8 }
    const jaEnviado = { 'teste-baguete': 18 }

    expect(filterPendingRomaneioBreads(breads, pedidoDoDia, jaEnviado, { 'teste-baguete': 2 }))
      .toEqual(breads)
    expect(filterPendingRomaneioBreads(breads, pedidoDoDia, jaEnviado, {}))
      .toEqual([])
  })

  it('soma reposicoes abertas por produto e ignora linhas invalidas', () => {
    expect(pendingReplacementQuantitiesByProductId([
      { product_id: 'baguete', pending_quantity: 2 },
      { product_id: 'baguete', pending_quantity: '1.5' },
      { product_id: 'ciabatta', pending_quantity: 0 },
      { product_id: null, pending_quantity: 4 },
    ])).toEqual({ baguete: 3.5 })
  })

  it('avisa somente quando enviado passa do pedido restante mais pendencia', () => {
    expect(romaneioExcessOverRequestedQty({
      ordered: 20,
      previouslySent: 12,
      pendingReplacement: 2,
      currentSent: 10,
    })).toBe(0)

    expect(romaneioExcessOverRequestedQty({
      ordered: 20,
      previouslySent: 12,
      pendingReplacement: 2,
      currentSent: 11,
    })).toBe(1)
  })

  it('mantem o pao completo disponivel para ser adicionado pela busca', () => {
    const catalog = [{ id: 'baguete', name: 'Baguete' }]
    const pending = filterPendingRomaneioBreads(catalog, { baguete: 20 }, { baguete: 20 })

    expect(filterCatalogBreadsForSearch(catalog, pending.map(bread => bread.id), 'baguete'))
      .toEqual([{ id: 'baguete', name: 'Baguete' }])
  })

  it('explica quanto ja saiu e quanto ainda falta separar', () => {
    expect(romaneioOrderProgressLabel(20, 12)).toBe('12 de 20 (faltam 8)')
  })

  it('nao explica rascunho vazio quando ha produto ou extra na lista', () => {
    expect(romaneioEmptyDraftReason({ productCount: 1, extraCount: 0, orderQuantities: {} })).toBeNull()
    expect(romaneioEmptyDraftReason({ productCount: 0, extraCount: 1, orderQuantities: {} })).toBeNull()
  })

  it('diz que a loja nao tem pedido quando o rascunho esta vazio e ninguem pediu nada', () => {
    expect(romaneioEmptyDraftReason({ productCount: 0, extraCount: 0, orderQuantities: {} }))
      .toBe('sem-pedido')
    expect(romaneioEmptyDraftReason({
      productCount: 0,
      extraCount: 0,
      orderQuantities: { baguete: 0, ciabatta: -5, focaccia: NaN },
    })).toBe('sem-pedido')
  })

  it('diz que ja saiu tudo quando havia pedido mas o rascunho ficou vazio', () => {
    expect(romaneioEmptyDraftReason({
      productCount: 0,
      extraCount: 0,
      orderQuantities: { baguete: 20 },
    })).toBe('tudo-enviado')
  })
})
