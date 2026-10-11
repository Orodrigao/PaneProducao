import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// A aba "Itens JC" (lista manual dos não-pães da JC) saiu em 11/10/2026: não
// tinha lançamento desde 16/06 e, ao salvar o dia, apagava as linhas dos
// produtos que ela não mostrava. Estes roteiros só leem; nada é gravado.

const previewAccounts = {
  admin: 'rodrigao+teste@gmail.com',
  geolarJc: 'rodrigao+teste-geolar-jc@gmail.com',
} as const

const visualBreadId = 'teste-tela-inicial-pao'
const visualBreadName = '[TESTE] Pão visual da tela inicial'

async function enterWithPreviewAccount(page: import('@playwright/test').Page, email: string) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

test('Administrador ve JC, JA, Relatorio e Admin na tela inicial, sem Itens JC', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/')

  const tabs = page.getByRole('tablist').getByRole('tab')
  await expect(tabs).toHaveText(['JC', 'JA', 'Relatório', 'Admin'], { timeout: 30_000 })

  // As abas que vinham depois da que saiu continuam abrindo o próprio conteúdo.
  const report = page.getByRole('tab', { name: 'Relatório', exact: true })
  await report.click()
  await expect(report).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '↻ Atualizar' })).toBeVisible({ timeout: 15_000 })

  const admin = page.getByRole('tab', { name: 'Admin', exact: true })
  await admin.click()
  await expect(admin).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Copiar para WhatsApp' })).toBeVisible()
})

async function mockGeolarSheet(page: import('@playwright/test').Page) {
  // O Banco Preview guarda de propósito uma sobra pendente que trava esta tela
  // (ver auth.smoke). Aqui a trava responde "nada pendente" e a folha recebe um
  // pão fictício com pedido nas três lojas; o resto vem do banco de teste.
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/breads*', route => route.fulfill({
    json: [{ id: visualBreadId, name: visualBreadName, days: [1, 2, 3, 4, 5, 6], active: true, is_pj: false }],
  }))
  await page.route('**/rest/v1/orders*', route => {
    const url = decodeURIComponent(route.request().url())
    if (url.includes('order_type=eq.encomenda')) return route.fulfill({ json: [] })
    return route.fulfill({
      json: (['ex', 'jc', 'ja'] as const).map((store, index) => ({
        store, bread_id: visualBreadId, quantity: index + 1, obs: '', order_date: '2026-10-12',
      })),
    })
  })
  // Imprimir e copiar ficam registrados na página, sem abrir janela nem mexer
  // na área de transferência da máquina do CI. Cada impressão guarda o total do
  // pão fictício como estava na folha naquele instante.
  await page.addInitScript(breadName => {
    const record = window as Window & { __prints?: number; __printedTotals?: string[]; __copied?: string }
    record.__prints = 0
    record.__printedTotals = []
    window.print = () => {
      record.__prints = (record.__prints ?? 0) + 1
      const row = Array.from(document.querySelectorAll('.print-row'))
        .find(candidate => candidate.textContent?.includes(breadName))
      record.__printedTotals?.push(row?.querySelector('.ptotal')?.textContent ?? '')
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { record.__copied = text } },
    })
  }, visualBreadName)
}

function printCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __prints?: number }).__prints)
}

function printedTotals(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __printedTotals?: string[] }).__printedTotals)
}

// Conexão parada sem erro: ao abrir, a tela recebe 5 PJ do pão fictício. A
// partir do clique, a primeira leitura do PJ fica sem resposta até o fim do
// teste; as seguintes respondem com 8 PJ, como depois de uma programação nova.
async function stallPjAfterOpening(page: import('@playwright/test').Page) {
  const pj = { stalled: false, calls: 0, release: (): void => undefined }
  const released = new Promise<void>(resolve => { pj.release = resolve })
  page.once('close', () => pj.release())
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', async route => {
    if (!pj.stalled) return route.fulfill({ json: [{ bread_id: visualBreadId, quantity: 5 }] })
    pj.calls += 1
    if (pj.calls > 1) return route.fulfill({ json: [{ bread_id: visualBreadId, quantity: 8 }] })
    await released
    await route.fulfill({ json: [] }).catch(() => undefined)
  })
  return pj
}

