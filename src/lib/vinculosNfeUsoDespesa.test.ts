import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

import { previewItemCorrection, requestsResale, RESALE_CORRECTION_NOT_READY } from '@/lib/vinculosNfeClient'
import { describeItemImpact, itemBlockReason, parseItemCorrectionImpact, parseItemCorrectionResult, selectionBlockReason } from '@/lib/vinculosNfeNotas'
import { describeConsumption, describeMemories, describePurchaseFinance, groupByNonCatalogKind, itemSide, kindSwapTarget, matchesNonCatalogSearch, MIXED_KINDS_REASON, purchaseStatusLabel } from '@/lib/vinculosNfeUsoDespesa'

// Efeito no formato da fase 5 (public.correct_payable_purchase_items): margarina
// lançada como uso ou despesa numa conta paga vai para o insumo.
const impactJson = {
  action: 'corrigir',
  items: [{
    item_id: 'i1', purchase_id: 'p1', supplier_name: 'Bersaglio', nfe_number: '184062', issue_date: '2026-09-22',
    source_description: 'MARGARINA RICCA MASSA E BOLO CX 30KG', source_unit: 'CX', quantity: 1, item_value: 269.99,
    before: { mapping_status: 'nao_aplicavel', product_id: null, product_name: null, conversion_factor: null, usable_quantity: null, normalized_unit_cost: null, cost_applied: null },
    after: { mapping_status: 'mapeado', product_id: 'marg', product_name: 'Margarina', product_unit: 'kg', conversion_factor: 30, usable_quantity: 30, normalized_unit_cost: 8.999667, cost_applied: true },
    memories_before: [{ kind: 'uso_despesa', mapping_id: 'm1', product_id: null, product_name: null, conversion_factor: null, version: '2026-09-22T10:00:00' }],
    memories_after: [],
  }],
  products: [{ product_id: 'marg', name: 'Margarina', unit: 'kg', active: true, cost_before: 8.5, cost_after: 9 }],
  decisions: [{ product_id: 'marg', kind: 'destino', purchase_id: 'p1', cost_from_this_note: true }],
  memories_off: ['m1'],
  purchases: [{
    purchase_id: 'p1', status: 'paga', total_value: 1845.53, competence_month: '2026-09-01',
    installments: 1, installments_paid: 1, paid_total: 1850.53, late_fees: 5, last_paid_date: '2026-10-06',
    split: [{ key: 'cmv_materia_prima', label: 'CMV — Matéria-prima', group: 'cmv', amount: 1845.53 }],
    ledger: [
      { key: 'cmv_materia_prima', label: 'CMV — Matéria-prima', competence_month: '2026-09-01', amount: 1845.53 },
      { key: 'financeiras', label: 'Financeiras', competence_month: '2026-10-01', amount: 5 },
    ],
    version: { updated_at: '2026-10-06T12:00:00' },
  }],
  consumption: {
    closed_periods: 3,
    items: [{
      period_end_count_id: 'c2', product_id: 'marg', product_name: 'Margarina', unit: 'kg',
      before: { qty_in: 0, qty_consumed: -15, unit_cost: 8.5, value_consumed: -127.5, status: 'conferir' },
      after: { qty_in: 30, qty_consumed: 15, unit_cost: 8.75, value_consumed: 131.25, status: 'ok' },
    }],
    periods: [{
      period_end_count_id: 'c2', start_date: '2026-09-26', end_date: '2026-10-03',
      before: { counted: 0, outside: 10, not_stock: 269.99, unclassified: 0 },
      after: { counted: 269.99, outside: 10, not_stock: 0, unclassified: 0 },
    }],
  },
}

