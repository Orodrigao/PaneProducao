import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  CNM_BASE_URL,
  createCnmCollectorConfig,
  ensureCnmSession,
  getOrCreateCnmPage,
  launchCnmBrowser,
} from '../src/integrations/cnm/collector'

async function main() {
  const config = createCnmCollectorConfig()
  const context = await launchCnmBrowser(config, true)
  const terminal = createInterface({ input: stdin, output: stdout })

  try {
    const page = await getOrCreateCnmPage(context)
    await page.goto(CNM_BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutMs,
    })
    stdout.write(
      '\nFaça login no CNM na janela aberta. Nenhuma senha será salva no código.\n',
    )
    await terminal.question(
      'Quando a tela inicial do CNM estiver visível, pressione Enter aqui... ',
    )
    await ensureCnmSession(page, config)
    stdout.write(`\nSessão CNM validada e salva localmente em ${config.profileDir}.\n`)
  } finally {
    terminal.close()
    await context.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha desconhecida.'
  console.error(`Falha ao preparar a sessão CNM: ${message}`)
  process.exitCode = 1
})
