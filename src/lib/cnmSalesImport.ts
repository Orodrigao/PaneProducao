import { read, utils } from 'xlsx'

export type CnmStore = 'jc'

export type CnmSalesParseErrorCode =
  | 'arquivo_invalido'
  | 'cabecalho_invalido'
  | 'data_invalida'
  | 'local_nao_mapeado'
  | 'linha_invalida'
  | 'sem_itens'

export interface CnmSalesImportContext {
  cnmLocation: string
  saleDate: string
}

export interface CnmSalesItem {
  sourceRow: number
  store: CnmStore
  saleDate: string
  rawProductName: string
  category: string
  quantity: number
  cmv: number | null
  takeAway: boolean | null
  netTotal: number
  rawValues: ReadonlyArray<string | number | boolean | null>
}

export interface CnmSalesReport {
  sheetName: string
  cnmLocation: string
  store: CnmStore
  saleDate: string
  items: CnmSalesItem[]
  totalQuantity: number
  calculatedNetTotal: number
  reportedNetTotal: number | null
  warnings: string[]
}

export class CnmSalesParseError extends Error {
  constructor(
    public readonly code: CnmSalesParseErrorCode,
    message: string,
    public readonly sourceRow?: number,
  ) {
    super(message)
    this.name = 'CnmSalesParseError'
  }
}

export const CNM_LOCATION_TO_STORE = {
  'Pane Salute': 'jc',
} as const satisfies Record<string, CnmStore>

type ColumnKey =
  | 'product'
  | 'category'
  | 'quantity'
  | 'cmv'
  | 'takeAway'
  | 'netTotal'

type ColumnIndexes = Record<ColumnKey, number>

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_HEADER_SCAN_ROWS = 30
const MONEY_PRECISION = 100
const QUANTITY_PRECISION = 10_000

const HEADER_ALIASES: Record<ColumnKey, ReadonlyArray<string>> = {
  product: ['produto'],
  category: ['categoria'],
  quantity: ['quantidade'],
  cmv: ['cmv'],
  takeAway: ['p viagem', 'para viagem'],
  netTotal: [
    'valor total produtos descontos',
    'valor total produtos desconto',
    'valor',
  ],
}

export function mapCnmLocation(cnmLocation: string): CnmStore {
  const normalizedLocation = normalizeText(cnmLocation)
  const mapping = Object.entries(CNM_LOCATION_TO_STORE).find(
    ([location]) => normalizeText(location) === normalizedLocation,
  )

  if (!mapping) {
    throw new CnmSalesParseError(
      'local_nao_mapeado',
      `O local "${cnmLocation}" ainda não está vinculado a uma loja do ERP.`,
    )
  }

  return mapping[1]
}

export function parseCnmSalesWorkbook(
  fileData: ArrayBuffer | Uint8Array,
  context: CnmSalesImportContext,
): CnmSalesReport {
  const saleDate = validateIsoDate(context.saleDate)
  const store = mapCnmLocation(context.cnmLocation)
  const workbook = readWorkbook(fileData)

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    })
    const header = findHeader(rows)
    if (!header) continue

    return parseRows({
      rows,
      headerRowIndex: header.rowIndex,
      columns: header.columns,
      sheetName,
      cnmLocation: context.cnmLocation.trim(),
      store,
      saleDate,
    })
  }

  throw new CnmSalesParseError(
    'cabecalho_invalido',
    'O arquivo não contém o cabeçalho esperado do relatório de vendas por produto do CNM.',
  )
}

function readWorkbook(fileData: ArrayBuffer | Uint8Array) {
  try {
    return read(fileData, { type: 'array', raw: true, cellDates: false })
  } catch {
    throw new CnmSalesParseError(
      'arquivo_invalido',
      'Não foi possível abrir o arquivo. Gere novamente o relatório em XLS no CNM.',
    )
  }
}

function findHeader(
  rows: unknown[][],
): { rowIndex: number; columns: ColumnIndexes } | null {
  const rowsToScan = rows.slice(0, MAX_HEADER_SCAN_ROWS)

  for (let rowIndex = 0; rowIndex < rowsToScan.length; rowIndex += 1) {
    const row = rowsToScan[rowIndex] ?? []
    const columns = findColumns(row)
    if (columns) return { rowIndex, columns }
  }

  return null
}

function findColumns(row: unknown[]): ColumnIndexes | null {
  const normalizedCells = row.map((cell) => normalizeText(cellToString(cell)))
  const result = {} as Partial<ColumnIndexes>

  for (const key of Object.keys(HEADER_ALIASES) as ColumnKey[]) {
    const aliases = HEADER_ALIASES[key]
    const index = normalizedCells.findIndex((cell) => aliases.includes(cell))
    if (index === -1) return null
    result[key] = index
  }

  return result as ColumnIndexes
}

