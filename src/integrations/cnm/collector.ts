import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  chromium,
  type BrowserContext,
  type Download,
  type Page,
} from 'playwright-core'
import {
  parseCnmSalesWorkbook,
  type CnmSalesReport,
} from '../../lib/cnmSalesImport'

export const CNM_BASE_URL = 'https://app2.controlenamao.com.br/'
export const CNM_SALES_REPORT_URL = `${CNM_BASE_URL}#!/relatorio/venda`
export const CNM_LOCATION = 'Pane Salute'
export const CNM_LOCATION_ID = '61286'
export const CNM_STORE = 'JC'
export const CNM_EXPORT_RETRY_MS = 65_000

export const CNM_SELECTORS = {
  startDate: 'input[ng-model="vm.dataInicio"]',
  endDate: 'input[ng-model="vm.dataFim"]',
  grouping: '#cbTipoAgrupamento',
  locations: '#cbLocaisFiltroRelatorioFluxoVendas',
  apply: 'button[title="Aplicar filtros"]',
  export: '#btnExport',
} as const

export const CNM_ENDPOINTS = {
  salesReport: 'RelatorioVenda/listarRelatorio',
} as const

export type CnmCollectorErrorCode =
  | 'argumento_invalido'
  | 'sessao_expirada'
  | 'relatorio_indisponivel'
  | 'download_falhou'
  | 'arquivo_divergente'

export class CnmCollectorError extends Error {
  constructor(
    public readonly code: CnmCollectorErrorCode,
    message: string,
    public readonly evidencePath?: string,
  ) {
    super(message)
    this.name = 'CnmCollectorError'
  }
}

export interface CnmCollectorConfig {
  profileDir: string
  downloadDir: string
  timeoutMs: number
  chromeExecutablePath?: string
}

export interface CnmDownloadOptions {
  saleDate: string
  headed: boolean
  replace: boolean
}

export interface CnmDownloadResult {
  status: 'created' | 'unchanged' | 'replaced'
  filePath: string
  fileHash: string
  report: CnmSalesReport
}

export function createCnmCollectorConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): CnmCollectorConfig {
  const timeoutValue = Number(environment.CNM_TIMEOUT_MS ?? 60_000)
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 5_000
    ? timeoutValue
    : 60_000

  return {
    profileDir: path.resolve(
      environment.CNM_PROFILE_DIR ?? path.join(cwd, 'storage', 'cnm', 'profile'),
    ),
    downloadDir: path.resolve(
      environment.CNM_DOWNLOAD_DIR ?? path.join(cwd, 'storage', 'cnm', 'downloads'),
    ),
    timeoutMs,
    chromeExecutablePath: environment.CNM_CHROME_PATH?.trim() || undefined,
  }
}

export function parseCnmDownloadArgs(args: string[]): CnmDownloadOptions {
  let saleDate = ''
  let headed = false
  let replace = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--date') {
      saleDate = args[index + 1] ?? ''
      index += 1
      continue
    }
    if (argument === '--headed') {
      headed = true
      continue
    }
    if (argument === '--replace') {
      replace = true
      continue
    }
    throw new CnmCollectorError(
      'argumento_invalido',
      `Argumento desconhecido: ${argument ?? ''}`,
    )
  }

  validateIsoDate(saleDate)
  return { saleDate, headed, replace }
}

export function toCnmDate(isoDate: string): string {
  validateIsoDate(isoDate)
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export function buildCnmSalesFileName(saleDate: string): string {
  validateIsoDate(saleDate)
  return `CNM_${saleDate}_JC.xls`
}

export function buildCnmConflictFileName(
  saleDate: string,
  fileHash: string,
): string {
  validateIsoDate(saleDate)
  return `CNM_${saleDate}_JC_CONFLITO_${fileHash.slice(0, 8).toUpperCase()}.xls`
}

export function decideExistingFile(
  existingHash: string | null,
  downloadedHash: string,
  replace: boolean,
): 'created' | 'unchanged' | 'replaced' | 'conflict' {
  if (!existingHash) return 'created'
  if (existingHash === downloadedHash) return 'unchanged'
  return replace ? 'replaced' : 'conflict'
}

export async function launchCnmBrowser(
  config: CnmCollectorConfig,
  headed: boolean,
): Promise<BrowserContext> {
  await mkdir(config.profileDir, { recursive: true })

  return chromium.launchPersistentContext(config.profileDir, {
    acceptDownloads: true,
    channel: config.chromeExecutablePath ? undefined : 'chrome',
    executablePath: config.chromeExecutablePath,
    headless: !headed,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: headed ? null : { width: 1440, height: 900 },
  })
}

export async function getOrCreateCnmPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? context.newPage()
}

export async function ensureCnmSession(
  page: Page,
  config: CnmCollectorConfig,
): Promise<void> {
  await page.goto(CNM_SALES_REPORT_URL, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeoutMs,
  })

  try {
    await page.locator(CNM_SELECTORS.startDate).waitFor({
      state: 'visible',
      timeout: Math.min(config.timeoutMs, 15_000),
    })
  } catch {
    throw new CnmCollectorError(
      'sessao_expirada',
      'A sessão do CNM não está válida. Execute npm run cnm:login e autentique novamente.',
    )
  }
}

