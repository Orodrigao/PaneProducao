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

test('Geolar imprime e copia a folha de paes, sem bloco de Itens JC', async ({ page }) => {
  // O Banco Preview guarda de propósito uma sobra pendente que trava esta tela
  // (ver auth.smoke). Aqui a trava responde "nada pendente" e a folha recebe um
  // pão fictício com pedido nas três lojas; o resto vem do banco de teste.
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({ json: [] }))
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
  // na área de transferência da máquina do CI.
  await page.addInitScript(() => {
    const record = window as Window & { __prints?: number; __copied?: string }
    record.__prints = 0
    window.print = () => { record.__prints = (record.__prints ?? 0) + 1 }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { record.__copied = text } },
    })
  })

  await enterWithPreviewAccount(page, previewAccounts.geolarJc)
  await page.goto('/')

  const printBreads = page.getByRole('button', { name: '🖨 Imprimir pães' })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadRow = page.locator('.print-row', { hasText: visualBreadName })
  await expect(breadRow.locator('.ptotal')).toHaveText('6')
  await expect(page.getByText(/Itens JC/)).toHaveCount(0)

  await printBreads.click()
  const prints = () => page.evaluate(() => (window as Window & { __prints?: number }).__prints)
  await expect.poll(prints).toBe(1)

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
