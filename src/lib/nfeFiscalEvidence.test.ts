import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = join(process.cwd(), 'test', 'fixtures', 'nfe')
const fixtureNames = readdirSync(fixtureDirectory).filter(name => name.endsWith('.xml')).sort()

interface EvidenceCase {
  case: string
  items: number
  fields: string[]
  indDeduzDeson: '0' | '1' | 'mixed' | 'absent'
  indTotZero: number
  closes: boolean
}

const evidence = JSON.parse(
  readFileSync(join(fixtureDirectory, 'evidence-summary.json'), 'utf8'),
) as EvidenceCase[]

const expectedFixtures = {
  'frete-por-item.xml': {
    total: { vProd: 100, vFrete: 4, vNF: 104 },
    items: [
      { qCom: 1, uCom: 'UN', vUnCom: 60, vProd: 60, vFrete: 4 },
      { qCom: 1, uCom: 'UN', vUnCom: 40, vProd: 40 },
    ],
  },
  'sem-acrescimos.xml': {
    total: { vProd: 100, vNF: 100 },
    items: [
      { qCom: 1, uCom: 'UN', vUnCom: 60, vProd: 60 },
      { qCom: 1, uCom: 'UN', vUnCom: 40, vProd: 40 },
    ],
  },
  'st-desoneracao-nao-deduz.xml': {
    total: { vProd: 120, vST: 2, vICMSDeson: 3, vNF: 122 },
    items: [
      { qCom: 1, uCom: 'UN', vUnCom: 30, vProd: 30, vICMSST: 2, vICMSDeson: 3, indDeduzDeson: '0' },
      { qCom: 1, uCom: 'UN', vUnCom: 40, vProd: 40 },
      { qCom: 1, uCom: 'UN', vUnCom: 50, vProd: 50 },
    ],
  },
  'st-ipi-outras-despesas.xml': {
    total: { vProd: 120, vST: 3, vIPI: 2, vOutro: 1.5, vNF: 126.5 },
    items: [
      { qCom: 1, uCom: 'UN', vUnCom: 30, vProd: 30, vICMSST: 1.5, vIPI: 1, vOutro: 0.5 },
      { qCom: 1, uCom: 'UN', vUnCom: 40, vProd: 40, vICMSST: 1.5, vIPI: 1, vOutro: 0.5 },
      { qCom: 1, uCom: 'UN', vUnCom: 50, vProd: 50, vOutro: 0.5 },
    ],
  },
} as const