export async function prepareCnmSalesReport(
  page: Page,
  saleDate: string,
  config: CnmCollectorConfig,
): Promise<void> {
  const cnmDate = toCnmDate(saleDate)

  await page.locator(CNM_SELECTORS.startDate).fill(cnmDate)
  await page.locator(CNM_SELECTORS.endDate).fill(cnmDate)
  await page.locator(CNM_SELECTORS.grouping).selectOption('P', { force: true })
  await page.locator(CNM_SELECTORS.locations).selectOption(
    [CNM_LOCATION_ID],
    { force: true },
  )

  try {
    const reportResponse = page.waitForResponse(
      (response) => response.url().includes(CNM_ENDPOINTS.salesReport)
        && response.ok(),
      { timeout: config.timeoutMs },
    )
    await page.locator(`${CNM_SELECTORS.apply}:visible`).first().click()
    await reportResponse
    await page.waitForFunction(
      ({ exportSelector }) => {
        const exportButton = document.querySelector<HTMLButtonElement>(exportSelector)
        const hasProductHeader = Array.from(document.querySelectorAll('table th'))
          .some((header) => header.textContent?.trim() === 'Produto')
        return Boolean(exportButton && !exportButton.disabled && hasProductHeader)
      },
      { exportSelector: CNM_SELECTORS.export },
      { timeout: config.timeoutMs },
    )
  } catch {
    throw new CnmCollectorError(
      'relatorio_indisponivel',
      'O CNM não liberou o XLS do relatório por produto para Pane Salute.',
    )
  }
}

export async function downloadAndValidateCnmSalesReport(input: {
  page: Page
  config: CnmCollectorConfig
  saleDate: string
  replace: boolean
}): Promise<CnmDownloadResult> {
  await mkdir(input.config.downloadDir, { recursive: true })
  const pendingPath = path.join(
    input.config.downloadDir,
    `.cnm-pending-${randomUUID()}.xls`,
  )

  try {
    const download = await requestCnmDownload(input.page, input.config)
    const failure = await download.failure()
    if (failure) {
      throw new CnmCollectorError(
        'download_falhou',
        `O CNM não concluiu o download: ${failure}`,
      )
    }
    await download.saveAs(pendingPath)

    const fileData = await readFile(pendingPath)
    const report = parseCnmSalesWorkbook(fileData, {
      cnmLocation: CNM_LOCATION,
      saleDate: input.saleDate,
    })
    const downloadedHash = sha256(fileData)
    const targetPath = path.join(
      input.config.downloadDir,
      buildCnmSalesFileName(input.saleDate),
    )
    const existingHash = await fileHashOrNull(targetPath)
    const decision = decideExistingFile(
      existingHash,
      downloadedHash,
      input.replace,
    )

    if (decision === 'unchanged') {
      await rm(pendingPath, { force: true })
      return {
        status: decision,
        filePath: targetPath,
        fileHash: downloadedHash,
        report,
      }
    }

    if (decision === 'conflict') {
      const conflictPath = path.join(
        input.config.downloadDir,
        buildCnmConflictFileName(input.saleDate, downloadedHash),
      )
      await rm(conflictPath, { force: true })
      await rename(pendingPath, conflictPath)
      throw new CnmCollectorError(
        'arquivo_divergente',
        'Já existe um XLS diferente para essa data. O novo arquivo foi preservado como conflito; revise antes de usar --replace.',
        conflictPath,
      )
    }

    if (decision === 'replaced') {
      await rm(targetPath, { force: true })
    }
    await rename(pendingPath, targetPath)

    return {
      status: decision,
      filePath: targetPath,
      fileHash: downloadedHash,
      report,
    }
  } catch (error) {
    await rm(pendingPath, { force: true })
    throw error
  }
}

async function requestCnmDownload(
  page: Page,
  config: CnmCollectorConfig,
): Promise<Download> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const downloadPromise = page.waitForEvent('download', {
      timeout: config.timeoutMs,
    }).then((download) => ({ type: 'download' as const, download }))
    const rateLimitPromise = page
      .getByText('Já existe uma solicitação sendo processada', { exact: false })
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => ({ type: 'rate_limit' as const }))
      .catch(() => new Promise<never>(() => undefined))

    await page.locator(CNM_SELECTORS.export).click()
    const outcome = await Promise.race([downloadPromise, rateLimitPromise])
    if (outcome.type === 'download') return outcome.download

    await page.getByRole('button', { name: 'OK!' }).click()
    if (attempt === 1) break
    await page.waitForTimeout(CNM_EXPORT_RETRY_MS)
  }

  throw new CnmCollectorError(
    'download_falhou',
    'O CNM manteve outra exportação em processamento após a nova tentativa.',
  )
}

export async function captureCnmFailure(
  page: Page,
  config: CnmCollectorConfig,
): Promise<string | null> {
  try {
    const errorDir = path.join(config.downloadDir, 'errors')
    await mkdir(errorDir, { recursive: true })
    const screenshotPath = path.join(errorDir, `cnm-error-${Date.now()}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false })
    return screenshotPath
  } catch {
    return null
  }
}

function validateIsoDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new CnmCollectorError(
      'argumento_invalido',
      'Informe --date no formato AAAA-MM-DD.',
    )
  }

  const [, year, month, day] = match
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw new CnmCollectorError('argumento_invalido', 'A data informada é inválida.')
  }
}

async function fileHashOrNull(filePath: string): Promise<string | null> {
  try {
    await access(filePath)
    return sha256(await readFile(filePath))
  } catch {
    return null
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
