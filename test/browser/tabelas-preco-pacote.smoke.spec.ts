import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// Pacote fechado PJ na tabela de preço. Em 07/10/2026 um produto com regra de
// pacote de 12 entrou numa tabela com pack 1 e todo Pedido PJ dele travou com
// "O tamanho do pacote nao confere". Os dados da tela são simulados e toda
// gravação é interceptada: nada deste teste chega ao banco.

const adminEmail = 'rodrigao+teste@gmail.com'
const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const slowPreviewDataTimeoutMs = 15_000

const tierId = '98000000-0000-4000-8000-000000000001'
const customerId = '98000000-0000-4000-8000-000000000002'
const briocheId = '98000000-0000-4000-8000-000000000003'
const variantId = '98000000-0000-4000-8000-000000000004'
const saleOptionId = '98000000-0000-4000-8000-000000000005'
const freeProductId = '98000000-0000-4000-8000-000000000006'
const tierItemId = '98000000-0000-4000-8000-000000000007'

const packRule = {
  product_id: briocheId, product_variant_id: variantId,
  pack_size_units: 12, min_order_packs: 1, order_multiple_packs: 1,
}
const saleOption = {
  id: saleOptionId, product_id: briocheId, product_variant_id: variantId, name: 'Hambúrguer Unidade',
  sale_unit: 'un', reference_quantity: 1, unit_weight_kg: 0.08, active: true, is_default: true,
}
const wrongPackItem = {
  id: tierItemId, tier_id: tierId, product_id: briocheId, product_source: 'product',
  product_name: '[TESTE] Brioche · Hambúrguer', unit_price: 2.6, pricing_unit: 'un',
  pack_size: 1, active: true, sale_option_id: saleOptionId,
}

async function enterWithPreviewAccount(page: Page, email: string) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas fictícias existe somente no secret do GitHub.')
  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: slowPreviewDataTimeoutMs })
}

type Write = { method: string; url: string; body: unknown }

async function stubPriceTables(page: Page, items: unknown[], writes: Write[]) {
  await page.route('**/rest/v1/price_tiers*', route => route.fulfill({ json: [{
    id: tierId, name: '[TESTE] Tabela pacote fechado', description: null, active: true,
  }] }))
  await page.route('**/rest/v1/price_tier_items*', (route: Route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: items })
    writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
    // A correção do pack confere a linha devolvida. A tentativa de reativar
    // item inativo, feita antes de inserir, não encontra nada.
    const url = decodeURIComponent(request.url())
    return route.fulfill({ json: url.includes(`id=eq.${tierItemId}`) ? [{ id: tierItemId }] : [] })
  })
  await page.route('**/rest/v1/customers*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/customer_price_overrides*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/breads*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/products*', route => route.fulfill({ json: [
    { id: briocheId, name: '[TESTE] Brioche', unit: 'un', cost_price: 1, legacy_bread_id: null },
    { id: freeProductId, name: '[TESTE] Pão sem pacote', unit: 'un', cost_price: 1, legacy_bread_id: null },
  ] }))
  await page.route('**/rest/v1/product_sale_options*', route => route.fulfill({ json: [saleOption] }))
  await page.route('**/rest/v1/product_variants*', route => route.fulfill({ json: [{ id: variantId, name: 'Hambúrguer' }] }))
  await page.route('**/rest/v1/product_pj_pack_rules*', route => route.fulfill({ json: [packRule] }))
}

async function openTier(page: Page) {
  await page.goto('/tabelas-preco')
  await page.getByText('[TESTE] Tabela pacote fechado', { exact: true }).click({ timeout: slowPreviewDataTimeoutMs })
}