async function openGeolarWithPj(page: import('@playwright/test').Page) {
  await enterWithPreviewAccount(page, previewAccounts.geolarJc)
  await page.goto('/')

  // O rótulo muda durante a espera; o localizador aceita os dois.
  const printBreads = page.getByRole('button', { name: /Imprimir pães|Preparando impressão/ })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadTotal = page.locator('.print-row', { hasText: visualBreadName }).locator('.ptotal')
  await expect(breadTotal).toHaveText('11 (5 PJ)')
  return { printBreads, breadTotal }
}

test('Geolar imprime e copia a folha de paes, sem bloco de Itens JC', async ({ page }) => {
  await mockGeolarSheet(page)
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({ json: [] }))

  await enterWithPreviewAccount(page, previewAccounts.geolarJc)
  await page.goto('/')

  const printBreads = page.getByRole('button', { name: '🖨 Imprimir pães' })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadRow = page.locator('.print-row', { hasText: visualBreadName })
  await expect(breadRow.locator('.ptotal')).toHaveText('6')
  await expect(page.getByText(/Itens JC/)).toHaveCount(0)

  await printBreads.click()
  await expect.poll(() => printCount(page)).toBe(1)
  expect(await printedTotals(page)).toEqual(['6'])

  // No papel fica a folha; a barra do topo e os botões somem.
  await page.emulateMedia({ media: 'print' })
  await expect(breadRow).toBeVisible()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(printBreads).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  const copied = () => page.evaluate(() => (window as Window & { __copied?: string }).__copied ?? '')
  await page.getByRole('button', { name: '📋 Copiar texto' }).click()
  await expect.poll(copied).toContain(`${visualBreadName}  1+2+3`)
  expect(await copied()).toMatch(/^\*Pane & Salute — Produção /)
  expect(await copied()).not.toContain('Itens JC')
})

test('Geolar imprime com o que esta na tela quando a leitura do PJ para sem erro', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  const pj = await stallPjAfterOpening(page)
  const { printBreads, breadTotal } = await openGeolarWithPj(page)

  pj.stalled = true
  await printBreads.click()
  // Soft: no código antigo o botão não muda, e o relatório ainda mostra que a
  // impressão não saiu, que é o defeito que este roteiro guarda.
  await expect.soft(printBreads).toHaveText('Preparando impressão…')
  await expect.soft(printBreads).toBeDisabled()

  await expect.poll(() => printCount(page), { timeout: 15_000 }).toBe(1)
  expect(pj.calls).toBe(1)
  expect(await printedTotals(page)).toEqual(['11 (5 PJ)'])
  await expect(printBreads).toHaveText('🖨 Imprimir pães')
  await expect(printBreads).toBeEnabled()

  // A resposta atrasada chega depois: atualiza a tela e não imprime de novo.
  pj.release()
  await expect(breadTotal).toHaveText('6')
  await page.waitForTimeout(1_000)
  expect(await printCount(page)).toBe(1)
})

test('Geolar imprime com a programacao PJ feita durante a espera, sem esperar a leitura parada', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  const pj = await stallPjAfterOpening(page)
  const { printBreads, breadTotal } = await openGeolarWithPj(page)

  pj.stalled = true
  await printBreads.click()
  await expect.poll(() => pj.calls).toBe(1)

  // Nova programação PJ enquanto a leitura do botão está parada: a folha sai
  // com ela assim que chega, bem antes do prazo de 5 segundos.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pj-production-scheduled')))
  await expect.poll(() => printCount(page), { timeout: 3_000 }).toBe(1)
  expect(pj.calls).toBe(2)
  expect(await printedTotals(page)).toEqual(['14 (8 PJ)'])

  // A leitura antiga, quando enfim responde, é descartada: a tela fica com a
  // programação nova e nada é impresso de novo.
  pj.release()
  await page.waitForTimeout(1_000)
  await expect(breadTotal).toHaveText('14 (8 PJ)')
  expect(await printCount(page)).toBe(1)
})
