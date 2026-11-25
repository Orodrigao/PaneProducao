import { expect, test } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

// O modo estrito do React no `next dev` do CI repete o efeito inicial. Atrasar
// uma segunda leitura expõe a carga descartada que faria o formulário sumir.
test('a carga inicial descartada não fecha o Novo Romaneio', async ({ page }) => {
  test.setTimeout(60_000)
  await entrarComSessaoGuardada(page, 'rodrigao+teste@gmail.com')

  let leituras = 0
  let concluirSegundaLeitura: () => void = () => undefined
  const segundaLeituraTerminou = new Promise<void>(resolve => { concluirSegundaLeitura = resolve })

  await page.route(
    url => url.pathname.endsWith('/rest/v1/romaneios') && url.searchParams.get('order') === 'created_at.desc',
    async route => {
      if (route.request().method() !== 'GET') return route.continue()
      leituras += 1
      if (leituras === 2) {
        page.on('requestfinished', request => {
          if (request === route.request()) concluirSegundaLeitura()
        })
        await new Promise(resolve => setTimeout(resolve, 3_000))
      }
      await route.continue()
    },
  )

  await page.goto('/romaneio')
  const novoRomaneio = page.getByRole('button', { name: /Novo romaneio/i }).first()
  await expect(novoRomaneio).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.ps-loading-overlay')).toHaveCount(0)
  await novoRomaneio.click()
  const campoData = page.locator('input[type="date"]').first()
  await expect(campoData).toBeVisible()

  await Promise.race([
    segundaLeituraTerminou,
    new Promise(resolve => setTimeout(resolve, 4_000)),
  ])
  if (leituras >= 2) await segundaLeituraTerminou
  // Deixa a página processar a resposta antes de conferir a tela escolhida.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  await expect(campoData).toBeVisible()
  expect(leituras, 'a carga inicial deve ler os romaneios do dia uma única vez').toBe(1)
})
