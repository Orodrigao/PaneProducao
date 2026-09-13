import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocateItemCosts, composeNfe, compositionBlockReason, compositionCloses } from '@/lib/nfeComposition'
import type { NfeItemDraft, NfeItemFiscal, NfeTotals } from '@/lib/nfeXml'

const fixtureDirectory = join(process.cwd(), 'test', 'fixtures', 'nfe')

// O leitor do produto usa o DOMParser do navegador, que não existe no Vitest.
// Este leitor mínimo alimenta a composição a partir das mesmas fixtures que a
// evidência da fase 0 sela por hash; a leitura real é provada no navegador.
function tag(xml: string, name: string): string | null {
  return xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1] ?? null
}

function number(xml: string, name: string): number {
  return Number(tag(xml, name) ?? 0)
}

function optional(xml: string, name: string): number | null {
  const value = tag(xml, name)
  return value === null ? null : Number(value)
}

function fiscal(overrides: Partial<NfeItemFiscal> = {}): NfeItemFiscal {
  return {
    discount: 0,
    freight: 0,
    insurance: 0,
    otherExpenses: 0,
    importTax: 0,
    icmsSt: 0,
    fcpSt: 0,
    ipi: 0,
    ipiReturned: 0,
    icmsExempt: 0,
    deductsExemption: null,
    composesTotal: null,
    ...overrides,
  }
}

function item(lineNumber: number, grossLineTotal: number, overrides: Partial<NfeItemFiscal> = {}): NfeItemDraft {
  return {
    lineNumber,
    supplierCode: null,
    ean: null,
    description: `ITEM ${lineNumber}`,
    ncm: null,
    quantity: 1,
    purchaseUnit: 'UN',
    taxQuantity: null,
    taxUnit: null,
    unitPrice: grossLineTotal,
    grossLineTotal,
    discountValue: overrides.discount ?? 0,
    lineTotal: grossLineTotal - (overrides.discount ?? 0),
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionBasis: 'simple',
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
    rememberConversion: true,
    factorConfirmed: false,
    recognized: false,
    fiscal: fiscal(overrides),
  }
}

function totals(overrides: Partial<NfeTotals> = {}): NfeTotals {
  return {
    products: 100,
    discounts: 0,
    icmsSt: 0,
    fcpSt: 0,
    ipi: 0,
    ipiReturned: 0,
    freight: 0,
    insurance: 0,
    otherExpenses: 0,
    importTax: 0,
    icmsExempt: 0,
    services: 0,
    total: 100,
    ...overrides,
  }
}

function readFixture(name: string): { items: NfeItemDraft[]; totals: NfeTotals } {
  const xml = readFileSync(join(fixtureDirectory, name), 'utf8')
  const totalBlock = xml.match(/<ICMSTot>[\s\S]*?<\/ICMSTot>/)?.[0] ?? ''
  const items = [...xml.matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)].map(match => {
    const body = match[2]
    const indicator = (name: string): '0' | '1' | null => {
      const value = tag(body, name)
      return value === '0' || value === '1' ? value : null
    }
    return item(Number(match[1]), number(body, 'vProd'), {
      discount: number(body, 'vDesc'),
      freight: number(body, 'vFrete'),
      insurance: number(body, 'vSeg'),
      otherExpenses: number(body, 'vOutro'),
      importTax: number(body, 'vII'),
      icmsSt: number(body, 'vICMSST'),
      fcpSt: number(body, 'vFCPST'),
      ipi: number(body, 'vIPI'),
      ipiReturned: number(body, 'vIPIDevol'),
      icmsExempt: number(body, 'vICMSDeson'),
      deductsExemption: indicator('indDeduzDeson'),
      composesTotal: indicator('indTot'),
    })
  })
  return {
    items,
    totals: {
      products: optional(totalBlock, 'vProd'),
      discounts: optional(totalBlock, 'vDesc'),
      icmsSt: optional(totalBlock, 'vST'),
      fcpSt: optional(totalBlock, 'vFCPST'),
      ipi: optional(totalBlock, 'vIPI'),
      ipiReturned: optional(totalBlock, 'vIPIDevol'),
      freight: optional(totalBlock, 'vFrete'),
      insurance: optional(totalBlock, 'vSeg'),
      otherExpenses: optional(totalBlock, 'vOutro'),
      importTax: optional(totalBlock, 'vII'),
      icmsExempt: optional(totalBlock, 'vICMSDeson'),
      services: 0,
      total: optional(totalBlock, 'vNF'),
    },
  }
}

