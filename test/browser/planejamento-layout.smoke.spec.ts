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
  await expect(page.getByRole('group', { name: 'Planejar para' })).toBeVisible()
  await expect(page.getByText('Total planejado', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pães', exact: true })).toBeVisible()
  await expect(page.getByLabel('JC total').first()).toBeVisible()
  await expect(page.getByLabel('JA total').first()).toBeVisible()

  const hasHorizontalOverflow = await page.locator('html').evaluate(element => (
    element.scrollWidth > element.clientWidth + 1
  ))
  expect(hasHorizontalOverflow, `layout com rolagem horizontal em ${width}x${height}`).toBe(false)

  const undersizedDayButtons = await page
    .getByRole('group', { name: 'Planejar para' })
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

  let createdForTest = false
  let selectedDayName = ''
  const createDraft = page.getByRole('button', { name: 'Criar rascunho' })

  try {
    await expect(page.getByText('Dia selecionado', { exact: true })).toBeVisible()

    const dayGroup = page.getByRole('group', { name: 'Planejar para' })
    const otherDay = dayGroup.locator('button[aria-pressed="false"]').first()
    selectedDayName = await otherDay.innerText()
    await otherDay.click()
    await expect(dayGroup.getByRole('button', { name: selectedDayName, exact: true }))
      .toHaveAttribute('aria-pressed', 'true')

    const summary = page.getByText('Total planejado', { exact: true })
    await expect(summary.or(createDraft)).toBeVisible({ timeout: 30_000 })

    if (await createDraft.isVisible()) {
      createdForTest = true
      await createDraft.click()
    }
    await expect(summary).toBeVisible({ timeout: 30_000 })

    await expectLayoutFitsViewport(page, 1440, 1000)
    await expectLayoutFitsViewport(page, 1200, 900)
    await expectLayoutFitsViewport(page, 820, 1180)
    await expectLayoutFitsViewport(page, 390, 844)
  } finally {
    if (createdForTest && !page.isClosed()) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.reload()

      const selectedDay = page
        .getByRole('group', { name: 'Planejar para' })
        .getByRole('button', { name: selectedDayName, exact: true })
      await selectedDay.click()

      const discard = page.getByRole('button', { name: 'Descartar' })
      await expect(discard.or(createDraft)).toBeVisible({ timeout: 30_000 })
      if (await discard.isVisible()) {
        page.once('dialog', dialog => dialog.accept())
        await discard.click()
        await expect(createDraft).toBeVisible({ timeout: 30_000 })
      }
    }
  }
})
