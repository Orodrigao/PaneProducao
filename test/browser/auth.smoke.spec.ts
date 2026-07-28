import { expect, test } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

const previewAccounts = {
  admin: 'rodrigao+teste@gmail.com',
  vendasJa: 'rodrigao+teste-vendas-ja@gmail.com',
  romaneioEx: 'rodrigao+teste-romaneio-ex@gmail.com',
  cozinhaJc: 'rodrigao+teste-cozinha-jc@gmail.com',
} as const

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

async function expectRouteVisible(page: import('@playwright/test').Page, href: string) {
  await expect(page.locator(`a[href="${href}"]`).first()).toBeAttached()
}

async function expectRouteHidden(page: import('@playwright/test').Page, href: string) {
  await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0)
}

test('quem nao entrou e levado ao login ao abrir uma tela protegida', async ({ page }) => {
  await page.goto('/sobras')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Pane & Salute' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
})

test('administrador encontra JC e JA ao registrar Sobras', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/sobras')

  await expect(page.getByRole('heading', { name: /O que registrar/ })).toBeVisible()
  await page.getByText('Registrar Sobras', { exact: true }).click()

  const storeSelector = page.locator('.ps-card', { hasText: 'Loja:' }).locator('select.ps-select')
  await expect(storeSelector).toBeVisible()
  await expect(storeSelector.locator('option')).toHaveText([
    'JC — Júlio de Castilhos',
    'JA — Jardim América',
  ])
})

test('Cozinha JC entra na tela concedida para a propria funcao', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.cozinhaJc)

  await expect(page).toHaveURL(/\/producao-cozinha$/)
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible()
  await expect(
    page.getByRole('banner').getByText('Cozinha JC Teste', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Sem acesso ao lançamento', { exact: true })).toHaveCount(0)
})

test('Vendas JA entra no Romaneio e ve somente as rotas aprovadas', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByText('Romaneios', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('banner').getByText('Vendas JA Teste', { exact: true }),
  ).toBeVisible()

  for (const route of [
    '/romaneio',
    '/fechamento-caixa',
    '/sobras',
    '/encomendas',
    '/estoque-congelado',
  ]) {
    await expectRouteVisible(page, route)
  }

  for (const route of [
    '/producao-cozinha',
    '/compras',
    '/pedidos-pj',
    '/relatorios',
    '/admin/usuarios',
  ]) {
    await expectRouteHidden(page, route)
  }

  await expect(page.getByRole('button', { name: 'Novo Romaneio' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Conferir chegada/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Aprovar diverg/ })).toHaveCount(0)
  const exTripTitle = page.getByText('[TESTE] Exposicao · Viagem 4', { exact: true })
  await expect(exTripTitle).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  const exTrip = exTripTitle.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ps-card ")][1]')
  await expect(exTrip).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(exTrip.getByRole('button', { name: /Marcar Enviado/ })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/romaneio$/)
})

test('Romaneio EX mostra reposicao pendente sem alterar quantidade do card', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/romaneio')

  await page.getByRole('button', { name: 'Novo Romaneio' }).click()
  await page.getByRole('tab', { name: /\[TESTE\] Exposicao/ }).click()

  const bagueteCard = page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first()
  await expect(bagueteCard).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(bagueteCard.getByText('Reposição pendente: +2 un')).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(bagueteCard.locator('input.ps-qty')).toHaveValue('')

  await bagueteCard.locator('input.ps-qty').fill('3')
  await expect(
    bagueteCard.getByText('Enviando 1 un acima do pedido + pendência'),
  ).toBeVisible()
})

test('Romaneio EX abre conferencia pendente da propria loja', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.romaneioEx)

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(
    page.getByRole('banner').getByText('Romaneio EX Teste', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo Romaneio' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Marcar Enviado/ })).toHaveCount(0)

  const exPendingTitle = page.getByText('[TESTE] Exposicao · Viagem 5', { exact: true })
  await expect(exPendingTitle).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  const exPendingTrip = exPendingTitle.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ps-card ")][1]')
  await expect(exPendingTrip.getByText('Enviado', { exact: true })).toBeVisible()
  await exPendingTrip.getByRole('button', { name: /Conferir chegada/ }).click()

  await expect(page.getByText('[TESTE] Exposicao · Viagem 5', { exact: true })).toBeVisible()
  await expect(page.getByText('[TESTE] Baguete', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Salvar Confer/ })).toBeVisible()
})

test('Vendas JA nao entra na Producao da Cozinha', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)
  await page.goto('/producao-cozinha')

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toHaveCount(0)
})
