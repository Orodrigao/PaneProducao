import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { CNM_SALES_REPORT_ROWS } from '../../test/fixtures/cnmSalesReport'
import {
  CnmSalesParseError,
  mapCnmLocation,
  parseCnmSalesFile,
  parseCnmSalesFileName,
  parseCnmSalesWorkbook,
} from './cnmSalesImport'

type FixtureCell = string | number | boolean | null

function createXls(rows: ReadonlyArray<ReadonlyArray<FixtureCell>>): ArrayBuffer {
  const workbook = utils.book_new()
  const worksheet = utils.aoa_to_sheet(rows.map((row) => [...row]))
  utils.book_append_sheet(workbook, worksheet, 'Relatório Venda')
  const file = write(workbook, { bookType: 'xls', type: 'array' })

  if (file instanceof ArrayBuffer) return file
  if (file instanceof Uint8Array) {
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  }
  throw new Error('A fixture XLS não pôde ser criada.')
}

function expectParseError(
  action: () => unknown,
  code: CnmSalesParseError['code'],
  sourceRow?: number,
) {
  try {
    action()
    throw new Error('Era esperado um erro de leitura do CNM.')
  } catch (error) {
    expect(error).toBeInstanceOf(CnmSalesParseError)
    expect((error as CnmSalesParseError).code).toBe(code)
    if (sourceRow !== undefined) {
      expect((error as CnmSalesParseError).sourceRow).toBe(sourceRow)
    }
  }
}

describe('parseCnmSalesWorkbook', () => {
  it('lê o XLS realista, ignora títulos/rodapé e normaliza os itens de JC', () => {
    const report = parseCnmSalesWorkbook(createXls(CNM_SALES_REPORT_ROWS), {
      cnmLocation: 'Pane Salute',
      saleDate: '2026-07-10',
    })

    expect(report.sheetName).toBe('Relatório Venda')
    expect(report.store).toBe('jc')
    expect(report.saleDate).toBe('2026-07-10')
    expect(report.items).toHaveLength(2)
    expect(report.items[0]).toMatchObject({
      sourceRow: 5,
      rawProductName: 'Pão Integral Teste',
      category: 'Pães Integrais',
      quantity: 2,
      cmv: 1.25,
      takeAway: false,
      netTotal: 20,
    })
    expect(report.items[1]).toMatchObject({
      sourceRow: 6,
      rawProductName: 'Baguete Teste',
      quantity: 3,
      takeAway: true,
      netTotal: 18.9,
    })
    expect(report.totalQuantity).toBe(5)
    expect(report.calculatedNetTotal).toBe(38.9)
    expect(report.reportedNetTotal).toBe(38.9)
    expect(report.warnings).toEqual([])
  })

  it('aceita as pequenas variações seguras de cabeçalho vistas no CNM', () => {
    const rows: FixtureCell[][] = [
      ['Produto', 'Categoria', 'Quantidade', 'CMV', 'P/ viagem?', 'Valor Total Produtos Descontos'],
      ['Produto Teste', 'Categoria Teste', 1, 0, 'Nao', 12.349999999999998],
    ]

    const report = parseCnmSalesWorkbook(createXls(rows), {
      cnmLocation: ' pane salute ',
      saleDate: '2026-07-10',
    })

    expect(report.items[0]?.netTotal).toBe(12.35)
    expect(report.items[0]?.takeAway).toBe(false)
  })

  it('bloqueia quando o total do rodapé diverge da soma dos produtos', () => {
    const rows = CNM_SALES_REPORT_ROWS.map((row) => [...row])
    rows[rows.length - 1] = ['', '', '', '', '', 40]

    expectParseError(() => parseCnmSalesWorkbook(createXls(rows), {
      cnmLocation: 'Pane Salute', saleDate: '2026-07-10',
    }), 'total_divergente')
  })

  it('rejeita arquivo que não seja o relatório por produto', () => {
    const file = createXls([
      ['Venda', 'Data', 'Total'],
      ['123', '10/07/2026', 50],
    ])

    expectParseError(
      () => parseCnmSalesWorkbook(file, {
        cnmLocation: 'Pane Salute',
        saleDate: '2026-07-10',
      }),
      'cabecalho_invalido',
    )
  })

  it('informa a linha quando quantidade ou valor são inválidos', () => {
    const rows = CNM_SALES_REPORT_ROWS.map((row) => [...row])
    rows[4] = ['Produto Teste', 'Categoria Teste', 'abc', 1, 'Não', 10]

    expectParseError(
      () => parseCnmSalesWorkbook(createXls(rows), {
        cnmLocation: 'Pane Salute',
        saleDate: '2026-07-10',
      }),
      'linha_invalida',
      5,
    )
  })

  it('rejeita data inválida e local ainda não mapeado', () => {
    const file = createXls(CNM_SALES_REPORT_ROWS)

    expectParseError(
      () => parseCnmSalesWorkbook(file, {
        cnmLocation: 'Pane Salute',
        saleDate: '2026-02-30',
      }),
      'data_invalida',
    )
    expectParseError(() => mapCnmLocation('Pane Julio'), 'local_nao_mapeado')
  })

  it('tira a data do nome padronizado e fixa a unidade JC', () => {
    expect(parseCnmSalesFileName('CNM_JC_2026-07-10.xls')).toBe('2026-07-10')
    expect(parseCnmSalesFileName('CNM_2026-07-10_JC.xls')).toBe('2026-07-10')
    const report = parseCnmSalesFile('CNM_JC_2026-07-10.xls', createXls(CNM_SALES_REPORT_ROWS))
    expect(report).toMatchObject({ saleDate: '2026-07-10', store: 'jc' })
  })

  it('recusa nome que permitiria escolher data ou loja errada', () => {
    expectParseError(() => parseCnmSalesFileName('vendas.xls'), 'nome_arquivo_invalido')
    expectParseError(() => parseCnmSalesFileName('CNM_JA_2026-07-10.xls'), 'nome_arquivo_invalido')
  })

  it('não aceita o cabeçalho genérico Valor como total líquido', () => {
    const rows: FixtureCell[][] = [
      ['Produto', 'Categoria', 'Quantidade', 'CMV', 'P/ viagem?', 'Valor'],
      ['Produto Teste', 'Categoria Teste', 1, 0, 'Nao', 12.35],
    ]
    expectParseError(() => parseCnmSalesWorkbook(createXls(rows), {
      cnmLocation: 'Pane Salute', saleDate: '2026-07-10',
    }), 'cabecalho_invalido')
  })
})
