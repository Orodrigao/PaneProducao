import { describe, expect, it } from 'vitest'
import {
  calculateNetLineTotal,
  calculateNormalizedUnitCost,
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  getConversionUnitWarning,
  formatConversionExplanation,
  isClassificationComplete,
  resolveInstallments,
  suggestConversionFactor,
  unitFamily,
  type NfeItemDraft,
} from '@/lib/nfeXml'

function item(overrides: Partial<NfeItemDraft> = {}): NfeItemDraft {
  return {
    lineNumber: 1,
    supplierCode: '1044',
    ean: null,
    description: 'SACO PAPEL RJ KRAFT 35GR 2KG',
    ncm: '48194000',
    quantity: 2,
    purchaseUnit: 'PACOTE',
    taxQuantity: 2,
    taxUnit: 'PACOTE',
    unitPrice: 54.03,
    grossLineTotal: 108.06,
    discountValue: 0,
    lineTotal: 108.06,
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionBasis: 'package',
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
    rememberConversion: true,
    factorConfirmed: false,
    recognized: false,
    ...overrides,
  }
}

describe('conversão de itens importados da NF-e', () => {
  it('desconta o valor informado no item antes de fechar o total da NF', () => {
    expect(calculateNetLineTotal(1967.70, 39.10)).toBe(1928.60)
  })

  it('calcula 1.000 sacos quando são 2 pacotes de 500 unidades', () => {
    expect(calculateUsableQuantity(2, 500)).toBe(1000)
    expect(conversionFactorFromUsableQuantity(2, 1000)).toBe(500)
    expect(calculateNormalizedUnitCost(108.06, 1000)).toBe(0.10806)
  })

  it('calcula custo por kg aproveitável de azeitona drenada', () => {
    expect(calculateUsableQuantity(3, 0.6)).toBe(1.8)
    expect(calculateNormalizedUnitCost(60, 1.8)).toBe(33.333333)
  })

  it('alerta quando a NF e a receita estao em kg mas o fator nao e 1', () => {
    expect(getConversionUnitWarning('KG', 'kg', 3)).toContain('fator 1')
    expect(getConversionUnitWarning('UN', 'kg', 3)).toBeNull()
  })

  it('explica o cálculo sem exigir que o usuário faça a conta', () => {
    expect(formatConversionExplanation(item({
      quantity: 2,
      purchaseUnit: 'PACOTE',
      conversionFactor: 500,
      usableQuantity: 1000,
      baseProductName: 'Saco de papel 2 kg',
      baseUnit: 'un',
      mappingStatus: 'mapeado',
    }))).toEqual({
      input: '2 PACOTE',
      operation: '2 × 500 = 1.000',
      output: '1.000 un de Saco de papel 2 kg',
      cost: 'R$ 0,1081 por un',
    })
  })

  it('não considera a NF classificada enquanto houver linha pendente', () => {
    expect(isClassificationComplete([item({ mappingStatus: 'mapeado', baseProductId: 'product-1', usableQuantity: 100 })])).toBe(true)
    expect(isClassificationComplete([item(), item({ lineNumber: 2, mappingStatus: 'mapeado', baseProductId: 'product-2', usableQuantity: 1 })])).toBe(false)
  })
})

describe('vencimento das parcelas importadas da NF-e', () => {
  it('usa as duplicatas quando a NF-e informa as datas', () => {
    expect(resolveInstallments(
      [{ number: 1, dueDate: '2026-09-09', amount: 510.97 }],
      ['boleto'],
      '2026-08-21',
      510.97,
    )).toEqual({
      installments: [{ number: 1, dueDate: '2026-09-09', amount: 510.97 }],
      dueDateSource: 'xml',
    })
  })

  it('deixa a data vazia quando a NF-e a prazo nao traz duplicata', () => {
    expect(resolveInstallments([], ['boleto'], '2026-08-21', 510.97)).toEqual({
      installments: [{ number: 1, dueDate: '', amount: 510.97 }],
      dueDateSource: 'ausente',
    })
  })

  it('assume a emissao somente quando o pagamento e a vista', () => {
    expect(resolveInstallments([], ['dinheiro'], '2026-08-21', 150.80)).toEqual({
      installments: [{ number: 1, dueDate: '2026-08-21', amount: 150.80 }],
      dueDateSource: 'a-vista',
    })
    expect(resolveInstallments([], ['pix'], '2026-08-21', 11.90).dueDateSource).toBe('a-vista')
    expect(resolveInstallments([], ['cartao'], '2026-08-21', 11.90).dueDateSource).toBe('ausente')
    expect(resolveInstallments([], ['outro'], '2026-08-21', 11.90).dueDateSource).toBe('ausente')
  })

  it('cobra a data tambem quando so uma das duplicatas veio sem vencimento', () => {
    expect(resolveInstallments(
      [{ number: 1, dueDate: '2026-09-09', amount: 250 }, { number: 2, dueDate: '', amount: 260.97 }],
      ['boleto'],
      '2026-08-21',
      510.97,
    ).dueDateSource).toBe('ausente')
  })
})

