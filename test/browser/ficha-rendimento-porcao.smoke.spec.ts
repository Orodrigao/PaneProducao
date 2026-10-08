import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// A ficha divide a mesma receita pela massa crua de cada variante. Os dados
// do produto são simulados (Brioche fictício com 1,048 kg de massa e CMV de
// R$ 4,692); o login é real, com a conta de administrador do Preview. As
// gravações são interceptadas para conferir exatamente o que viajaria ao banco.
const adminEmail = 'rodrigao+teste@gmail.com'
const productId = 'teste-brioche-porcao'

async function enterWithPreviewAccount(page: Page, email: string) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

const parent = {
  id: productId, name: '[TESTE] Brioche', kind: 'final', category: 'Pães', unit: 'un',
  cost_price: null, is_revenda: false, is_fabricacao_propria: true,
}
const catalog = [
  { ...parent, active: true, legacy_bread_id: null },
  { id: 'teste-farinha', name: '[TESTE] Farinha de Trigo', cost_price: 5, unit: 'kg', category: 'INSUMOS', kind: 'insumo', active: true, is_fabricacao_propria: false, legacy_bread_id: null },
  { id: 'teste-leite', name: '[TESTE] Leite', cost_price: 4, unit: 'kg', category: 'INSUMOS', kind: 'insumo', active: true, is_fabricacao_propria: false, legacy_bread_id: null },
]
const components = [
  { id: 'c-farinha', parent_product_id: productId, component_source: 'product', component_id: 'teste-farinha', component_variant_id: null, quantity: 0.5 },
  { id: 'c-leite', parent_product_id: productId, component_source: 'product', component_id: 'teste-leite', component_variant_id: null, quantity: 0.548 },
]
const variants = [
  { id: 'v-hamb', product_id: productId, name: 'Hambúrguer', sort_order: 0, active: true },
  { id: 'v-forma', product_id: productId, name: 'Forma', sort_order: 1, active: true },
  { id: 'v-mini', product_id: productId, name: 'Mini', sort_order: 2, active: true },
]

function yieldRow(row: Record<string, unknown>) {
  const dough = row.dough_weight_kg as number | null
  const finished = row.finished_weight_kg as number | null
  const units = row.yield_units as number | null
  return {
    batch_name: null, notes: null, created_at: '2026-10-01T00:00:00Z', updated_at: null,
    ...row,
    average_unit_weight_kg: finished !== null && units ? finished / units : null,
    bake_loss_pct: dough && finished !== null ? ((dough - finished) / dough) * 100 : null,
  }
}

// Ficha antiga: Hambúrguer gravado como "produto assado" (0,96 kg em 12 un) e
// Forma com 400 g; Mini sem rendimento.
const storedYields = [
  yieldRow({ id: 'y-hamb', product_id: productId, product_variant_id: 'v-hamb', basis: 'baked', dough_weight_kg: null, finished_weight_kg: 0.96, yield_units: 12 }),
  yieldRow({ id: 'y-forma', product_id: productId, product_variant_id: 'v-forma', basis: 'dough', dough_weight_kg: 1.048, finished_weight_kg: 1.048, yield_units: 2.62 }),
]

interface CapturedWrite { method: string; url: string; body: Record<string, unknown> }

async function mockRecipe(page: Page, writes: CapturedWrite[]) {
  await page.route(/\/rest\/v1\/products\?/, route => {
    const url = decodeURIComponent(route.request().url())
    return route.fulfill({ json: url.includes(`id=eq.${productId}`) ? parent : catalog })
  })
  await page.route(/\/rest\/v1\/product_components\?/, route => route.fulfill({ json: components }))
  await page.route(/\/rest\/v1\/breads\?/, route => route.fulfill({ json: [] }))
  await page.route(/\/rest\/v1\/product_variants\?/, route => route.fulfill({ json: variants }))
  await page.route(/\/rest\/v1\/product_sale_options\?/, async (route: Route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), url: decodeURIComponent(request.url()), body: request.postDataJSON() })
    }
    return route.fulfill({ json: [] })
  })
  await page.route(/\/rest\/v1\/product_recipe_yields\?/, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: storedYields })
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push({ method: request.method(), url: decodeURIComponent(request.url()), body })
    const id = request.method() === 'PATCH'
      ? (decodeURIComponent(request.url()).match(/id=eq\.([^&]+)/)?.[1] ?? 'y-novo')
      : `y-novo-${String(body.product_variant_id)}`
    return route.fulfill({ json: yieldRow({ ...body, id }) })
  })
}

