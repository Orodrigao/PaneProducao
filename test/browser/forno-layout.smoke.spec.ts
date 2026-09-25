import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

const authorizedEmail = 'rodrigao+teste@gmail.com'
const visualProductId = 'teste-layout-forno'
const visualProductName = '[TESTE] Produto visual do Forno'

async function enterWithPreviewAccount(page: import('@playwright/test').Page) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha da conta ficticia existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(authorizedEmail)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

async function stubPlannedProduct(page: import('@playwright/test').Page, confirmed = false) {
  await page.route('**/rest/v1/orders*', route => {
    const url = decodeURIComponent(route.request().url())
    return route.fulfill({
      json: url.includes('order_type=eq.producao')
        ? [{ id: 'pedido-visual', bread_id: visualProductId, quantity: 12, store: 'jc' }]
        : [],
    })
  })
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/production_actuals*', route => {
    const requestedDate = new URL(route.request().url()).searchParams.get('record_date')?.replace(/^eq\./, '')
    return route.fulfill({
      json: confirmed
        ? [{
            id: 'realizado-visual', bread_id: visualProductId, product_source: 'bread',
            product_id: visualProductId, product_variant_id: null, product_name: visualProductName,
            production_unit: 'un', record_date: requestedDate, lot_code: 'L-visual',
            quantity_baked: 9, quantity_loss: 2, loss_reason: 'Queimou', obs: null,
          }]
        : [],
    })
  })
  await page.route('**/rest/v1/breads*', route => route.fulfill({
    json: [{ id: visualProductId, name: visualProductName, unit: 'un' }],
  }))
}

async function expectResponsiveLayout(page: import('@playwright/test').Page) {
  const title = page.getByRole('heading', { name: 'Forno', exact: true })
  const dateGroup = page.getByRole('group', { name: 'Data da produção' })

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(title).toBeVisible()

    const hasNoHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(hasNoHorizontalOverflow, `sem rolagem horizontal em ${viewport.width}px`).toBe(true)

    const dateButtonsHaveTouchSize = await dateGroup.getByRole('button').evaluateAll(
      buttons => buttons.every(button => button.getBoundingClientRect().height >= 44),
    )
    expect(dateButtonsHaveTouchSize, `alvos de toque com pelo menos 44px em ${viewport.width}px`).toBe(true)
  }
}

test('Forno mantém cartões, editor e escolha do dia acessíveis em várias larguras', async ({ page }) => {
  await enterWithPreviewAccount(page)
  await stubPlannedProduct(page)
  await page.goto('/forno')

  const title = page.getByRole('heading', { name: 'Forno', exact: true })
  await expect(page.locator('.ps-loading')).toHaveCount(0, { timeout: 30_000 })
  await expect(title).toBeVisible()

  const card = page.locator('article').filter({ hasText: visualProductName })
  await expect(card).toContainText('Previsto')
  await expect(card.getByRole('button', { name: 'Confirmar 12', exact: true })).toBeVisible()

  const dateGroup = page.getByRole('group', { name: 'Data da produção' })
  await expect(dateGroup.getByRole('button')).toHaveCount(8)
  await page.getByRole('button', { name: 'Ontem', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ontem', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectResponsiveLayout(page)

  await card.getByRole('button', { name: 'Ajustar ou informar perda' }).click()
  await expect(card.getByLabel('Saída boa')).toBeVisible()
  await expect(card.getByLabel('Perda no forno')).toBeVisible()
  await card.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(card.getByLabel('Saída boa')).toHaveCount(0)
})

test('Forno diferencia uma saída já confirmada', async ({ page }) => {
  await enterWithPreviewAccount(page)
  await stubPlannedProduct(page, true)
  await page.goto('/forno')

  const card = page.locator('article').filter({ hasText: visualProductName })
  await expect(card).toContainText('9 bons')
  await expect(card).toContainText('2 de perda · Queimou')
  await expect(card.getByRole('button', { name: 'Corrigir confirmação' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Confirmar 12' })).toHaveCount(0)
})

test('Forno mostra estado vazio quando a data não tem produção prevista', async ({ page }) => {
  await enterWithPreviewAccount(page)
  await stubPlannedProduct(page)
  await page.route('**/rest/v1/orders*', route => route.fulfill({ json: [] }))
  await page.goto('/forno')

  await expect(page.getByText(/Nenhum produto de Forno previsto para/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Forno', exact: true })).toBeVisible()
})

test('Forno permite tentar novamente depois de erro ao carregar', async ({ page }) => {
  await enterWithPreviewAccount(page)
  await stubPlannedProduct(page)

  let failFirstLoad = true
  await page.route('**/rest/v1/orders*', async route => {
    const url = decodeURIComponent(route.request().url())
    if (failFirstLoad && url.includes('order_type=eq.producao')) {
      failFirstLoad = false
      await route.fulfill({ status: 500, contentType: 'application/json', json: { message: 'falha simulada' } })
      return
    }
    await route.fulfill({
      json: url.includes('order_type=eq.producao')
        ? [{ id: 'pedido-visual', bread_id: visualProductId, quantity: 12, store: 'jc' }]
        : [],
    })
  })
  await page.route('**/rest/v1/production_actuals*', route => route.fulfill({ json: [] }))
  await page.goto('/forno')

  const error = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o forno.' })
  await expect(error).toBeVisible()
  await error.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('article').filter({ hasText: visualProductName })).toBeVisible()
})