describe('item entre uso ou despesa e insumo (fase 5)', () => {
  it('lê o efeito novo e continua lendo correção gravada antes da fase 5', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    expect(impact.items[0].before.mapping_status).toBe('nao_aplicavel')
    expect(impact.items[0].memories_before[0]).toMatchObject({ kind: 'uso_despesa', mapping_id: 'm1' })
    expect(impact.memories_off).toEqual(['m1'])
    expect(impact.purchases[0]).toMatchObject({ status: 'paga', installments_paid: 1, late_fees: 5 })
    expect(impact.consumption?.items[0].after?.qty_in).toBe(30)

    const antiga = parseItemCorrectionImpact({ action: 'corrigir', items: [{ before: { product_id: 'x' }, after: { product_id: 'y' } }] })
    expect(antiga.items[0].before.mapping_status).toBe('mapeado')
    expect(antiga.consumption).toBeNull()
    expect(antiga.memories_off).toEqual([])
    expect(antiga.purchases).toEqual([])
  })

  it('diz de onde o item sai quando era uso ou despesa', () => {
    const line = describeItemImpact(parseItemCorrectionImpact(impactJson).items[0])
    expect(line).toContain('uso ou despesa (fora da receita, do estoque e do custo) → Margarina, fator 30, 30 kg')
  })

  it('mostra a conta paga, o juro e o livro-caixa, e que nada disso muda', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    const line = describePurchaseFinance(impact.purchases[0], impact)
    expect(line).toContain('NF 184062 de Bersaglio')
    expect(line).toMatch(/conta paga: 1 de 1 parcela\(s\) paga\(s\), R\$\s1\.850,53 saíram do caixa \(último pagamento em 06\/10\/2026\), dos quais R\$\s5,00 de juros ou multa/)
    expect(line).toMatch(/categoria de DRE da conta: CMV — Matéria-prima R\$\s1\.845,53/)
    expect(line).toMatch(/no livro-caixa: CMV — Matéria-prima R\$\s1\.845,53 em setembro de 2026; Financeiras R\$\s5,00 em outubro de 2026/)
    expect(line).toContain('Nada disso muda com esta correção.')
    expect(line).not.toContain('Atenção')
  })

  it('avisa quando a categoria da conta não combina com o novo destino do item', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    const despesa = { ...impact.purchases[0], split: [{ key: 'outras_despesas', label: 'Outras despesas', group: 'outras', competence_month: null, amount: 1845.53 }] }
    expect(describePurchaseFinance(despesa, impact)).toContain('não é de custo de mercadoria (CMV)')

    const virouDespesa = parseItemCorrectionImpact({
      ...impactJson,
      items: [{ ...impactJson.items[0], before: impactJson.items[0].after, after: impactJson.items[0].before }],
    })
    expect(describePurchaseFinance(virouDespesa.purchases[0], virouDespesa)).toContain('a conta inteira está em custo de mercadoria (CMV)')

    const aberta = { ...impact.purchases[0], status: 'aberta', installments_paid: 0, paid_total: 0, ledger: [] }
    expect(describePurchaseFinance(aberta, impact)).toMatch(/conta em aberto \(R\$\s1\.845,53\), nenhuma parcela paga/)
  })

  it('descreve o consumo das contagens fechadas que muda', () => {
    const lines = describeConsumption(parseItemCorrectionImpact(impactJson).consumption)
    expect(lines[0]).toMatch(/^semana de 26\/09\/2026 a 03\/10\/2026 · Margarina: entrada 0 kg → 30 kg; consumo -15 kg → 15 kg; valor -R\$\s127,50 → R\$\s131,25 \(conferir \(consumo negativo\) → ok\)\.$/)
    expect(lines[1]).toMatch(/compras contadas R\$\s0,00 → R\$\s269,99; fora da contagem R\$\s10,00 → R\$\s10,00; não é estoque R\$\s269,99 → R\$\s0,00\./)
    expect(describeConsumption(null)[0]).toContain('anterior')
    expect(describeConsumption({ closed_periods: 0, items: [], periods: [] })[0]).toContain('Ainda não há duas contagens')
    expect(describeConsumption({ closed_periods: 2, items: [], periods: [] })[0]).toContain('Nenhuma contagem semanal fechada muda')
  })

  it('dá as datas da semana que muda só pelo custo, sem mudar os totais de compras', () => {
    const consumo = parseItemCorrectionImpact({
      ...impactJson,
      consumption: {
        closed_periods: 3,
        periods: [],
        items: [{
          period_end_count_id: 'c3', start_date: '2026-10-03', end_date: '2026-10-10', product_id: 'marg', product_name: 'Margarina', unit: 'kg',
          before: { qty_in: 0, qty_consumed: 5, unit_cost: 8.5, value_consumed: 42.5, status: 'ok' },
          after: { qty_in: 0, qty_consumed: 5, unit_cost: 9, value_consumed: 45, status: 'ok' },
        }],
      },
    }).consumption
    expect(describeConsumption(consumo)).toEqual([
      expect.stringMatching(/^semana de 03\/10\/2026 a 10\/10\/2026 · Margarina: entrada 0 kg → 0 kg; consumo 5 kg → 5 kg; valor R\$\s42,50 → R\$\s45,00 \(ok → ok\)\.$/),
    ])
  })

  it('não esconde memórias diferentes de itens com a mesma descrição', () => {
    const base = impactJson.items[0]
    const impact = parseItemCorrectionImpact({
      ...impactJson,
      items: [
        base,
        { ...base, item_id: 'i2', memories_before: [], memories_after: [{ kind: 'insumo', mapping_id: 'm9', product_name: 'Margarina', conversion_factor: 30 }] },
        { ...base, item_id: 'i3' },
      ],
    })
    const lines = describeMemories(impact)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('será desligada')
    expect(lines[1]).toContain('a próxima nota sugere Margarina com fator 30')

    // Mesma descrição e mesmo produto, mas fator diferente: as duas frases ficam.
    const fatores = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: [],
      items: [
        { ...base, memories_before: [], memories_after: [{ kind: 'insumo', mapping_id: 'm7', product_name: 'Margarina', conversion_factor: 1 }] },
        { ...base, item_id: 'i2', memories_before: [], memories_after: [{ kind: 'insumo', mapping_id: 'm8', product_name: 'Margarina', conversion_factor: 30 }] },
      ],
    })
    expect(describeMemories(fatores)).toHaveLength(2)
  })

  it('diz o que a próxima nota do fornecedor vai sugerir', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    expect(describeMemories(impact)).toEqual([
      'MARGARINA RICCA MASSA E BOLO CX 30KG (Bersaglio): a memória de uso ou despesa deste item será desligada; a próxima nota chega sem sugestão e quem importa escolhe.',
    ])
    const paraDespesa = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: [],
      items: [{
        ...impactJson.items[0], before: impactJson.items[0].after, after: impactJson.items[0].before,
        memories_before: [{ kind: 'insumo', mapping_id: 'm2', product_name: 'Margarina', conversion_factor: 30 }],
        memories_after: [{ kind: 'insumo', mapping_id: 'm2', product_name: 'Margarina', conversion_factor: 30 }],
      }],
    })
    expect(describeMemories(paraDespesa)[0]).toContain('a próxima nota sugere Margarina com fator 30; para ela vir como uso ou despesa, desligue essa memória')
    expect(describeMemories({ ...impact, action: 'desfazer', memories_off: [] }).at(-1)).toContain('Desfazer não religa memória')
  })

  it('memória de revenda sem cadastro é dita como revenda, não como "sem sugestão" nem uso ou despesa', () => {
    // O banco manda kind 'uso_despesa' para toda memória fora do cadastro (a
    // correção desliga por ele) e o tipo em non_catalog_kind.
    expect(parseItemCorrectionImpact({
      ...impactJson,
      items: [{ ...impactJson.items[0], memories_after: [{ kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm5' }] }],
    }).items[0].memories_after[0]).toMatchObject({ kind: 'uso_despesa', non_catalog_kind: 'revenda' })
    const base = impactJson.items[0]
    const revendaLigada = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: [],
      items: [{ ...base, memories_before: [], memories_after: [{ kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm5', product_name: null, conversion_factor: null }] }],
    })
    expect(describeMemories(revendaLigada)[0]).toContain('a próxima nota sugere revenda sem cadastro.')

    const revendaDesligada = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: ['m6'],
      items: [{ ...base, memories_before: [{ kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm6', product_name: null, conversion_factor: null }], memories_after: [] }],
    })
    expect(describeMemories(revendaDesligada)[0]).toContain('a memória de revenda sem cadastro deste item será desligada; ')
  })

  it('com mais de uma memória para o item, a prévia segue o desempate da importação: a mais recente', () => {
    const base = impactJson.items[0]
    const duas = (memories_after: unknown[]) => parseItemCorrectionImpact({
      ...impactJson, memories_off: [], items: [{ ...base, memories_before: [], memories_after }],
    })
    // Código casa com uma memória e GTIN com outra: vale a gravada por último.
    expect(describeMemories(duas([
      { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm1', version: '2026-10-29T10:00:00' },
      { kind: 'uso_despesa', non_catalog_kind: 'uso_despesa', mapping_id: 'm2', version: '2026-10-20T10:00:00' },
    ]))[0]).toContain('a próxima nota sugere revenda sem cadastro.')
    expect(describeMemories(duas([
      { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm1', version: '2026-10-20T10:00:00' },
      { kind: 'uso_despesa', non_catalog_kind: 'uso_despesa', mapping_id: 'm2', version: '2026-10-29T10:00:00' },
    ]))[0]).toContain('a próxima nota sugere uso ou despesa.')
    // Produto contra fora do cadastro: a mais recente vence; empate fica com a de fora.
    expect(describeMemories(duas([
      { kind: 'insumo', mapping_id: 'm3', product_name: 'Margarina', conversion_factor: 30, version: '2026-10-29T10:00:00' },
      { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm4', version: '2026-10-20T10:00:00' },
    ]))[0]).toContain('a próxima nota sugere Margarina com fator 30')
    expect(describeMemories(duas([
      { kind: 'insumo', mapping_id: 'm3', product_name: 'Margarina', conversion_factor: 30, version: '2026-10-20T10:00:00' },
      { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm4', version: '2026-10-20T10:00:00' },
    ]))[0]).toContain('a próxima nota sugere revenda sem cadastro.')
  })

  it('diz todos os tipos de memória que serão desligados', () => {
    const base = impactJson.items[0]
    const impact = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: ['m1', 'm2'],
      items: [{
        ...base,
        memories_before: [
          { kind: 'uso_despesa', non_catalog_kind: 'uso_despesa', mapping_id: 'm1' },
          { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm2' },
        ],
        memories_after: [],
      }],
    })
    expect(describeMemories(impact)[0]).toContain('as memórias de uso ou despesa e de revenda sem cadastro deste item serão desligadas; ')
  })

  it('deixa marcar item de uso ou despesa e só pede a mesma unidade quando o destino é produto', () => {
    expect(itemBlockReason({ status: 'paga', mapping_status: 'nao_aplicavel' })).toBe('')
    const cx = { source_unit: 'CX', status: 'aberta', mapping_status: 'mapeado' }
    expect(selectionBlockReason([cx, { ...cx, source_unit: 'UN' }], { sameUnit: false })).toBe('')
    expect(selectionBlockReason([cx, { ...cx, source_unit: 'UN' }])).toContain('unidades diferentes')
  })

  it('busca por fornecedor, descrição ou nota, sem ligar para acento e caixa', () => {
    const item = { supplier_name: 'Susival Indústria', source_description: 'PANO MULTIUSO ROLÃO', invoice_number: '16837' }
    expect(matchesNonCatalogSearch(item, 'rolao')).toBe(true)
    expect(matchesNonCatalogSearch(item, 'industria')).toBe(true)
    expect(matchesNonCatalogSearch(item, '1683')).toBe(true)
    expect(matchesNonCatalogSearch(item, 'margarina')).toBe(false)
    expect(matchesNonCatalogSearch(item, '  ')).toBe(true)
    expect(purchaseStatusLabel('paga')).toBe('conta paga')
    expect(purchaseStatusLabel('aberta')).toBe('conta em aberto')
  })
})

// Revenda sem cadastro, fase 3: o efeito ganha o tipo do item, o que acontece
// com cada memória e a próxima sugestão, calculados pelo banco.
const resaleSplit = [{ key: 'cmv_revenda', label: 'CMV de revenda', group: 'cmv', amount: 50 }]
const expenseSplit = [{ key: 'outras_despesas', label: 'Outras despesas', group: 'outras', amount: 50 }]
const rawMaterialSplit = [{ key: 'cmv_materia_prima', label: 'CMV de matéria-prima', group: 'cmv', amount: 50 }]

const outside = (kind: string) => ({ mapping_status: 'nao_aplicavel', non_catalog_kind: kind, product_id: null, product_name: null, conversion_factor: null, usable_quantity: null, normalized_unit_cost: null, cost_applied: null })
const onProduct = { mapping_status: 'mapeado', non_catalog_kind: null, product_id: 'whey', product_name: 'Whey', product_unit: 'un', conversion_factor: 1, usable_quantity: 2, normalized_unit_cost: 100, cost_applied: true }

function phase3Item(itemId: string, before: object, after: object, extra: object = {}) {
  return {
    item_id: itemId, purchase_id: 'p9', supplier_name: 'Giants', nfe_number: '5158', issue_date: '2026-10-20',
    source_description: 'WHEY PROTEIN 900G', source_unit: 'UN', quantity: 2, item_value: 200,
    before, after, memories_before: [], memories_after: [], next_suggestion: null,
    ...extra,
  }
}

function phase3Impact(items: object[], split: object[], memoryChanges: object[] = [], action = 'corrigir') {
  return parseItemCorrectionImpact({
    action,
    items,
    products: [],
    decisions: [],
    memories_off: [],
    memory_changes: memoryChanges,
    purchases: [{
      purchase_id: 'p9', status: 'aberta', total_value: 200, competence_month: '2026-10-01',
      installments: 1, installments_paid: 0, paid_total: 0, late_fees: 0, last_paid_date: null,
      split, ledger: [],
    }],
    consumption: { closed_periods: 2, items: [], periods: [] },
  })
}

describe('revenda sem cadastro na correção de notas (fase 3)', () => {
  beforeEach(() => { rpc.mockReset() })

  it('lê o tipo do item e da memória; foto antiga fora do cadastro é uso ou despesa', () => {
    const impact = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'))], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'trocar_tipo', reason: null,
      before: { active: true, non_catalog_kind: 'uso_despesa', version: '2026-10-20T10:00:00' },
      after: { active: true, non_catalog_kind: 'revenda' }, newer_at: null,
    }])
    expect(impact.items[0].before.non_catalog_kind).toBe('uso_despesa')
    expect(impact.items[0].after.non_catalog_kind).toBe('revenda')
    expect(impact.memory_changes?.[0]).toMatchObject({ mapping_id: 'm1', action: 'trocar_tipo', after: { active: true, non_catalog_kind: 'revenda' } })

    const antiga = parseItemCorrectionImpact(impactJson)
    expect(antiga.items[0].before.non_catalog_kind).toBe('uso_despesa')
    expect(antiga.items[0].after.non_catalog_kind).toBeNull()
    expect(antiga.memory_changes).toBeNull()
    expect(antiga.items[0].next_suggestion).toBeNull()
    expect(antiga.consumption?.periods[0].before.resale).toBeNull()
  })

  it('diz revenda sem cadastro dos dois lados, sem chamar de uso ou despesa', () => {
    const impact = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'))], resaleSplit)
    expect(describeItemImpact(impact.items[0])).toContain('uso ou despesa (fora da receita, do estoque e do custo) → revenda sem cadastro (sem produto: fora do estoque, do custo de cadastro e do CMV %; o valor da compra continua o mesmo).')
    const fromProduct = phase3Impact([phase3Item('i1', onProduct, outside('revenda'))], resaleSplit)
    expect(describeItemImpact(fromProduct.items[0])).toContain('Whey, fator 1, 2 un')
    expect(describeItemImpact(fromProduct.items[0])).toContain('→ revenda sem cadastro')
    expect(itemSide(fromProduct.items[0].after)).toBe('revenda')
    expect(itemSide(fromProduct.items[0].before)).toBe('produto')
  })

  it('produto que vira revenda numa conta de CMV de revenda não ganha o aviso de despesa', () => {
    const impact = phase3Impact([phase3Item('i1', onProduct, outside('revenda'))], resaleSplit)
    const line = describePurchaseFinance(impact.purchases[0], impact)
    expect(line).not.toContain('Atenção')
    expect(line).not.toContain('a conta inteira está em custo de mercadoria')
    expect(line).not.toContain('dividida')
  })

  it('revenda numa conta de despesa avisa que revenda costuma ir para CMV de revenda', () => {
    const impact = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'))], expenseSplit)
    expect(describePurchaseFinance(impact.purchases[0], impact)).toContain('revenda costuma ficar em CMV de revenda')
    const rawMaterial = phase3Impact([phase3Item('i1', onProduct, outside('revenda'))], rawMaterialSplit)
    expect(describePurchaseFinance(rawMaterial.purchases[0], rawMaterial)).toContain('mas não em CMV de revenda')
  })

  it('revenda que vira uso ou despesa numa conta toda em CMV avisa como despesa', () => {
    const impact = phase3Impact([phase3Item('i1', outside('revenda'), outside('uso_despesa'))], resaleSplit)
    expect(describePurchaseFinance(impact.purchases[0], impact)).toContain('a conta inteira está em custo de mercadoria (CMV)')
  })

  it('nota mista: cada destino ganha o aviso que se aplica, e a conta dividida pede conferência', () => {
    const items = [
      phase3Item('i1', outside('uso_despesa'), outside('revenda')),
      { ...phase3Item('i2', outside('revenda'), outside('uso_despesa')), source_description: 'PAPEL TOALHA' },
    ]
    const despesa = phase3Impact(items, expenseSplit)
    const despesaLine = describePurchaseFinance(despesa.purchases[0], despesa)
    expect(despesaLine).toContain('revenda costuma ficar em CMV de revenda')
    expect(despesaLine).not.toContain('a conta inteira está em custo de mercadoria')
    const revenda = phase3Impact(items, resaleSplit)
    const revendaLine = describePurchaseFinance(revenda.purchases[0], revenda)
    expect(revendaLine).toContain('a conta inteira está em custo de mercadoria (CMV)')
    expect(revendaLine).not.toContain('revenda costuma ficar')
    const dividida = phase3Impact([phase3Item('i1', onProduct, outside('uso_despesa'))], [...resaleSplit, ...expenseSplit])
    expect(describePurchaseFinance(dividida.purchases[0], dividida)).toContain('dividida entre custo de mercadoria (CMV) e outras categorias')
    // Item que não muda de lado (produto -> produto) não gera aviso.
    const fator = phase3Impact([phase3Item('i1', onProduct, { ...onProduct, conversion_factor: 2 })], expenseSplit)
    expect(describePurchaseFinance(fator.purchases[0], fator)).not.toContain('Atenção')
  })

  it('mostra a parte de revenda sem cadastro nos totais da semana', () => {
    const consumption = parseItemCorrectionImpact({
      ...impactJson,
      consumption: {
        closed_periods: 2,
        items: [],
        periods: [{
          period_end_count_id: 'c2', start_date: '2026-10-17', end_date: '2026-10-24',
          before: { counted: 0, outside: 0, not_stock: 250, resale: 50, unclassified: 0 },
          after: { counted: 0, outside: 0, not_stock: 250, resale: 250, unclassified: 0 },
        }],
      },
    }).consumption
    expect(describeConsumption(consumption)).toEqual([
      expect.stringMatching(/não é estoque R\$\s250,00 → R\$\s250,00, dos quais revenda sem cadastro R\$\s50,00 → R\$\s250,00 \(fora do CMV %\)\.$/),
    ])
  })

  it('diz qual memória é atingida e o que a próxima nota sugere, com a regra de conflito', () => {
    const memory = { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm1', product_name: null, conversion_factor: null }
    const trocar = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'), { next_suggestion: memory })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'trocar_tipo', reason: null,
      before: { active: true, non_catalog_kind: 'uso_despesa' }, after: { active: true, non_catalog_kind: 'revenda' }, newer_at: null,
    }])
    expect(describeMemories(trocar)).toEqual([
      'WHEY PROTEIN 900G (Giants): a memória deste item passa de uso ou despesa para revenda sem cadastro; a próxima nota sugere revenda sem cadastro.',
    ])
    const posterior = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'), { next_suggestion: { ...memory, non_catalog_kind: 'uso_despesa' } })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'manter', reason: 'decisao_posterior',
      before: { active: true, non_catalog_kind: 'uso_despesa' }, after: null, newer_at: '2026-11-01T14:00:00',
    }])
    expect(describeMemories(posterior)[0]).toContain('a memória deste item foi decidida depois desta nota, em 01/11/2026, e fica como está: corrigir esta nota não muda a sugestão das próximas; a próxima nota sugere uso ou despesa.')
    const desligar = phase3Impact([phase3Item('i1', outside('revenda'), onProduct)], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'desligar', reason: null,
      before: { active: true, non_catalog_kind: 'revenda' }, after: { active: false, non_catalog_kind: 'revenda' }, newer_at: null,
    }])
    expect(describeMemories(desligar)[0]).toBe('WHEY PROTEIN 900G (Giants): a memória de revenda sem cadastro deste item será desligada; a próxima nota chega sem sugestão e quem importa escolhe.')
    const jaCerta = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'), { next_suggestion: memory })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'manter', reason: 'ja_certa',
      before: { active: true, non_catalog_kind: 'revenda' }, after: null, newer_at: null,
    }])
    expect(describeMemories(jaCerta)[0]).toContain('a memória deste item já sugere revenda sem cadastro; ')
    const semData = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'), { next_suggestion: { ...memory, non_catalog_kind: 'uso_despesa' } })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'manter', reason: 'data_desconhecida',
      before: { active: true, non_catalog_kind: 'uso_despesa' }, after: null, newer_at: null,
    }])
    expect(describeMemories(semData)[0]).toContain('esta nota não tem a data da decisão para comparar com a memória deste item, então a memória fica como está')
    const incerta = phase3Impact([phase3Item('i1', outside('uso_despesa'), outside('revenda'), { next_suggestion: { ...memory, non_catalog_kind: 'uso_despesa' } })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'manter', reason: 'ordem_incerta',
      before: { active: true, non_catalog_kind: 'uso_despesa' }, after: null, newer_at: null,
    }])
    expect(describeMemories(incerta)[0]).toContain('a memória deste item foi mexida quase ao mesmo tempo que esta nota e não dá para saber qual decisão veio depois, então a memória fica como está')
  })

  it('no desfazer, diz se a memória volta ou fica com a escolha mais nova; correção antiga não religa', () => {
    const memory = { kind: 'uso_despesa', non_catalog_kind: 'revenda', mapping_id: 'm1', product_name: null, conversion_factor: null }
    const volta = phase3Impact([phase3Item('i1', onProduct, outside('revenda'), { next_suggestion: memory })], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'restaurar', reason: null,
      before: { active: false, non_catalog_kind: 'revenda' }, after: { active: true, non_catalog_kind: 'revenda' }, newer_at: null,
    }], 'desfazer')
    const voltaLines = describeMemories(volta)
    expect(voltaLines[0]).toContain('a memória deste item volta a revenda sem cadastro, como era antes da correção')
    expect(voltaLines.join(' ')).not.toContain('Desfazer não religa')
    const mudou = phase3Impact([phase3Item('i1', outside('revenda'), outside('uso_despesa'))], resaleSplit, [{
      mapping_id: 'm1', item_ids: ['i1'], action: 'manter', reason: 'mudou_depois',
      before: { active: true, non_catalog_kind: 'uso_despesa' }, after: null, newer_at: '2026-11-02T12:00:00',
    }], 'desfazer')
    expect(describeMemories(mudou)[0]).toContain('a memória deste item mudou depois da correção e fica com a escolha mais nova')
    const antiga = phase3Impact([phase3Item('i1', outside('uso_despesa'), onProduct)], resaleSplit, [{
      mapping_id: 'm1', item_ids: [], action: 'manter', reason: 'correcao_antiga', before: null, after: null, newer_at: null,
    }], 'desfazer')
    expect(describeMemories(antiga).at(-1)).toBe('Desfazer não religa a memória que esta correção antiga desligou: a próxima nota pergunta de novo.')
  })

  it('quando a memória de insumo vence, diz o tipo certo e onde desligá-la', () => {
    const product = { kind: 'insumo', mapping_id: 'm2', product_name: 'Whey', conversion_factor: 1 }
    const impact = phase3Impact([phase3Item('i1', onProduct, outside('revenda'), { next_suggestion: product })], resaleSplit, [])
    expect(describeMemories(impact)[0]).toContain('a próxima nota sugere Whey com fator 1; para ela vir como revenda sem cadastro, desligue essa memória em Memórias de vínculo, na página do produto')
    // Correção antiga, sem a próxima sugestão do banco: a frase também diz o tipo do item.
    const antiga = parseItemCorrectionImpact({
      ...impactJson,
      memories_off: [],
      items: [{
        ...impactJson.items[0], before: impactJson.items[0].after, after: { ...impactJson.items[0].before, non_catalog_kind: 'revenda' },
        memories_before: [product], memories_after: [product],
      }],
    })
    expect(describeMemories(antiga)[0]).toContain('para ela vir como revenda sem cadastro, desligue essa memória')
  })

  it('separa a lista por tipo e só troca o tipo de itens de um tipo só', () => {
    const uso = { id: 'a', non_catalog_kind: 'uso_despesa' as const }
    const revenda = { id: 'b', non_catalog_kind: 'revenda' as const }
    expect(groupByNonCatalogKind([uso, revenda, uso])).toEqual({ uso_despesa: [uso, uso], revenda: [revenda] })
    expect(kindSwapTarget([uso, uso])).toEqual({ target: 'revenda', reason: '' })
    expect(kindSwapTarget([revenda])).toEqual({ target: 'uso_despesa', reason: '' })
    expect(kindSwapTarget([uso, revenda])).toEqual({ target: null, reason: MIXED_KINDS_REASON })
    expect(kindSwapTarget([]).target).toBeNull()
  })

  it('manda o tipo no pedido e recusa a prévia de revenda vinda do banco anterior', async () => {
    const target = { items: [{ itemId: 'i1', productId: null, conversionFactor: null, nonCatalogKind: 'revenda' as const }] }
    expect(requestsResale(target)).toBe(true)
    expect(requestsResale({ items: [{ itemId: 'i1', productId: null, conversionFactor: null }] })).toBe(false)
    expect(requestsResale({ undoCorrectionId: 'c1' })).toBe(false)

    const oldImpact = { ...impactJson }
    rpc.mockResolvedValueOnce({ data: { mode: 'previa', impact: oldImpact, impact_hash: 'h' }, error: null })
    await expect(previewItemCorrection(target)).rejects.toThrow(RESALE_CORRECTION_NOT_READY)
    expect(rpc).toHaveBeenCalledWith('correct_payable_purchase_items', expect.objectContaining({
      p_items: [{ item_id: 'i1', product_id: null, conversion_factor: null, non_catalog_kind: 'revenda' }],
    }))

    rpc.mockResolvedValueOnce({ data: { mode: 'previa', impact: { ...impactJson, memory_changes: [] }, impact_hash: 'h' }, error: null })
    await expect(previewItemCorrection(target)).resolves.toMatchObject({ impactHash: 'h' })

    // Uso ou despesa e produto seguem com o banco anterior; o produto vai sem tipo.
    rpc.mockResolvedValueOnce({ data: { mode: 'previa', impact: oldImpact, impact_hash: 'h' }, error: null })
    await previewItemCorrection({ items: [{ itemId: 'i1', productId: 'p1', conversionFactor: 30 }] })
    expect(rpc).toHaveBeenLastCalledWith('correct_payable_purchase_items', expect.objectContaining({
      p_items: [{ item_id: 'i1', product_id: 'p1', conversion_factor: 30, non_catalog_kind: null }],
    }))
    expect(parseItemCorrectionResult({ mode: 'previa', impact: oldImpact, impact_hash: 'h' }).impact.memory_changes).toBeNull()
  })
})