test('Tabelas de Preço trava o pack do produto com pacote fechado e corrige o valor errado', async ({ page }) => {
  await enterWithPreviewAccount(page, adminEmail)
  const writes: Write[] = []
  await stubPriceTables(page, [wrongPackItem], writes)
  await openTier(page)

  const row = page.locator('tr', { hasText: '[TESTE] Brioche · Hambúrguer' })
  await expect(row).toContainText('Está 1; o pacote fechado PJ é 12. O pedido PJ trava até ajustar.')
  await expect(row.locator('input[type="number"][min="1"]')).toHaveCount(0)

  await row.getByRole('button', { name: 'Ajustar para 12', exact: true }).click()
  await expect(row).not.toContainText('O pedido PJ trava')
  await expect(row).toContainText('pacote fechado PJ')
  await expect(row.getByRole('button', { name: 'Ajustar para 12', exact: true })).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(writes[0].method).toBe('PATCH')
  expect(decodeURIComponent(writes[0].url)).toContain(`id=eq.${tierItemId}`)
  expect(writes[0].body).toEqual({ pack_size: 12 })
})

test('incluir produto com pacote fechado grava o pack da regra; sem regra continua 1', async ({ page }) => {
  await enterWithPreviewAccount(page, adminEmail)
  const writes: Write[] = []
  await stubPriceTables(page, [], writes)
  await openTier(page)

  const search = page.getByPlaceholder('Buscar pão ou produto...')
  await search.fill('Brioche')
  // A opção de venda aparece como selo ao lado do nome, por isso sem exact.
  await page.getByText('[TESTE] Brioche · Hambúrguer').first().click()
  const inserts = () => writes.filter(write => write.method === 'POST')
  await expect.poll(() => inserts().length).toBe(1)
  expect(inserts()[0].body).toMatchObject({
    product_id: briocheId, sale_option_id: saleOptionId, pricing_unit: 'un', pack_size: 12,
  })
  // Item removido antes volta pela reativação, também com o pack da regra.
  expect(writes.find(write => write.method === 'PATCH')?.body).toEqual({ active: true, pack_size: 12 })

  await expect(search).toHaveValue('')
  await search.fill('sem pacote')
  await page.getByText('[TESTE] Pão sem pacote').first().click()
  await expect.poll(() => inserts().length).toBe(2)
  expect(inserts()[1].body).toMatchObject({ product_id: freeProductId, pack_size: 1 })
})

test('Pedido PJ avisa na linha e não envia quando a tabela do cliente tem o pacote errado', async ({ page }) => {
  await enterWithPreviewAccount(page, financeiroJc)
  let writeAttempts = 0
  await page.route('**/rest/v1/customers*', route => route.fulfill({ json: [{
    id: customerId, name: '[TESTE] Cliente pacote fechado', default_tier_id: tierId,
    discount_pct: 0, delivery_hours: 48, active: true,
  }] }))
  await page.route('**/rest/v1/price_tiers*', route => route.fulfill({ json: [{
    id: tierId, name: '[TESTE] Tabela pacote fechado',
  }] }))
  await page.route('**/rest/v1/price_tier_items*', route => route.fulfill({ json: [wrongPackItem] }))
  await page.route('**/rest/v1/customer_price_overrides*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/product_sale_options*', route => route.fulfill({ json: [saleOption] }))
  await page.route('**/rest/v1/product_pj_pack_rules*', route => route.fulfill({ json: [packRule] }))
  await page.route(/\/rest\/v1\/rpc\/(create|replace)_pj_order/, route => {
    writeAttempts += 1
    return route.fulfill({ status: 500, json: { message: 'não deveria chegar aqui' } })
  })

  await page.goto('/pedidos-pj?legado=1&novo=1')
  await page.locator('select').selectOption({ label: '[TESTE] Cliente pacote fechado' })
  const search = page.getByPlaceholder('Digite ou clique pra ver produtos da tabela')
  await search.fill('Brioche')
  await search.locator('..').locator('span').filter({ hasText: /^\[TESTE\] Brioche · Hambúrguer/ }).first().click()

  await expect(page.getByText(
    'Esta linha está com pacote de 1, mas o pacote fechado PJ é 12. O pedido não salva assim.',
    { exact: false },
  )).toBeVisible()
  await page.getByLabel('Pacotes de [TESTE] Brioche · Hambúrguer').fill('9')
  await expect(page.getByText('= 108 un · 8.64 kg')).toBeVisible()

  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
  await expect(page.getByText(
    'O pacote de "[TESTE] Brioche · Hambúrguer" não confere com o pacote fechado PJ.',
    { exact: false },
  ).first()).toBeVisible()
  expect(writeAttempts).toBe(0)
})
