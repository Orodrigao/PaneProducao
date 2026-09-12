import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeNfe, compositionBlockReason, compositionCloses } from '@/lib/nfeComposition'
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
      discounts: number(totalBlock, 'vDesc'),
      icmsSt: number(totalBlock, 'vST'),
      fcpSt: number(totalBlock, 'vFCPST'),
      ipi: number(totalBlock, 'vIPI'),
      ipiReturned: number(totalBlock, 'vIPIDevol'),
      freight: number(totalBlock, 'vFrete'),
      insurance: number(totalBlock, 'vSeg'),
      otherExpenses: number(totalBlock, 'vOutro'),
      importTax: number(totalBlock, 'vII'),
      icmsExempt: number(totalBlock, 'vICMSDeson'),
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
    expect(compositionBlockReason(composition)).toContain('R$ 4,00 de acréscimos (frete)')
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
    expect(compositionBlockReason(composition)).toBe(
      'A nota tem R$ 6,50 de acréscimos (icms substituição tributária, ipi, outras despesas). O ERP ainda não importa acréscimos pelo XML: lance esta compra à mão, somando o imposto e a despesa como itens.',
    )
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

  it('aceita acréscimo só no total, que é despesa comum a ratear na fase 3', () => {
    const composition = composeNfe({ items: [item(1, 60), item(2, 40)], totals: totals({ freight: 4, total: 104 }) })
    expect(composition.blockers).toEqual([])
    expect(composition.surcharges).toEqual([{ key: 'freight', label: 'Frete', amount: 4 }])
    expect(composition.unexplained).toBe(0)
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

  it('bloqueia quando falta o total de produtos ou o total da nota', () => {
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ products: null }) }).blockers)
      .toEqual(['A nota não informa o total dos produtos (vProd) no bloco de totais.'])
    expect(composeNfe({ items: [item(1, 100)], totals: totals({ total: null }) }).blockers)
      .toEqual(['A nota não informa o valor total (vNF) no bloco de totais.'])
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
    expect(composition.blockers).toEqual(['O item 1 não compõe o total da nota (indTot 0), um caso ainda sem evidência real na fase 0.'])
  })

  it('desoneração com indicador ausente bloqueia em vez de virar 0 ou 1', () => {
    const composition = composeNfe({
      items: [item(1, 100, { icmsExempt: 3, deductsExemption: null })],
      totals: totals({ icmsExempt: 3 }),
    })
    expect(composition.blockers).toEqual(['O item 1 tem ICMS desonerado sem o indicador de dedução (indDeduzDeson), um caso ainda não esclarecido.'])
  })

  it('desoneração dedutível (indicador 1) abate na conta, mas bloqueia por falta de evidência', () => {
    const composition = composeNfe({
      items: [item(1, 100, { icmsExempt: 3, deductsExemption: '1' })],
      totals: totals({ icmsExempt: 3, total: 97 }),
    })
    expect(composition.exemptionDeducted).toBe(3)
    expect(composition.unexplained).toBe(0)
    expect(composition.blockers).toEqual(['O item 1 manda abater ICMS desonerado do total (indDeduzDeson 1), um caso ainda sem evidência real na fase 0.'])
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