describe('composição das fixtures comprovadas na fase 0', () => {
  it('sem acréscimos: fecha, sem acréscimo e sem bloqueio', () => {
    const composition = composeNfe(readFixture('sem-acrescimos.xml'))
    expect(composition).toMatchObject({ products: 100, discounts: 0, surcharges: [], expectedTotal: 100, total: 100, unexplained: 0, blockers: [] })
    expect(compositionCloses(composition)).toBe(true)
    expect(compositionBlockReason(composition)).toBeNull()
  })

  it('desconto por item: o desconto abate e a nota fecha', () => {
    const composition = composeNfe(readFixture('desconto-por-item.xml'))
    expect(composition).toMatchObject({ products: 100, discounts: 5, surcharges: [], expectedTotal: 95, total: 95, unexplained: 0, blockers: [] })
    expect(compositionBlockReason(composition)).toBeNull()
  })

  it('frete atribuído ao item: aparece como acréscimo e fecha', () => {
    const composition = composeNfe(readFixture('frete-por-item.xml'))
    expect(composition.surcharges).toEqual([{ key: 'freight', label: 'Frete', amount: 4 }])
    expect(composition).toMatchObject({ expectedTotal: 104, total: 104, unexplained: 0, blockers: [] })
    // Fase 3A: acréscimo comprovado e explicado entra pelo XML.
    expect(compositionBlockReason(composition)).toBeNull()
  })

  it('ST com desoneração não dedutível: a desoneração não abate o total', () => {
    const composition = composeNfe(readFixture('st-desoneracao-nao-deduz.xml'))
    expect(composition.surcharges).toEqual([{ key: 'icmsSt', label: 'ICMS substituição tributária', amount: 2 }])
    expect(composition).toMatchObject({ exemptionDeducted: 0, expectedTotal: 122, total: 122, unexplained: 0, blockers: [] })
  })

  it('ST com IPI e outras despesas: cada acréscimo com seu nome, na ordem da nota', () => {
    const composition = composeNfe(readFixture('st-ipi-outras-despesas.xml'))
    expect(composition.surcharges).toEqual([
      { key: 'icmsSt', label: 'ICMS substituição tributária', amount: 3 },
      { key: 'ipi', label: 'IPI', amount: 2 },
      { key: 'otherExpenses', label: 'Outras despesas', amount: 1.5 },
    ])
    expect(composition).toMatchObject({ surchargesTotal: 6.5, expectedTotal: 126.5, total: 126.5, unexplained: 0, blockers: [] })
    expect(compositionBlockReason(composition)).toBeNull()
  })
})

describe('quando a nota não fecha', () => {
  it('mostra o valor não explicado e não o distribui', () => {
    const composition = composeNfe({ items: [item(1, 60), item(2, 40)], totals: totals({ total: 101.23 }) })
    expect(composition.unexplained).toBe(1.23)
    expect(composition.blockers).toEqual([])
    expect(compositionCloses(composition)).toBe(false)
    expect(compositionBlockReason(composition)).toBe(
      'R$ 1,23 da nota ficaram sem explicação. Confira o arquivo com o fornecedor; se o XML estiver correto, a leitura do ERP está falhando e a equipe técnica precisa investigar.',
    )
  })

  it('aponta resíduo negativo quando a nota declara menos do que a composição soma', () => {
    const composition = composeNfe({ items: [item(1, 60), item(2, 40)], totals: totals({ total: 99.99 }) })
    expect(composition.unexplained).toBe(-0.01)
    expect(compositionBlockReason(composition)).toContain('R$ 0,01 da nota ficaram sem explicação')
  })

  it('soma em centavos para não inventar resíduo de ponto flutuante', () => {
    const composition = composeNfe({
      items: [item(1, 0.1), item(2, 0.2)],
      totals: totals({ products: 0.3, total: 0.3 }),
    })
    expect(composition.unexplained).toBe(0)
    expect(compositionCloses(composition)).toBe(true)
  })
})

