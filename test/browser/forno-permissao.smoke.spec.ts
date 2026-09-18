import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// O smoke obrigatório do repositório roda no banco Preview compartilhado, que
// espelha a main e ainda não recebeu a migration desta PR. A separação nova
// entre operador e planejador é provada no pgTAP contra a história da branch;
// aqui confirmamos a tela real para um perfil autorizado e a rota negada.
const authorizedEmail = 'rodrigao+teste@gmail.com'
const blockedEmail = 'rodrigao+teste-vendas-ja@gmail.com'

async function enterWithPreviewAccount(
  page: import('@playwright/test').Page,
  email: string,
) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

test('perfil autorizado carrega a programacao do Forno', async ({ page }) => {
  await enterWithPreviewAccount(page, authorizedEmail)
  await page.goto('/forno')

  await expect(page.locator('.ps-loading')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Pane & Salute', { exact: true })).toBeVisible()
  await expect(page.getByText('Forno', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Não foi possível carregar o forno.', { exact: true })).toHaveCount(0)
})

test('Forno avisa falta potencial sem criar reposicao para o PJ', async ({ page }) => {
  await enterWithPreviewAccount(page, authorizedEmail)

  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({
    json: [{
      product_source: 'bread', product_id: 'teste-alerta-pj', product_variant_id: null,
      product_name: '[TESTE] Alerta PJ', production_unit: 'un', quantity: 4,
      needs_weight_setup: false,
    }],
  }))
  await page.route('**/rest/v1/orders*', route => {
    const url = decodeURIComponent(route.request().url())
    return route.fulfill({
      json: url.includes('order_type=eq.producao')
        ? [{ id: 'pedido-loja', bread_id: 'teste-alerta-pj', quantity: 6 }]
        : [],
    })
  })
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/production_actuals*', route => route.fulfill({
    json: [{
      id: 'realizado-alerta', bread_id: 'teste-alerta-pj', product_source: 'bread',
      product_id: 'teste-alerta-pj', product_variant_id: null, product_name: '[TESTE] Alerta PJ',
      production_unit: 'un', record_date: '2026-09-18', lot_code: 'L0918',
      quantity_baked: 8, quantity_loss: 2, loss_reason: 'Queimou', obs: null,
    }],
  }))
  await page.route('**/rest/v1/breads*', route => route.fulfill({
    json: [{ id: 'teste-alerta-pj', name: '[TESTE] Alerta PJ', unit: 'un' }],
  }))

  await page.goto('/forno')

  const pjShortageAlert = page.getByRole('alert', { name: /Atenção: este produto tem/ })
  await expect(pjShortageAlert).toContainText('tem 4 un na programação PJ')
  await expect(pjShortageAlert).toContainText('faltaram 2 un no total confirmado')
  await expect(pjShortageAlert).toContainText('O sistema não cria reposição')
  await expect(pjShortageAlert).toContainText('será necessário um novo pedido PJ')
})

test('perfil sem permissao continua fora do Forno', async ({ page }) => {
  await enterWithPreviewAccount(page, blockedEmail)
  await page.goto('/forno')

  await expect(page).not.toHaveURL(/\/forno(?:[?#]|$)/, { timeout: 15_000 })
  await expect(page.getByText('Forno', { exact: true })).toHaveCount(0)
})
