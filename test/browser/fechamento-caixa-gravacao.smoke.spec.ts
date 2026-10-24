import { expect, test, type Page } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

async function probeProtectedClosing(page: Page, request: import('@playwright/test').Request) {
  const url = new URL('/rest/v1/cash_closings?select=stone_amount&limit=1', request.url())
  const headers = await request.allHeaders()
  const probe = await page.request.get(url.toString(), {
    headers: { apikey: headers.apikey, Authorization: headers.authorization },
    maxRedirects: 0,
  })
  const sharedTarget = !process.env.SMOKE_SUPABASE_URL
  test.skip(sharedTarget && probe.status() === 400,
    'A função e as colunas do fechamento protegido ainda não existem neste banco (PR sem merge); a prova desta PR roda no preview isolado dela.')
  expect(probe.ok(), 'Sonda do fechamento: HTTP ' + probe.status()).toBe(true)
}


test.use({ browserName: 'chromium', channel: 'chrome' })

function loaded(page: Page, date?: string) {
  return Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET'
      && response.url().includes('/rest/v1/cash_closings')
      && response.url().includes('store=eq.ja')
      && response.url().includes(date ? 'closing_date=eq.' + date : 'closing_date=eq.')),
    page.waitForResponse(response => response.request().method() === 'GET'
      && response.url().includes('/rest/v1/cash_closings')
      && response.url().includes('store=eq.ja')
      && response.url().includes('order=closing_date.desc')),
  ])
}

test('vendas JA salva Stone e 99Food pela função e relê sem somar aplicativo ao caixa', async ({ page }) => {
  test.setTimeout(90_000)
  await entrarComSessaoGuardada(page, 'rodrigao+teste-vendas-ja@gmail.com')
  const initial = loaded(page)
  const request = page.waitForRequest(r => r.url().includes('/rest/v1/cash_closings'))
  await page.goto('/fechamento-caixa')
  await probeProtectedClosing(page, await request)
  await initial
  await expect(page.getByLabel('Loja')).toHaveValue('ja')
  await expect(page.getByLabel('Loja')).toBeDisabled()
  // Datas fictícias fora das fixtures e do período que vai alimentar o livro.
  const date = new Date(Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 365 * 30) * 86_400_000).toISOString().slice(0, 10)
  const selected = loaded(page, date)
  await page.getByLabel('Data', { exact: true }).fill(date)
  await selected
  const cash = page.getByRole('textbox', { name: /^1\. Total em dinheiro/ })
  const stone = page.getByRole('textbox', { name: /^4\. Stone/ })
  const food99 = page.getByRole('textbox', { name: /^9\. 99Food/ })
  await cash.fill('100')
  await stone.fill('40,25')
  await food99.fill('80,50')
  const saved = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/save_cash_closing')
    && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Salvar fechamento' }).click()
  const response = await saved
  expect(response.ok()).toBe(true)
  const row = await response.json()
  expect(row).toMatchObject({ store: 'ja', stone_amount: 40.25, food99_sales_amount: 80.5, total_amount: 140.25, site_sales_amount: 0 })
  await expect(page.getByRole('button', { name: 'Atualizar fechamento' })).toBeEnabled({ timeout: 15_000 })
  const reopened = loaded(page)
  await page.reload()
  await reopened
  const reloaded = loaded(page, date)
  await page.getByLabel('Data', { exact: true }).fill(date)
  await reloaded
  await expect(stone).toHaveValue('40,25')
  await expect(food99).toHaveValue('80,50')
  // A versão nova pode publicar antes da migration: erro legível e rascunho intacto.
  await page.route('**/rest/v1/rpc/save_cash_closing', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'PGRST202', message: 'Function not found' }),
  }))
  await stone.fill('45,50')
  await page.getByRole('button', { name: 'Atualizar fechamento' }).click()
  await expect(page.getByText('O sistema está sendo atualizado;', { exact: false })).toBeVisible()
  await expect(stone).toHaveValue('45,50')
  await expect(food99).toHaveValue('80,50')
})
