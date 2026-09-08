import { expect, test } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

// Login espelhado de auth.smoke.spec.ts de propósito: aquele arquivo pertence
// à frente de contas a pagar e importar de um spec acoplaria os dois.
const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

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

// Fase 0 de contas a receber: somente leitura, para o cenario compartilhado do
// Preview sobreviver a duas execucoes seguidas sem reconstruir o banco.
test('Financeiro JC ve o cenario semeado de Pedidos PJ e o total do relatorio', async ({ page }) => {
  await enterWithPreviewAccount(page, financeiroJc)

  await page.goto('/pedidos-pj?legado=1')

  // Aba "Em aberto" e a padrao: os dois pedidos abertos do seed, com valor.
  const bistroAberto = page.locator('.pj-order-row', { hasText: '[TESTE] Bistro Cliente PJ' })
  await expect(bistroAberto).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(bistroAberto).toContainText('R$ 403.20')

  const cafeAberto = page.locator('.pj-order-row', { hasText: '[TESTE] Cafe Cliente PJ' })
  await expect(cafeAberto).toBeVisible()
  await expect(cafeAberto).toContainText('R$ 400.50')

  // O Historico guarda o enviado e o cancelado, cada um com seu selo.
  // A aba se chamava Histórico até 07/09: o nome prometia arquivo morto e é
  // onde mora a correção que ainda mexe em dinheiro.
  await page.getByRole('button', { name: /Fechados/ }).click()

  const enviado = page.locator('.pj-order-row.is-dispatched', { hasText: '[TESTE] Bistro Cliente PJ' })
  await expect(enviado).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(enviado).toContainText('R$ 76.80')

  await expect(
    page.locator('.pj-order-row.is-cancelled', { hasText: '[TESTE] Cafe Cliente PJ' }),
  ).toBeVisible()

  // Abrir o enviado mostra selo e itens: o dado que entrou volta a aparecer.
  await enviado.click()
  await expect(page.getByRole('heading', { name: /Bistro Cliente PJ/ })).toBeVisible()
  // A etiqueta mudou de ENVIADO para PRONTO PARA ENTREGA em 04/09: a
  // Expedicao confere ANTES de o pao sair, entao "enviado" descrevia um
  // fato que ainda nao tinha acontecido.
  await expect(page.getByText('PRONTO PARA ENTREGA', { exact: true })).toBeVisible()
  await expect(page.getByText('[TESTE] Brioche PJ').first()).toBeVisible()
  const ficha = page.getByRole('dialog', { name: 'Ficha do pedido PJ' })
  await expect(ficha.getByRole('region', { name: 'Situação financeira' })).toBeVisible()
  await expect(ficha.getByRole('region', { name: 'Andamento do pedido' })).toContainText('Pronto para entrega registrado')
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })

  // Relatorio de Vendas PJ: o preset padrao vai de 29 dias atras ate hoje e
  // soma pela data de entrega. Os pedidos em aberto entregam DEPOIS DE AMANHA —
  // de proposito, e nao amanha: a janela deste relatorio nasce do relogio do
  // NAVEGADOR, que no CI conta em UTC, enquanto o seed conta na hora da
  // padaria. Depois das 21h os dois discordam por um dia, e um pedido de
  // "amanha" cairia dentro da janela (licao seed-com-hoje-vence-a-meia-noite). Sobram o enviado (76,80) e o entregue de
  // cliente sem prazo (96,00) = 172,80; o cancelado nunca entra.
  await page.goto('/relatorios/pj')
  await expect(page.getByRole('heading', { name: /Vendas PJ/ })).toBeVisible()
  await expect(page.getByText('Vendas totais')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  // O total aparece no cartao, no resumo e na tabela: basta encontra-lo uma vez.
  await expect(page.getByText(/172,80/).first()).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
})

// Dados fictícios apenas na resposta do navegador, sem gravar no banco compartilhado.
function longOrderRows() {
  return Array.from({ length: 601 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    order_group_id: '00000000-0000-4000-8000-999999999999', customer_id: null,
    pj_client: '[TESTE] Pedido antigo completo', order_date: '2026-01-01', delivery_date: '2026-01-02', production_date: null,
    bread_id: `p${i}`, product_source: 'product', product_name: `Item fictício ${i + 1}`,
    quantity: 1, unit_price: 2, pack_size: 1, pricing_unit: 'un', sale_option_id: null,
    obs: null, cancelled_at: null, cancelled_by: null, cancel_reason: null,
    dispatched_at: null, dispatched_by: null, dispatched_by_name: null,
    dispatched_quantity: null, dispatched_quantity_reason: null, dispatched_quantity_at: null, dispatched_quantity_by_name: null,
  }))
}

test('ficha no celular encontra pedido antigo e todos os 601 itens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterWithPreviewAccount(page, financeiroJc)
  const rows = longOrderRows()
  await page.route('**/rest/v1/orders?**', async route => {
    const query = new URL(route.request().url()).searchParams
    const from = Number(query.get('offset') || 0)
    const data = rows.slice(from, from + Number(query.get('limit') || 200))
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `${from}-${from + data.length - 1}/${rows.length}`, 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(data) })
  })
  await page.goto('/pedidos-pj?legado=1')
  await page.getByRole('button', { name: /Pendências/ }).click()
  await page.getByPlaceholder('Buscar cliente em todos os pedidos').fill('Pedido antigo completo')
  await page.locator('.pj-order-row', { hasText: '[TESTE] Pedido antigo completo' }).click()
  const ficha = page.getByRole('dialog', { name: 'Ficha do pedido PJ' })
  await expect(ficha).toContainText('Itens do pedido · 601')
  await expect(ficha).toContainText('Item fictício 601')
  await expect(ficha).toContainText('Data combinada passou')
  await expect(ficha).not.toContainText('PRONTO PARA ENTREGA')
})

test('falha na segunda página não deixa abrir ficha parcial', async ({ page }) => {
  await enterWithPreviewAccount(page, financeiroJc)
  await page.route('**/rest/v1/orders?**', async route => {
    const from = Number(new URL(route.request().url()).searchParams.get('offset') || 0)
    if (from > 0) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Falha fictícia de leitura' }) })
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-199/601', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(longOrderRows().slice(0, 200)) })
  })
  await page.goto('/pedidos-pj?pedido=00000000-0000-4000-8000-999999999999')
  await expect(page.getByText('Não foi possível carregar os Pedidos PJ. Verifique a internet e tente novamente.')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.pj-order-row')).toHaveCount(0)
})

test('Expedição JC abre a ficha sem buscar ou mostrar valores financeiros', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterWithPreviewAccount(page, 'rodrigao+teste-expedicao-jc@gmail.com')
  const financialRequests: string[] = []
  page.on('request', request => {
    if (/\/rest\/v1\/(receivables|receivable_receipts)(?:\?|$)/.test(request.url())) financialRequests.push(request.url())
  })
  await page.goto('/pedidos-pj?legado=1')
  await page.locator('.pj-order-row').first().click({ timeout: slowPreviewDataTimeoutMs })
  const ficha = page.getByRole('dialog', { name: 'Ficha do pedido PJ' })
  await expect(ficha).toBeVisible()
  await expect(ficha).toContainText('Itens do pedido')
  await expect(ficha).not.toContainText('R$')
  await expect(ficha).not.toContainText('Cobrança e recebimentos')
  expect(financialRequests).toEqual([])
})