describe('divergência entre itens e total', () => {
  it('bloqueia quando os produtos dos itens não somam o total de produtos', () => {
    const composition = composeNfe({ items: [item(1, 60), item(2, 40)], totals: totals({ products: 110, total: 110 }) })
    expect(composition.blockers).toEqual(['Os itens somam R$ 100,00 em produtos, mas o total da nota informa R$ 110,00.'])
    expect(compositionBlockReason(composition)).toContain('ainda não sabe conferir')
  })

  it('bloqueia quando o desconto dos itens não soma o desconto do total', () => {
    const composition = composeNfe({
      items: [item(1, 60, { discount: 3 }), item(2, 40)],
      totals: totals({ discounts: 5, total: 95 }),
    })
    expect(composition.blockers).toEqual(['Os itens somam R$ 3,00 de desconto, mas o total da nota informa R$ 5,00.'])
  })

  it('bloqueia acréscimo só no total: a SEFAZ não autoriza total diferente da soma dos itens, então não há despesa comum a ratear', () => {
    const composition = composeNfe({ items: [item(1, 60), item(2, 40)], totals: totals({ freight: 4, total: 104 }) })
    expect(composition.blockers).toEqual(['Os itens somam R$ 0,00 de frete, mas o total da nota informa R$ 4,00.'])
    expect(allocateItemCosts({ items: [item(1, 60), item(2, 40)], totals: totals({ freight: 4, total: 104 }) })).toBeNull()
  })

  it('aceita a tolerância de um centavo da SEFAZ entre o total e a soma dos itens, nos dois sentidos', () => {
    expect(composeNfe({ items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ freight: 4.01, total: 104.01 }) }).blockers).toEqual([])
    expect(composeNfe({ items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ freight: 3.99, total: 103.99 }) }).blockers).toEqual([])
    expect(composeNfe({ items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ freight: 4.02, total: 104.02 }) }).blockers)
      .toEqual(['Os itens somam R$ 4,00 de frete, mas o total da nota informa R$ 4,02.'])
  })

  it('bloqueia acréscimo só no item, porque o total é o somatório dos itens', () => {
    const composition = composeNfe({ items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ total: 100 }) })
    expect(composition.blockers).toEqual(['Os itens somam R$ 4,00 de frete, mas o total da nota informa R$ 0,00.'])
  })

  it('aceita acréscimo igual no item e no total sem somar duas vezes', () => {
    const composition = composeNfe({ items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ freight: 4, total: 104 }) })
    expect(composition.blockers).toEqual([])
    expect(composition.expectedTotal).toBe(104)
  })

  it('bloqueia arquivo sem o bloco de totais completo, listando o que falta', () => {
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ products: null }) }).blockers)
      .toEqual(['O bloco de totais da nota não informa vProd. Uma NF-e autorizada sempre traz esses campos; confira se o arquivo está completo.'])
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ discounts: null, total: null }) }).blockers)
      .toEqual(['O bloco de totais da nota não informa vDesc, vNF. Uma NF-e autorizada sempre traz esses campos; confira se o arquivo está completo.'])
  })

  it('XML mínimo só com vNF, como o dos smoke tests antigos, é recusado com explicação e sem resíduo inventado', () => {
    const composition = composeNfe({
      items: [item(1, 10)],
      totals: { products: null, discounts: null, icmsSt: null, fcpSt: null, ipi: null, ipiReturned: null, freight: null, insurance: null, otherExpenses: null, importTax: null, icmsExempt: null, services: 0, total: 10 },
    })
    expect(composition.blockers).toHaveLength(1)
    expect(composition.blockers[0]).toContain('não informa vProd, vDesc, vST, vFCPST, vIPI, vIPIDevol, vFrete, vSeg, vOutro, vII, vICMSDeson')
    expect(compositionBlockReason(composition)).toContain('ainda não sabe conferir')
  })

  it('valor ilegível no total ou no item bloqueia em vez de virar zero', () => {
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ freight: Number.NaN, total: 100 }) }).blockers)
      .toEqual(['O bloco de totais da nota traz valor ilegível em vFrete.'])
    expect(composeNfe({ items: [item(1, 100, { icmsSt: Number.NaN })], totals: totals() }).blockers)
      .toEqual(['O item 1 traz valor ilegível em vICMSST.'])
    expect(composeNfe({ items: [item(1, 100, { discount: Number.NaN })], totals: totals() }).blockers)
      .toEqual(['O item 1 traz valor ilegível em vDesc.'])
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ services: Number.NaN }) }).blockers)
      .toEqual(['O bloco de serviços da nota traz valor ilegível em vServ.'])
  })

  it('total ilegível ou ausente não gera um segundo aviso dizendo que o total informou zero', () => {
    const unreadable = composeNfe({ items: [item(1, 100, { freight: 4 })], totals: totals({ freight: Number.NaN, total: 104 }) })
    expect(unreadable.blockers).toEqual(['O bloco de totais da nota traz valor ilegível em vFrete.'])
    const absent = composeNfe({ items: [item(1, 100, { icmsExempt: 3, deductsExemption: '0' })], totals: totals({ icmsExempt: null, products: Number.NaN }) })
    expect(absent.blockers).toEqual([
      'O bloco de totais da nota não informa vICMSDeson. Uma NF-e autorizada sempre traz esses campos; confira se o arquivo está completo.',
      'O bloco de totais da nota traz valor ilegível em vProd.',
    ])
  })
})