function rowCard(page: Page, label: string) {
  return page.getByRole('group', { name: `Rendimento: ${label}`, exact: true })
}

test('ficha calcula rendimento por massa crua de cada variante e grava só as linhas alteradas', async ({ page }) => {
  await enterWithPreviewAccount(page, adminEmail)
  const writes: CapturedWrite[] = []
  await mockRecipe(page, writes)

  await page.goto(`/produtos/composicao?id=${productId}`)
  await expect(page.locator('.ps-loading')).toHaveCount(0, { timeout: 30_000 })

  // Ficha antiga abre igual: o número gravado vira massa crua e nada fica "não salvo".
  await expect(page.getByLabel('Massa crua em gramas: Hambúrguer', { exact: true })).toHaveValue('80')
  await expect(page.getByLabel('Massa crua em gramas: Forma', { exact: true })).toHaveValue('400')
  await expect(page.getByLabel('Massa crua em gramas: Mini', { exact: true })).toHaveValue('')
  await expect(rowCard(page, 'Hambúrguer')).toContainText('rende 13,1 un')
  await expect(rowCard(page, 'Hambúrguer')).toContainText(/CMV\/un R\$\s0,36/)
  await expect(rowCard(page, 'Forma')).toContainText('rende 2,62 un')
  await expect(page.getByRole('button', { name: /^Salvar rendimento/ })).toBeDisabled()
  await expect(page.getByText('nada alterado para salvar')).toBeVisible()

  // Peso assado só mostra a perda: o rendimento continua pela massa crua.
  await page.getByLabel('Peso assado em gramas: Hambúrguer', { exact: true }).fill('72')
  await expect(rowCard(page, 'Hambúrguer')).toContainText('rende 13,1 un')
  await expect(rowCard(page, 'Hambúrguer')).toContainText('perda de forno 10%')
  await expect(rowCard(page, 'Hambúrguer')).toContainText('pronto 72 g')

  // Assado maior que a massa é recusado e nada vai ao banco.
  await page.getByLabel('Peso assado em gramas: Hambúrguer', { exact: true }).fill('90')
  await expect(rowCard(page, 'Hambúrguer')).toContainText('pão não ganha peso no forno')
  await page.getByRole('button', { name: /^Salvar rendimento/ }).click()
  expect(writes).toHaveLength(0)

  await page.getByLabel('Peso assado em gramas: Hambúrguer', { exact: true }).fill('72')
  await page.getByLabel('Massa crua em gramas: Mini', { exact: true }).fill('30')
  await expect(rowCard(page, 'Mini')).toContainText('rende 34,93 un')
  await page.getByRole('button', { name: 'Salvar rendimento (2)' }).click()
  await expect(page.getByText('nada alterado para salvar')).toBeVisible()

  const yieldWrites = writes.filter(write => write.url.includes('product_recipe_yields'))
  expect(yieldWrites).toHaveLength(2)
  const hamburguer = yieldWrites.find(write => write.method === 'PATCH')
  expect(hamburguer?.url).toContain('id=eq.y-hamb')
  expect(hamburguer?.body).toMatchObject({ product_variant_id: 'v-hamb', basis: 'dough', dough_weight_kg: 1.048 })
  expect(hamburguer?.body.yield_units as number).toBeCloseTo(13.1, 6)
  expect(hamburguer?.body.finished_weight_kg as number).toBeCloseTo(0.072 * 13.1, 6)
  const mini = yieldWrites.find(write => write.method === 'POST')
  expect(mini?.body).toMatchObject({ product_variant_id: 'v-mini', basis: 'dough', dough_weight_kg: 1.048, finished_weight_kg: 1.048 })
  expect(mini?.body.yield_units as number).toBeCloseTo(1.048 / 0.03, 6)
  expect(yieldWrites.some(write => write.url.includes('y-forma'))).toBe(false)

  // Peso de venda por unidade acompanha o pão pronto de cada linha gravada.
  const saleWrites = writes.filter(write => write.url.includes('product_sale_options'))
  expect(saleWrites.find(write => write.url.includes('product_variant_id=eq.v-hamb'))?.body.unit_weight_kg as number).toBeCloseTo(0.072, 6)
  expect(saleWrites.find(write => write.url.includes('product_variant_id=eq.v-mini'))?.body.unit_weight_kg as number).toBeCloseTo(0.03, 6)

  // Depois de salvar, a tela relê o que voltou do banco.
  await expect(page.getByLabel('Peso assado em gramas: Hambúrguer', { exact: true })).toHaveValue('72')
  await expect(page.getByLabel('Massa crua em gramas: Mini', { exact: true })).toHaveValue('30')
})
