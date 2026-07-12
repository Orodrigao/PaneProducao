import {
  captureCnmFailure,
  createCnmCollectorConfig,
  downloadAndValidateCnmSalesReport,
  ensureCnmSession,
  getOrCreateCnmPage,
  launchCnmBrowser,
  parseCnmDownloadArgs,
  prepareCnmSalesReport,
  type CnmCollectorError,
} from '../src/integrations/cnm/collector'

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'cnm',
    event,
    ...details,
  }))
}

function printUsage() {
  console.log(
    'Uso: npm run cnm:download -- --date AAAA-MM-DD [--headed] [--replace]',
  )
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    return
  }

  const options = parseCnmDownloadArgs(process.argv.slice(2))
  const config = createCnmCollectorConfig()
  const context = await launchCnmBrowser(config, options.headed)
  const page = await getOrCreateCnmPage(context)

  log('started', { saleDate: options.saleDate, store: 'jc' })
  try {
    await ensureCnmSession(page, config)
    await prepareCnmSalesReport(page, options.saleDate, config)
    const result = await downloadAndValidateCnmSalesReport({
      page,
      config,
      saleDate: options.saleDate,
      replace: options.replace,
    })

    log('downloaded', {
      status: result.status,
      filePath: result.filePath,
      fileHash: result.fileHash,
    })
    log('validated', {
      items: result.report.items.length,
      totalQuantity: result.report.totalQuantity,
      calculatedNetTotal: result.report.calculatedNetTotal,
      reportedNetTotal: result.report.reportedNetTotal,
      warnings: result.report.warnings,
    })
  } catch (error: unknown) {
    const screenshotPath = await captureCnmFailure(page, config)
    const knownError = error as Partial<CnmCollectorError>
    log('failed', {
      code: knownError.code ?? 'erro_desconhecido',
      message: error instanceof Error ? error.message : 'Falha desconhecida.',
      evidencePath: knownError.evidencePath ?? screenshotPath,
    })
    throw error
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha desconhecida.'
  console.error(`Coleta CNM não concluída: ${message}`)
  process.exitCode = 1
})