function parseRows(input: {
  rows: unknown[][]
  headerRowIndex: number
  columns: ColumnIndexes
  sheetName: string
  cnmLocation: string
  store: CnmStore
  saleDate: string
}): CnmSalesReport {
  const items: CnmSalesItem[] = []
  const warnings: string[] = []
  let reportedNetTotal: number | null = null

  for (let rowIndex = input.headerRowIndex + 1; rowIndex < input.rows.length; rowIndex += 1) {
    const row = input.rows[rowIndex] ?? []
    const sourceRow = rowIndex + 1
    const rawProductName = cellToString(row[input.columns.product]).trim()

    if (!rawProductName) {
      const footerTotal = parseNumber(row[input.columns.netTotal])
      if (footerTotal !== null && footerTotal >= 0) {
        reportedNetTotal = roundMoney(footerTotal)
      }
      continue
    }

    const category = cellToString(row[input.columns.category]).trim()
    if (!category) {
      throw invalidRow(sourceRow, `O produto "${rawProductName}" está sem categoria.`)
    }

    const quantity = parseNumber(row[input.columns.quantity])
    if (quantity === null || quantity <= 0) {
      throw invalidRow(sourceRow, `Quantidade inválida para o produto "${rawProductName}".`)
    }

    const cmvValue = parseNumber(row[input.columns.cmv])
    if (cmvValue !== null && cmvValue < 0) {
      throw invalidRow(sourceRow, `CMV inválido para o produto "${rawProductName}".`)
    }

    const netTotal = parseNumber(row[input.columns.netTotal])
    if (netTotal === null || netTotal < 0) {
      throw invalidRow(sourceRow, `Valor inválido para o produto "${rawProductName}".`)
    }

    const takeAway = parseTakeAway(row[input.columns.takeAway], sourceRow, rawProductName)

    items.push({
      sourceRow,
      store: input.store,
      saleDate: input.saleDate,
      rawProductName,
      category,
      quantity: roundQuantity(quantity),
      cmv: cmvValue === null ? null : roundMoney(cmvValue),
      takeAway,
      netTotal: roundMoney(netTotal),
      rawValues: row.map(toSerializableCell),
    })
  }

  if (items.length === 0) {
    throw new CnmSalesParseError(
      'sem_itens',
      'O relatório não contém produtos vendidos.',
    )
  }

  const totalQuantity = roundQuantity(
    items.reduce((total, item) => total + item.quantity, 0),
  )
  const calculatedNetTotal = roundMoney(
    items.reduce((total, item) => total + item.netTotal, 0),
  )

  if (
    reportedNetTotal !== null
    && Math.abs(reportedNetTotal - calculatedNetTotal) > 0.01
  ) {
    warnings.push(
      `A soma dos produtos (${formatMoney(calculatedNetTotal)}) difere do total informado no arquivo (${formatMoney(reportedNetTotal)}).`,
    )
  }

  return {
    sheetName: input.sheetName,
    cnmLocation: input.cnmLocation,
    store: input.store,
    saleDate: input.saleDate,
    items,
    totalQuantity,
    calculatedNetTotal,
    reportedNetTotal,
    warnings,
  }
}

function validateIsoDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) {
    throw new CnmSalesParseError(
      'data_invalida',
      'A data da venda deve estar no formato AAAA-MM-DD.',
    )
  }

  const [, year, month, day] = match
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw new CnmSalesParseError('data_invalida', 'A data da venda é inválida.')
  }

  return value
}

function parseTakeAway(
  value: unknown,
  sourceRow: number,
  productName: string,
): boolean | null {
  const normalized = normalizeText(cellToString(value))
  if (!normalized) return null
  if (normalized === 'sim') return true
  if (normalized === 'nao') return false

  throw invalidRow(
    sourceRow,
    `A indicação de viagem do produto "${productName}" é inválida.`,
  )
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  let normalized = value
    .replace(/R\$/gi, '')
    .replace(/[\s\u00a0]/g, '')
    .trim()
  if (!normalized) return null

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function toSerializableCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return String(value)
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * MONEY_PRECISION) / MONEY_PRECISION
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * QUANTITY_PRECISION) / QUANTITY_PRECISION
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function invalidRow(sourceRow: number, message: string): CnmSalesParseError {
  return new CnmSalesParseError('linha_invalida', message, sourceRow)
}
