import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { CNM_SALES_REPORT_ROWS } from '../../../test/fixtures/cnmSalesReport'
import {
  CnmCollectorError,
  buildCnmConflictFileName,
  buildCnmSalesFileName,
  createCnmCollectorConfig,
  decideExistingFile,
  downloadAndValidateCnmSalesReport,
  parseCnmDownloadArgs,
  toCnmDate,
} from './collector'

describe('coletor CNM', () => {
  it('normaliza os argumentos seguros do download diário', () => {
    expect(parseCnmDownloadArgs([
      '--date',
      '2026-07-10',
      '--headed',
      '--replace',
    ])).toEqual({
      saleDate: '2026-07-10',
      headed: true,
      replace: true,
    })
    expect(toCnmDate('2026-07-10')).toBe('10/07/2026')
    expect(buildCnmSalesFileName('2026-07-10')).toBe('CNM_2026-07-10_JC.xls')
  })

  it('rejeita data ausente, impossível ou argumento desconhecido', () => {
    for (const args of [
      [],
      ['--date', '2026-02-30'],
      ['--date', '10/07/2026'],
      ['--date', '2026-07-10', '--loja', 'jc'],
    ]) {
      expect(() => parseCnmDownloadArgs(args)).toThrow(CnmCollectorError)
    }
  })

  it('mantém reexecução idempotente e não sobrescreve divergência', () => {
    expect(decideExistingFile(null, 'novo', false)).toBe('created')
    expect(decideExistingFile('igual', 'igual', false)).toBe('unchanged')
    expect(decideExistingFile('antigo', 'novo', false)).toBe('conflict')
    expect(decideExistingFile('antigo', 'novo', true)).toBe('replaced')
    expect(buildCnmConflictFileName('2026-07-10', 'abcdef123456')).toBe(
      'CNM_2026-07-10_JC_CONFLITO_ABCDEF12.xls',
    )
  })

  it('mantém sessão e relatórios dentro do workspace por padrão', () => {
    // Base absoluta válida em qualquer sistema (Windows, macOS e o Linux do CI).
    const base = process.platform === 'win32' ? 'C:/repo' : '/repo'
    const config = createCnmCollectorConfig({}, base)
    expect(config.profileDir.replace(/\\/g, '/')).toBe(`${base}/storage/cnm/profile`)
    expect(config.downloadDir.replace(/\\/g, '/')).toBe(`${base}/storage/cnm/downloads`)
    expect(config.timeoutMs).toBe(60_000)
    expect(config.chromeExecutablePath).toBeUndefined()
  })

  it('valida o XLS e preserva idempotência e conflito no filesystem', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'cnm-collector-'))
    const config = createCnmCollectorConfig({}, workspace)
    const saleDate = '2026-07-10'
    const originalWorkbook = createWorkbook(CNM_SALES_REPORT_ROWS)
    const changedRows = CNM_SALES_REPORT_ROWS.map((row) => [...row])
    changedRows[4]![2] = '4,0000'
    changedRows[4]![5] = 'R$ 40,00'
    changedRows[6]![5] = 58.9
    const changedWorkbook = createWorkbook(changedRows)

    try {
      const created = await downloadAndValidateCnmSalesReport({
        page: createDownloadPage(originalWorkbook, true),
        config,
        saleDate,
        replace: false,
      })
      expect(created.status).toBe('created')
      expect(created.report.totalQuantity).toBe(5)
      expect(created.report.calculatedNetTotal).toBe(38.9)

      const unchanged = await downloadAndValidateCnmSalesReport({
        page: createDownloadPage(originalWorkbook),
        config,
        saleDate,
        replace: false,
      })
      expect(unchanged.status).toBe('unchanged')

      let conflict: CnmCollectorError | null = null
      try {
        await downloadAndValidateCnmSalesReport({
          page: createDownloadPage(changedWorkbook),
          config,
          saleDate,
          replace: false,
        })
      } catch (error) {
        conflict = error as CnmCollectorError
      }

      expect(conflict).toBeInstanceOf(CnmCollectorError)
      expect(conflict?.code).toBe('arquivo_divergente')
      expect(conflict?.evidencePath).toContain('CONFLITO_')
      expect(Buffer.compare(await readFile(created.filePath), originalWorkbook)).toBe(0)
      expect(
        Buffer.compare(await readFile(conflict!.evidencePath!), changedWorkbook),
      ).toBe(0)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function createWorkbook(
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
): Buffer {
  const workbook = utils.book_new()
  const mutableRows = rows.map((row) => [...row])
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet(mutableRows),
    'Relatório Venda',
  )
  return write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer
}

function createDownloadPage(fileData: Buffer, rateLimitedOnce = false): Page {
  const download = {
    failure: async () => null,
    saveAs: async (filePath: string) => writeFile(filePath, fileData),
  }
  let downloadAttempts = 0
  return {
    waitForEvent: () => {
      downloadAttempts += 1
      if (rateLimitedOnce && downloadAttempts === 1) {
        return new Promise(() => undefined)
      }
      return Promise.resolve(download)
    },
    locator: () => ({ click: async () => undefined }),
    getByText: () => ({
      waitFor: () => {
        if (rateLimitedOnce && downloadAttempts === 1) return Promise.resolve()
        return new Promise(() => undefined)
      },
    }),
    getByRole: () => ({ click: async () => undefined }),
    waitForTimeout: async () => undefined,
  } as unknown as Page
}
