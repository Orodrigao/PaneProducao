import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

const plannerEmail = 'rodrigao+teste-geolar-jc@gmail.com'
const kitchenEmail = 'rodrigao+teste-cozinha-jc@gmail.com'
const productName = '[TESTE] Pizza Romana de Calabresa'

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

test('pedido montado vai para a Cozinha e permite realizado acima do planejado', async ({ page }) => {
  await enterWithPreviewAccount(page, plannerEmail)

  const reuseGate = page.getByRole('heading', { name: 'Confira as sobras antes da produção' })
  const planningHeading = page.getByRole('heading', { name: 'Produção PJ de hoje' })
  await expect(reuseGate.or(planningHeading)).toBeVisible({ timeout: 30_000 })
  if (await reuseGate.isVisible()) {
    await page.getByRole('button', { name: 'Conferir sobras e reaproveitamento' }).click()
    const reuseCard = page.locator('.ps-reuse-card', { hasText: '[TESTE] Baguete' }).first()
    await expect(reuseCard).toBeVisible({ timeout: 30_000 })
    page.once('dialog', dialog => dialog.accept())
    await reuseCard.getByRole('button', { name: 'Recusar reaproveitamento' }).click()
    await expect(reuseCard).toContainText('Reaproveitamento recusado', { timeout: 30_000 })
    await page.goto('/')
  }

  await expect(planningHeading).toBeVisible({ timeout: 30_000 })
  const customerCard = page.locator('article.ps-card', { hasText: '[TESTE] Bistro Cliente PJ' }).first()
  await expect(customerCard.getByText(productName, { exact: true })).toBeVisible()
  await expect(customerCard.getByText(/destino Cozinha/)).toBeVisible()
  await expect(customerCard.getByLabel(`Congelados para ${productName}`)).toHaveCount(0)

  await customerCard.getByLabel(`Selecionar ${productName}`).check()
  await customerCard.getByLabel(`Quantidade para produzir de ${productName}`).fill('0,125')
  page.once('dialog', dialog => dialog.accept())
  await customerCard.getByRole('button', { name: 'Programar selecionados para hoje' }).click()
  await expect(page.getByRole('status')).toContainText('entraram na produção de hoje', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Sair' }).click()
  await enterWithPreviewAccount(page, kitchenEmail)
  await expect(page).toHaveURL(/\/producao-cozinha$/)

  const planned = page.locator('section.ps-card', { hasText: 'Necessidades programadas para hoje' })
  await expect(planned.getByText(productName, { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(planned).toContainText('Planejado')

  await page.getByLabel(`Quantidade produzida de ${productName}`).fill('5')
  await page.getByRole('button', { name: 'Salvar produção' }).click()
  await expect(planned).toContainText('Excedente', { timeout: 30_000 })

  await page.reload()
  await expect(page.getByText('Produção de hoje', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(productName, { exact: true }).last()).toBeVisible()
  await expect(page.getByText('5 kg', { exact: true }).last()).toBeVisible()
})