describe('casos de borda apontados na revisao adversarial', () => {
  it('nao trata como a vista a nota com dinheiro e boleto no mesmo pagamento', () => {
    expect(resolveInstallments([], ['dinheiro', 'boleto'], '2026-08-21', 510.97)).toEqual({
      installments: [{ number: 1, dueDate: '', amount: 510.97 }],
      dueDateSource: 'ausente',
    })
  })

  it('exige a data quando a NF-e nao declara forma de pagamento', () => {
    expect(resolveInstallments([], [], '2026-08-21', 510.97).dueDateSource).toBe('ausente')
  })

  it('mantem a vista somente quando todos os pagamentos sao a vista', () => {
    expect(resolveInstallments([], ['dinheiro', 'pix'], '2026-08-21', 510.97).dueDateSource).toBe('a-vista')
  })

  it('numera as parcelas pela posicao, mesmo com nDup repetido no XML', () => {
    expect(resolveInstallments(
      [{ number: 1, dueDate: '2026-09-09', amount: 250 }, { number: 1, dueDate: '2026-10-09', amount: 260.97 }],
      ['boleto'],
      '2026-08-21',
      510.97,
    ).installments.map(item => item.number)).toEqual([1, 2])
  })
})

describe('sugestao de fator lida da descricao da NF-e', () => {
  const fator = (descricao: string, unidadeReceita: string) =>
    suggestConversionFactor(descricao, unidadeReceita)?.factor ?? null

  it('le o tamanho da embalagem quando a receita cobra por peso', () => {
    expect(fator('FARINHA DE TRIGO TIPO 1 NORDESTE 25KG PAPEL', 'kg')).toBe(25)
    expect(fator('CREME CONFEITEIRO CPT FINESSE 0,8 KG PURATOS', 'kg')).toBe(0.8)
    expect(fator('DOCE DE LEITE PARA CONFEITARIA 4,75KG MUMU', 'KG')).toBe(4.75)
    expect(fator('FERM. INST. PARALEVA M DOCE 500 G', 'KG')).toBe(0.5)
    expect(fator('CHIPS 2,5KG AO LEITE CHIPSHOW', 'kg')).toBe(2.5)
  })

  it('le o volume quando a receita cobra por litro', () => {
    expect(fator('ALCOOL LIQUIDO 70 INPM 5L VALE VERDE', 'litro')).toBe(5)
    expect(fator('AGUA SEM GAS 500 ML', 'litro')).toBe(0.5)
  })

  it('le quantas pecas vem na embalagem quando a receita cobra por unidade', () => {
    expect(fator('ACUCAR SACHE 4G C/1000 BOM SABOR', 'un')).toBe(1000)
    expect(fator('BANDEJA ALUMINIO RETANGULAR S/T 750ML  C/100 WYDA', 'un')).toBe(100)
    expect(fator('76025 - MUFFIN CHOCOLATE GOTAS MB 15 X 80G', 'un')).toBe(15)
    expect(fator('3L COOL WHITE TUTTI FRESH 15X8,5GR', 'un')).toBe(15)
  })

  it('multiplica contagem por tamanho quando a receita cobra por peso', () => {
    expect(fator('MUFFIN CHOCOLATE GOTAS MB 15 X 80G', 'kg')).toBe(1.2)
  })

  it('nao confunde medida da embalagem com contagem', () => {
    // 40x60 e a medida do saco em cm, nao a quantidade; o C/500 e que conta.
    expect(fator('BOBINA PICOTADA FINA 40X60 12KG C/500 EMBALAGIO', 'un')).toBe(500)
    expect(fator('SACO LIXO IND PRETO 59X62 M5 30L C/100', 'un')).toBe(100)
  })

  it('nao chuta quando a descricao nao diz o tamanho', () => {
    expect(fator('QUEIJO GORGONZOLA', 'kg')).toBeNull()
    expect(fator('CAPPUCCINO DOPPIO TRADICIONAL 1KG', 'un')).toBeNull()
    expect(fator('ACUCAR SACHE 4G C/1000 BOM SABOR', 'kg')).toBeNull()
    expect(fator('BOMBOM OURO BRANCO 1KG', 'caixa')).toBeNull()
  })

  it('mostra o trecho que originou a sugestao, para a pessoa conferir', () => {
    expect(suggestConversionFactor('FARINHA DE TRIGO TIPO 1 NORDESTE 25KG PAPEL', 'kg')?.evidence).toBe('25KG')
    expect(suggestConversionFactor('ACUCAR SACHE 4G C/1000 BOM SABOR', 'un')?.evidence).toBe('C/1000')
  })

  it('reconhece as familias de unidade usadas no cadastro', () => {
    expect(unitFamily('kg')).toBe('peso')
    expect(unitFamily('KG')).toBe('peso')
    expect(unitFamily('litro')).toBe('volume')
    expect(unitFamily('un')).toBe('unidade')
    expect(unitFamily('caixa')).toBe('desconhecida')
  })
})
