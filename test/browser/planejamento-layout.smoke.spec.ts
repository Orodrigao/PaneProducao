import { expect, test, type Page } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

async function enterAsAdmin(page: Page) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha da conta ficticia existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill('rodrigao+teste@gmail.com')
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

async function expectLayoutFitsViewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await expect(page.getByRole('heading', { name: 'Planejamento', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Pães para qual dia?' })).toBeVisible()
  await expect(page.getByText('Total planejado', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pães', exact: true })).toBeVisible()
  await expect(page.getByLabel('JC total').first()).toBeVisible()
  await expect(page.getByLabel('JA total').first()).toBeVisible()

  const hasHorizontalOverflow = await page.locator('html').evaluate(element => (
    element.scrollWidth > element.clientWidth + 1
  ))
  expect(hasHorizontalOverflow, `layout com rolagem horizontal em ${width}x${height}`).toBe(false)

  const undersizedDayButtons = await page
    .getByRole('group', { name: 'Pães para qual dia?' })
    .getByRole('button')
    .evaluateAll(buttons => buttons.filter(button => {
      const rect = button.getBoundingClientRect()
      return rect.width < 42 || rect.height < 42
    }).length)
  expect(undersizedDayButtons, `botoes de dia pequenos em ${width}x${height}`).toBe(0)
}

test('Planejamento preserva leitura e toque no computador, tablet e celular', async ({ page }) => {
  await enterAsAdmin(page)
  await page.goto('/planejamento-producao')

  await expect(page.getByText('Planejamentos em aberto', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Dia selecionado', { exact: true })).toBeVisible()

  const openPlans = page
    .locator('section')
    .filter({ hasText: 'Planejamentos em aberto' })
    .first()
    .getByRole('button')
  await expect(openPlans.first()).toBeVisible({ timeout: 30_000 })
  await openPlans.first().click()
  await expect(page.getByText('Total planejado', { exact: true })).toBeVisible({ timeout: 30_000 })

  await expectLayoutFitsViewport(page, 1440, 1000)
  await expectLayoutFitsViewport(page, 820, 1180)
  await expectLayoutFitsViewport(page, 390, 844)

  const dayGroup = page.getByRole('group', { name: 'Pães para qual dia?' })
  const otherDay = dayGroup
    .locator('button[aria-pressed="false"]')
    .first()
  const otherDayName = await otherDay.innerText()
  await otherDay.click()
  await expect(dayGroup.getByRole('button', { name: otherDayName, exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
})