const expectedEvidence: EvidenceCase[] = [
  { case: 'case-01', items: 4, fields: ['vProd'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-02', items: 3, fields: ['vProd', 'vST', 'vICMSDeson'], indDeduzDeson: '0', indTotZero: 0, closes: true },
  { case: 'case-03', items: 3, fields: ['vProd'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-04', items: 8, fields: ['vProd', 'vFrete'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-05', items: 8, fields: ['vProd', 'vFrete'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-06', items: 1, fields: ['vProd'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-07', items: 2, fields: ['vProd'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-08', items: 15, fields: ['vProd', 'vST', 'vIPI', 'vOutro'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-09', items: 15, fields: ['vProd', 'vST', 'vIPI', 'vOutro'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-10', items: 15, fields: ['vProd', 'vST', 'vIPI', 'vOutro'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-11', items: 10, fields: ['vProd'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
  { case: 'case-12', items: 2, fields: ['vProd', 'vFrete'], indDeduzDeson: 'absent', indTotZero: 0, closes: true },
]

const expectedFixtureHashes: Record<string, string> = {
  'frete-por-item.xml': '99bf2c1c4f83abf06e9e4a55e355868db24cebd2565d9bb50718115dc3768e62',
  'sem-acrescimos.xml': '5bdbe698cca1b63fa0f7c69788ecce12ef6853fbee436a03ee4aa08cf150f57d',
  'st-desoneracao-nao-deduz.xml': '5b52aec2b19099f784d10dc58a0be6b7cd86cb2819aa923f2acb767d1215d5c7',
  'st-ipi-outras-despesas.xml': '7a8ddde6c85400b382aee28ce5ab7fe29b8d9a0085cf720886da55c9a5c46293',
}

const totalTags = ['vProd', 'vDesc', 'vST', 'vFCPST', 'vIPI', 'vIPIDevol', 'vFrete', 'vSeg', 'vOutro', 'vII', 'vICMSDeson', 'vNF'] as const
const itemNumberTags = ['qCom', 'vUnCom', 'vProd', 'vDesc', 'vFrete', 'vSeg', 'vOutro', 'vII', 'vICMSST', 'vFCPST', 'vIPI', 'vIPIDevol', 'vICMSDeson'] as const
const allowedElementTags = new Set([
  'nfeProc', 'NFe', 'infNFe', 'ide', 'mod', 'serie', 'nNF', 'dhEmi', 'emit', 'CNPJ', 'xNome',
  'det', 'prod', 'cProd', 'xProd', 'qCom', 'uCom', 'vUnCom', 'vProd', 'vDesc', 'vFrete', 'vSeg',
  'vOutro', 'vII', 'indTot', 'imposto', 'ICMS', 'ICMS70', 'ICMS10', 'vICMSDeson',
  'indDeduzDeson', 'vICMSST', 'vFCPST', 'IPI', 'IPITrib', 'vIPI', 'vIPIDevol', 'total',
  'ICMSTot', 'vST', 'vNF',
])

function tagValue(xml: string, tag: string): number {
  const total = xml.match(new RegExp(`<ICMSTot>[\\s\\S]*?<${tag}>([^<]+)</${tag}>[\\s\\S]*?</ICMSTot>`))
  return total ? Number(total[1]) : 0
}

function deductedDesoneration(xml: string): number {
  return [...xml.matchAll(/<det\b[\s\S]*?<\/det>/g)].reduce((sum, match) => {
    const item = match[0]
    if (!/<indDeduzDeson>1<\/indDeduzDeson>/.test(item)) return sum
    const desoneration = item.match(/<vICMSDeson>([^<]+)<\/vICMSDeson>/)
    return sum + Number(desoneration?.[1] ?? 0)
  }, 0)
}

function itemTagTotal(xml: string, tag: string): number {
  return [...xml.matchAll(/<det\b[\s\S]*?<\/det>/g)].reduce((sum, itemMatch) => {
    const value = itemMatch[0].match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
    return sum + Number(value?.[1] ?? 0)
  }, 0)
}

function expectedInvoiceTotal(xml: string): number {
  const additions = ['vST', 'vFCPST', 'vIPI', 'vIPIDevol', 'vFrete', 'vSeg', 'vOutro', 'vII']
    .reduce((sum, tag) => sum + tagValue(xml, tag), 0)
  return tagValue(xml, 'vProd') - tagValue(xml, 'vDesc') + additions - deductedDesoneration(xml)
}

function allTagValues(xml: string, tag: string): number[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g'))]
    .map(match => Number(match[1]))
}

function firstItemValue(item: string, tag: string): string | null {
  return item.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] ?? null
}

function assertEvidenceSupported(xml: string): void {
  for (const tag of ['vDesc', 'vFCPST', 'vIPIDevol', 'vSeg', 'vII', 'vServ']) {
    if (allTagValues(xml, tag).some(value => value !== 0)) {
      throw new Error(`Campo sem evidência real: ${tag}`)
    }
  }
  if (/<indTot>0<\/indTot>/.test(xml)) throw new Error('Item fora do total sem evidência real')
  if (/<indDeduzDeson>1<\/indDeduzDeson>/.test(xml)) throw new Error('Desoneração dedutível sem evidência real')

  for (const item of xml.matchAll(/<det\b[\s\S]*?<\/det>/g)) {
    const desoneration = Number(item[0].match(/<vICMSDeson>([^<]+)<\/vICMSDeson>/)?.[1] ?? 0)
    if (desoneration !== 0 && !/<indDeduzDeson>0<\/indDeduzDeson>/.test(item[0])) {
      throw new Error('Desoneração sem indicador validado')
    }
  }
}

describe('evidência fiscal anonimizada das NF-e reais', () => {
  it('mantém apenas os quatro cenários encontrados na amostra', () => {
    expect(fixtureNames).toEqual([
      'frete-por-item.xml',
      'sem-acrescimos.xml',
      'st-desoneracao-nao-deduz.xml',
      'st-ipi-outras-despesas.xml',
    ])
  })

  it.each(fixtureNames)('%s fecha a composição até o centavo', name => {
    const xml = readFileSync(join(fixtureDirectory, name), 'utf8')
    expect(expectedInvoiceTotal(xml)).toBeCloseTo(tagValue(xml, 'vNF'), 2)
  })

  it.each(fixtureNames)('%s permanece byte a byte na versão anonimizada revisada', name => {
    const contents = readFileSync(join(fixtureDirectory, name))
    expect(createHash('sha256').update(contents).digest('hex')).toBe(expectedFixtureHashes[name])
  })

  it.each(fixtureNames)('%s continua representando exatamente o cenário fictício aprovado', name => {
    const xml = readFileSync(join(fixtureDirectory, name), 'utf8')
    const expected = expectedFixtures[name as keyof typeof expectedFixtures]
    const items = [...xml.matchAll(/<det\b[\s\S]*?<\/det>/g)].map(match => match[0])
    expect(items).toHaveLength(expected.items.length)
    for (const tag of totalTags) {
      expect(tagValue(xml, tag)).toBe(expected.total[tag as keyof typeof expected.total] ?? 0)
    }
    items.forEach((item, index) => {
      const expectedItem = expected.items[index]
      expect(firstItemValue(item, 'uCom')).toBe(expectedItem.uCom)
      expect(firstItemValue(item, 'indTot')).toBe('1')
      expect(firstItemValue(item, 'cProd')).toBe(`FICTICIO-${String(index + 1).padStart(2, '0')}`)
      expect(firstItemValue(item, 'xProd')).toBe(`INSUMO FICTICIO ${String.fromCharCode(65 + index)}`)
      for (const tag of itemNumberTags) {
        expect(Number(firstItemValue(item, tag) ?? 0)).toBe(expectedItem[tag as keyof typeof expectedItem] ?? 0)
      }
      const expectedIndicator = (expectedItem as typeof expectedItem & { indDeduzDeson?: string }).indDeduzDeson
      expect(firstItemValue(item, 'indDeduzDeson')).toBe(expectedIndicator ?? null)
    })
  })

  it('preserva a regra observada: indDeduzDeson 0 não reduz o total', () => {
    const xml = readFileSync(join(fixtureDirectory, 'st-desoneracao-nao-deduz.xml'), 'utf8')
    expect(xml).toContain('<indDeduzDeson>0</indDeduzDeson>')
    expect(tagValue(xml, 'vICMSDeson')).toBe(3)
    expect(tagValue(xml, 'vNF')).toBe(122)
  })

  it('preserva os campos por item sem somar novamente os totais da nota', () => {
    const freight = readFileSync(join(fixtureDirectory, 'frete-por-item.xml'), 'utf8')
    expect(itemTagTotal(freight, 'vFrete')).toBe(tagValue(freight, 'vFrete'))

    const st = readFileSync(join(fixtureDirectory, 'st-desoneracao-nao-deduz.xml'), 'utf8')
    expect(itemTagTotal(st, 'vICMSST')).toBe(tagValue(st, 'vST'))
    expect(itemTagTotal(st, 'vICMSDeson')).toBe(tagValue(st, 'vICMSDeson'))

    const mixed = readFileSync(join(fixtureDirectory, 'st-ipi-outras-despesas.xml'), 'utf8')
    expect(itemTagTotal(mixed, 'vICMSST')).toBe(tagValue(mixed, 'vST'))
    expect(itemTagTotal(mixed, 'vIPI')).toBe(tagValue(mixed, 'vIPI'))
    expect(itemTagTotal(mixed, 'vOutro')).toBe(tagValue(mixed, 'vOutro'))
  })

  it.each(fixtureNames)('%s não libera caso fiscal que a amostra não comprovou', name => {
    const xml = readFileSync(join(fixtureDirectory, name), 'utf8')
    expect(() => assertEvidenceSupported(xml)).not.toThrow()
  })

  it.each([
    ['desconto', '<vDesc>1.00</vDesc>'],
    ['desoneração dedutível', '<det><vICMSDeson>1.00</vICMSDeson><indDeduzDeson>1</indDeduzDeson></det>'],
    ['desoneração sem indicador', '<det><vICMSDeson>1.00</vICMSDeson></det>'],
    ['item fora do total', '<indTot>0</indTot>'],
    ['serviço', '<vServ>1.00</vServ>'],
  ])('bloqueia %s enquanto não houver XML real correspondente', (_case, xml) => {
    expect(() => assertEvidenceSupported(xml)).toThrow()
  })

  it('preserva o resumo sanitizado das 12 notas sem identificadores nem valores', () => {
    expect(evidence).toEqual(expectedEvidence)
    expect(evidence.filter(item => item.fields.includes('vProd'))).toHaveLength(12)
    expect(evidence.filter(item => item.fields.includes('vST'))).toHaveLength(4)
    expect(evidence.filter(item => item.fields.includes('vIPI'))).toHaveLength(3)
    expect(evidence.filter(item => item.fields.includes('vFrete'))).toHaveLength(3)
    expect(evidence.filter(item => item.fields.includes('vOutro'))).toHaveLength(3)
    expect(evidence.filter(item => item.fields.includes('vICMSDeson'))).toHaveLength(1)
    expect(evidence.filter(item => item.fields.includes('vDesc'))).toHaveLength(0)
    expect(evidence.filter(item => item.fields.includes('vServ'))).toHaveLength(0)
    for (const field of ['vFCPST', 'vIPIDevol', 'vSeg', 'vII']) {
      expect(evidence.filter(item => item.fields.includes(field))).toHaveLength(0)
    }
    expect(evidence.filter(item => item.indDeduzDeson === '0')).toHaveLength(1)
    expect(evidence.filter(item => item.indDeduzDeson === '1' || item.indDeduzDeson === 'mixed')).toHaveLength(0)
    expect(evidence.reduce((sum, item) => sum + item.indTotZero, 0)).toBe(0)
  })

  it.each(fixtureNames)('%s não conserva assinatura, protocolo ou identificação real', name => {
    const xml = readFileSync(join(fixtureDirectory, name), 'utf8')
    const elementTags = [...xml.matchAll(/<\/?([A-Za-z0-9]+)\b/g)].map(match => match[1])
    expect(elementTags.every(tag => allowedElementTags.has(tag))).toBe(true)
    expect(xml).not.toMatch(/<(?:Signature|X509Certificate|protNFe|infNFeSupl|infRespTec|autXML)\b/)
    expect(xml).not.toMatch(/\d{44}/)
    expect(xml).not.toMatch(/<(?:CPF|IE|email|fone|xFant|enderEmit|enderDest|transporta|infCpl|infAdFisco|obsCont|obsFisco)\b/)
    expect(xml.match(/<infNFe\b[^>]*\bId="([^"]+)"/)?.[1]).toMatch(/^NFeFICTICIA-[A-Z-]+$/)
    expect([...xml.matchAll(/<CNPJ>([^<]+)<\/CNPJ>/g)].map(match => match[1]))
      .toEqual(['00000000000000'])
    expect([...xml.matchAll(/<xNome>([^<]+)<\/xNome>/g)].map(match => match[1]))
      .toEqual([expect.stringMatching(/^FORNECEDOR FICTICIO [A-D]$/)])
    expect([...xml.matchAll(/<nNF>([^<]+)<\/nNF>/g)].map(match => match[1]))
      .toEqual([expect.stringMatching(/^900[1-4]$/)])
    expect([...xml.matchAll(/<serie>([^<]+)<\/serie>/g)].map(match => match[1])).toEqual(['1'])
    expect([...xml.matchAll(/<mod>([^<]+)<\/mod>/g)].map(match => match[1])).toEqual(['55'])
    expect([...xml.matchAll(/<dhEmi>([^<]+)<\/dhEmi>/g)].map(match => match[1]))
      .toEqual([expect.stringMatching(/^2026-01-1[0-3]T09:00:00-03:00$/)])
    expect(xml).toContain('FICTICIO')
  })

  it('a guarda reconhece uma chave realista mesmo quando vem prefixada por NFe', () => {
    expect(`Id="NFe${'1'.repeat(44)}"`).toMatch(/\d{44}/)
  })
})
