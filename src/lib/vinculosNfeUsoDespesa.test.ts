import { describe, expect, it } from 'vitest'
import { describeItemImpact, itemBlockReason, parseItemCorrectionImpact, selectionBlockReason } from '@/lib/vinculosNfeNotas'
import { describeConsumption, describeMemories, describePurchaseFinance, matchesNonCatalogSearch, purchaseStatusLabel } from '@/lib/vinculosNfeUsoDespesa'

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