describe('casos sem regra validada na fase 0 ficam bloqueados', () => {
  it.each([
    ['fcpSt', 'Fundo de combate à pobreza (ST)'],
    ['ipiReturned', 'IPI devolvido'],
    ['insurance', 'Seguro'],
    ['importTax', 'Imposto de importação'],
  ] as const)('%s no total bloqueia mesmo quando a conta fecha', (key, label) => {
    const composition = composeNfe({ items: [item(1, 100, { [key]: 1 })], totals: totals({ [key]: 1, total: 101 }) })
    expect(composition.unexplained).toBe(0)
    expect(composition.blockers).toEqual([`A nota traz ${label} (R$ 1,00), um caso ainda sem evidência real na fase 0.`])
    expect(compositionBlockReason(composition)).toBe('Esta nota traz um caso que o ERP ainda não sabe conferir. Lance esta compra à mão até esse caso ser liberado.')
  })

  it('serviços na nota bloqueiam', () => {
    const composition = composeNfe({ items: [item(1, 100)], totals: totals({ services: 20 }) })
    expect(composition.blockers).toEqual(['A nota traz serviços (R$ 20,00), um caso ainda sem evidência real na fase 0.'])
  })

  it('item fora do total (indTot 0) bloqueia', () => {
    const composition = composeNfe({ items: [item(1, 100, { composesTotal: '0' })], totals: totals() })
    expect(composition.blockers).toEqual(['O item 1 está marcado no XML como fora do total da nota (indTot 0), um caso ainda sem evidência real na fase 0.'])
  })

  it('desoneração com indicador ausente bloqueia em vez de virar 0 ou 1', () => {
    const composition = composeNfe({
      items: [item(1, 100, { icmsExempt: 3, deductsExemption: null })],
      totals: totals({ icmsExempt: 3 }),
    })
    expect(composition.blockers).toEqual(['O item 1 tem ICMS desonerado e o XML não diz se ele abate do total (indDeduzDeson ausente), um caso ainda não esclarecido.'])
  })

  it('desoneração dedutível (indicador 1) abate na conta, mas bloqueia por falta de evidência', () => {
    const composition = composeNfe({
      items: [item(1, 100, { icmsExempt: 3, deductsExemption: '1' })],
      totals: totals({ icmsExempt: 3, total: 97 }),
    })
    expect(composition.exemptionDeducted).toBe(3)
    expect(composition.unexplained).toBe(0)
    expect(composition.blockers).toEqual(['O item 1 tem ICMS desonerado e o XML manda abater do total (indDeduzDeson 1), um caso ainda sem evidência real na fase 0.'])
  })

  it('desoneração no total sem item correspondente é divergência', () => {
    const composition = composeNfe({ items: [item(1, 100)], totals: totals({ icmsExempt: 3 }) })
    expect(composition.blockers).toEqual(['Os itens somam R$ 0,00 de ICMS desonerado, mas o total da nota informa R$ 3,00.'])
  })

  it('bloqueio vale mesmo quando o resíduo é zero: o teste exige a recusa, nunca o ajuste', () => {
    const composition = composeNfe({ items: [item(1, 100, { composesTotal: '0' })], totals: totals() })
    expect(composition.unexplained).toBe(0)
    expect(compositionCloses(composition)).toBe(false)
  })
})

// Fase 3A: o custo de aquisição de cada item é o valor líquido do produto mais
// os impostos não recuperáveis e as despesas atribuídos pelo próprio XML àquele
// item. O total da nota é o somatório dos itens; somá-lo de novo dobraria o
// imposto. A mesma tabela de casos está no pgTAP da função do banco.
function costs(draft: { items: NfeItemDraft[]; totals: NfeTotals }) {
  return allocateItemCosts(draft)?.map(line => ({ line: line.lineNumber, acquisition: line.acquisitionValue, adjustment: line.centAdjustment }))
}

