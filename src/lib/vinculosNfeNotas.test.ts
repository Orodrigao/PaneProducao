import { describe, expect, it } from 'vitest'
import { canReceiveInvoiceItem, describeItemImpact, describeProductImpact, itemBlockReason, parseItemCorrectionImpact, parseItemCorrectionResult, selectionBlockReason } from '@/lib/vinculosNfeNotas'

// Efeito no formato que public.correct_payable_purchase_items devolve
// (números do Postgres chegam como número JSON, inclusive com casas fixas).
const impactJson = {
  action: 'corrigir',
  items: [{
    item_id: 'i1', purchase_id: 'p2', supplier_name: 'Bersaglio', nfe_number: '123', issue_date: '2026-09-22',
    source_description: 'MAIONESE SALADA BALDE 3KG', source_unit: 'UN', quantity: 4.0, item_value: 152.0,
    before: { product_id: 'goiabada', product_name: 'GOIABADA INSUMO', product_unit: 'KG', conversion_factor: 7.0, usable_quantity: 28.0, normalized_unit_cost: 5.427143, cost_applied: true },
    after: { product_id: 'maionese', product_name: 'MAIONESE BAG', product_unit: 'KG', conversion_factor: 3.0, usable_quantity: 12.0, normalized_unit_cost: 12.666667, cost_applied: true },
  }],
  products: [
    { product_id: 'goiabada', name: 'GOIABADA INSUMO', unit: 'KG', active: true, cost_before: 5.43, cost_after: 12.86 },
    { product_id: 'maionese', name: 'MAIONESE BAG', unit: 'KG', active: true, cost_before: 17.1, cost_after: 12.67 },
  ],
  decisions: [
    { product_id: 'maionese', kind: 'destino', purchase_id: 'p2', cost_from_this_note: true },
    { product_id: 'goiabada', kind: 'origem_recalculada', purchase_id: 'p1', cost_from_this_note: true },
  ],
}

describe('correção de itens de notas gravadas', () => {
  it('lê o efeito devolvido pelo banco sem perder números', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    expect(impact.items[0].after.usable_quantity).toBe(12)
    expect(impact.items[0].before.conversion_factor).toBe(7)
    expect(impact.products[0].cost_after).toBe(12.86)
    expect(parseItemCorrectionImpact({ products: [{ product_id: 'x', cost_before: null, cost_after: '3.50' }] }).products[0])
      .toMatchObject({ cost_before: null, cost_after: 3.5, name: 'Produto sem nome' })
  })

  it('recusa resposta sem o hash do efeito, que a confirmação precisa', () => {
    expect(() => parseItemCorrectionResult({ mode: 'previa', impact: impactJson })).toThrow('não devolveu o efeito')
    expect(parseItemCorrectionResult({ mode: 'aplicar', impact: impactJson, impact_hash: 'abc', correction_id: 'c1', replayed: true }))
      .toMatchObject({ mode: 'aplicar', impactHash: 'abc', correctionId: 'c1', replayed: true })
  })

  it('descreve cada item de onde sai e para onde vai, com fator, quantidade e custo', () => {
    const line = describeItemImpact(parseItemCorrectionImpact(impactJson).items[0])
    expect(line).toContain('NF 123 de 22/09/2026')
    expect(line).toContain('MAIONESE SALADA BALDE 3KG (4 UN)')
    expect(line).toContain('GOIABADA INSUMO, fator 7, 28 KG')
    expect(line).toContain('→ MAIONESE BAG, fator 3, 12 KG')
    expect(line).toContain('12,6667 por KG')
  })

  it('explica o custo de cada produto pela regra da nota mais recente', () => {
    const impact = parseItemCorrectionImpact(impactJson)
    expect(describeProductImpact(impact.products[0], impact)).toMatch(/^Custo de GOIABADA INSUMO: R\$\s5,43 → R\$\s12,86: o item que saiu era o que dava o custo; vale agora a nota mais recente que sobrou\.$/)
    expect(describeProductImpact(impact.products[1], impact)).toContain('a nota corrigida é a mais recente deste produto')

    const semNota = parseItemCorrectionImpact({ ...impactJson, decisions: [{ product_id: 'goiabada', kind: 'origem_sem_nota', purchase_id: null }] })
    expect(describeProductImpact({ ...semNota.products[0], cost_after: 5.43 }, semNota)).toMatch(/continua R\$\s5,43: não sobrou outra nota/)

    const naoEraFonte = parseItemCorrectionImpact({ ...impactJson, decisions: [] })
    expect(describeProductImpact({ ...naoEraFonte.products[0], cost_after: 5.43 }, naoEraFonte)).toContain('o item que saiu não era o que dava o custo')

    const notaMaisNova = parseItemCorrectionImpact({ ...impactJson, decisions: [{ product_id: 'maionese', kind: 'destino', purchase_id: 'p2', cost_from_this_note: false }] })
    expect(describeProductImpact({ ...notaMaisNova.products[1], cost_after: 17.1 }, notaMaisNova)).toContain('há nota mais recente deste produto')
  })

  it('só deixa marcar item ligado a produto e de conta não cancelada', () => {
    expect(itemBlockReason({ status: 'aberta', mapping_status: 'mapeado' })).toBe('')
    expect(itemBlockReason({ status: 'cancelada', mapping_status: 'mapeado' })).toContain('cancelada')
    expect(itemBlockReason({ status: 'paga', mapping_status: 'pendente' })).toContain('Contas a pagar')
  })

  it('pede um grupo com a mesma unidade da nota, porque o fator vale por unidade', () => {
    const kg = { source_unit: 'KG', status: 'aberta', mapping_status: 'mapeado' }
    expect(selectionBlockReason([])).toContain('Marque')
    expect(selectionBlockReason([kg, { ...kg, source_unit: 'kg ' }])).toBe('')
    expect(selectionBlockReason([kg, { ...kg, source_unit: 'UN' }])).toContain('unidades diferentes')
    expect(selectionBlockReason([kg, { ...kg, status: 'cancelada' }])).toContain('não pode ser corrigido')
    expect(selectionBlockReason(Array.from({ length: 101 }, () => kg))).toContain('no máximo 100')
  })

  it('oferece como destino só produto ativo de compra', () => {
    expect(canReceiveInvoiceItem({ active: true, kind: 'insumo', is_fabricacao_propria: false })).toBe(true)
    expect(canReceiveInvoiceItem({ active: true, kind: 'final', is_fabricacao_propria: false })).toBe(true)
    expect(canReceiveInvoiceItem({ active: true, kind: 'final', is_fabricacao_propria: true })).toBe(false)
    expect(canReceiveInvoiceItem({ active: true, kind: 'kit' })).toBe(false)
    expect(canReceiveInvoiceItem({ active: false, kind: 'insumo' })).toBe(false)
    expect(canReceiveInvoiceItem({ active: true, kind: null })).toBe(false)
  })
})