function acquisitionSum(draft: { items: NfeItemDraft[]; totals: NfeTotals }): number | undefined {
  const lines = allocateItemCosts(draft)
  return lines ? lines.reduce((sum, line) => sum + Math.round(line.acquisitionValue * 100), 0) / 100 : undefined
}

describe('custo de aquisição por item (fase 3A)', () => {
  it('ST com IPI e outras despesas: cada item leva só o que o XML atribuiu a ele', () => {
    expect(allocateItemCosts(readFixture('st-ipi-outras-despesas.xml'))).toEqual([
      { lineNumber: 1, netValue: 30, icmsSt: 1.5, ipi: 1, freight: 0, otherExpenses: 0.5, centAdjustment: 0, surchargeTotal: 3, acquisitionValue: 33 },
      { lineNumber: 2, netValue: 40, icmsSt: 1.5, ipi: 1, freight: 0, otherExpenses: 0.5, centAdjustment: 0, surchargeTotal: 3, acquisitionValue: 43 },
      { lineNumber: 3, netValue: 50, icmsSt: 0, ipi: 0, freight: 0, otherExpenses: 0.5, centAdjustment: 0, surchargeTotal: 0.5, acquisitionValue: 50.5 },
    ])
  })

  it('frete atribuído ao item não vaza para o item sem frete', () => {
    expect(costs(readFixture('frete-por-item.xml'))).toEqual([
      { line: 1, acquisition: 64, adjustment: 0 },
      { line: 2, acquisition: 40, adjustment: 0 },
    ])
  })

  it('desconto abate e ST com desoneração não dedutível não reduz o custo', () => {
    expect(acquisitionSum(readFixture('desconto-por-item.xml'))).toBe(95)
    expect(acquisitionSum(readFixture('st-desoneracao-nao-deduz.xml'))).toBe(122)
    expect(acquisitionSum(readFixture('sem-acrescimos.xml'))).toBe(100)
  })

  it('a soma dos custos de todas as fixtures é exatamente o total da nota: nenhum imposto contado duas vezes', () => {
    for (const name of ['sem-acrescimos.xml', 'desconto-por-item.xml', 'frete-por-item.xml', 'st-desoneracao-nao-deduz.xml', 'st-ipi-outras-despesas.xml']) {
      const draft = readFixture(name)
      expect(acquisitionSum(draft), name).toBe(composeNfe(draft).total)
    }
  })

  it('centavo a mais no total vai para o item de maior valor líquido, empate pela menor linha', () => {
    const draft = { items: [item(1, 60, { freight: 2 }), item(2, 60, { freight: 2 })], totals: totals({ products: 120, freight: 4.01, total: 124.01 }) }
    expect(costs(draft)).toEqual([
      { line: 1, acquisition: 62.01, adjustment: 0.01 },
      { line: 2, acquisition: 62, adjustment: 0 },
    ])
    expect(acquisitionSum(draft)).toBe(124.01)
  })

  it('centavo a menos no total sai do maior item que tem aquele acréscimo, nunca deixa acréscimo negativo', () => {
    const draft = { items: [item(1, 100), item(2, 50, { freight: 4 })], totals: totals({ products: 150, freight: 3.99, total: 153.99 }) }
    expect(costs(draft)).toEqual([
      { line: 1, acquisition: 100, adjustment: 0 },
      { line: 2, acquisition: 53.99, adjustment: -0.01 },
    ])
  })

  it('dois campos com um centavo cada podem cair no mesmo item, e isso fica explícito', () => {
    const draft = { items: [item(1, 80, { icmsSt: 1, ipi: 1 }), item(2, 20)], totals: totals({ icmsSt: 1.01, ipi: 1.01, total: 102.02 }) }
    expect(costs(draft)).toEqual([
      { line: 1, acquisition: 82.02, adjustment: 0.02 },
      { line: 2, acquisition: 20, adjustment: 0 },
    ])
  })

  it('a tolerância do centavo não esconde sobra no total da nota', () => {
    const draft = { items: [item(1, 60, { freight: 4 }), item(2, 40)], totals: totals({ freight: 4.01, total: 104 }) }
    expect(composeNfe(draft).unexplained).toBe(-0.01)
    expect(allocateItemCosts(draft)).toBeNull()
  })

  it('nota com caso sem regra validada não recebe custo', () => {
    expect(allocateItemCosts({ items: [item(1, 100, { insurance: 2 })], totals: totals({ insurance: 2, total: 102 }) })).toBeNull()
  })
})
