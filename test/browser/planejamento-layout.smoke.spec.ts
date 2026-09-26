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

  const sidebar = page.getByRole('complementary', { name: 'Navegação principal' })
  if (width >= 1200) {
    await expect(sidebar).toBeVisible()
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(215)
    expect(sidebarBox?.width).toBeLessThanOrEqual(225)
  } else if (width >= 600) {
    await expect(sidebar).toBeVisible()
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(78)
    expect(sidebarBox?.width).toBeLessThanOrEqual(86)
  } else {
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('navigation')).toBeVisible()
  }

  const undersizedDayButtons = await page
    .getByRole('group', { name: 'Planejar para' })
    .getByRole('button')
    .evaluateAll(buttons => buttons.filter(button => {
      const rect = button.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44
    }).length)
  expect(undersizedDayButtons, `botoes de dia pequenos em ${width}x${height}`).toBe(0)

  if (width <= 480) {
    const refreshBox = await page.getByRole('button', { name: 'Atualizar' }).boundingBox()
    const selectedDateBox = await page.locator('time[datetime]').boundingBox()
    expect(refreshBox).not.toBeNull()
    expect(selectedDateBox).not.toBeNull()
    expect(selectedDateBox!.y).toBeGreaterThanOrEqual(refreshBox!.y + refreshBox!.height - 1)
  }
}

test('Planejamento preserva leitura e toque no computador, tablet e celular', async ({ page }) => {
  // Pode precisar percorrer alguns dias até achar um com pães; a folga também
  // deixa tempo para a limpeza do rascunho criado pelo teste.
  test.setTimeout(180_000)
  await enterAsAdmin(page)

  // A tela não descarta resposta velha: trocar de dia com a consulta anterior
  // ainda no ar pode trazer de volta o plano do dia anterior. Por isso o teste
  // só troca de dia depois que a consulta do dia atual voltou e a tela mostra
  // o conteúdo com a data dele.
  const loadedPlanDates = new Set<string>()
  page.on('response', response => {
    if (response.request().method() !== 'GET') return
    const url = new URL(response.url())
    if (!url.pathname.endsWith('/rest/v1/production_plans')) return
    const planDate = url.searchParams.get('production_date')?.match(/^eq\.(\d{4}-\d{2}-\d{2})$/)?.[1]
    if (planDate) loadedPlanDates.add(planDate)
  })

  const dayGroup = page.getByRole('group', { name: 'Planejar para' })
  const summary = page.getByText('Total planejado', { exact: true })
  const jcTotal = page.getByLabel('JC total').first()
  const createDraft = page.getByRole('button', { name: 'Criar rascunho' })
  const discard = page.getByRole('button', { name: 'Descartar' })

  async function waitForSelectedDay() {
    const dateKey = await page.locator('time[datetime]').getAttribute('datetime')
    expect(dateKey, 'a data do dia escolhido deve estar na tela').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await expect.poll(() => loadedPlanDates.has(dateKey!), {
      message: `a consulta do plano de ${dateKey} deve responder`,
      timeout: 30_000,
    }).toBe(true)

    const [year, month, day] = dateKey!.split('-')
    const dateBR = `${day}/${month}/${year}`
    const planBanner = page.locator('.ps-banner').filter({ hasText: new RegExp(`^\\s*${dateBR}\\s+-\\s`) })
    const emptyDayCard = page.locator('.ps-card', { has: createDraft })
      .filter({ has: page.getByText(dateBR, { exact: true }) })
    await expect(planBanner.or(emptyDayCard)).toBeVisible({ timeout: 30_000 })
    return { planBanner, emptyDayCard }
  }

  async function selectDay(dayName: string) {
    const dayButton = dayGroup.getByRole('button', { name: dayName, exact: true })
    await dayButton.click()
    await expect(dayButton).toHaveAttribute('aria-pressed', 'true')
    return waitForSelectedDay()
  }

  await page.goto('/planejamento-producao')

  let createdPlanId: string | null = null
  let createdDayName = ''

  try {
    await expect(page.getByText('Dia selecionado', { exact: true })).toBeVisible()
    await waitForSelectedDay()

    const otherDayNames = await dayGroup.locator('button[aria-pressed="false"]').allInnerTexts()
    expect(otherDayNames.length, 'a tela deve oferecer outros dias para planejar').toBeGreaterThan(0)

    // O banco de teste é compartilhado: outra execução pode ter deixado num dia
    // um rascunho sem nenhum pão, e aí não há linha de loja para medir. Usa o
    // primeiro dia em que dá para criar o próprio rascunho ou em que o plano já
    // tem pães; rascunho vazio de terceiros é pulado, nunca alterado.
    let foundDayWithBreads = false
    for (const dayName of otherDayNames) {
      const { planBanner, emptyDayCard } = await selectDay(dayName)

      if (await emptyDayCard.isVisible()) {
        // O botão aparece antes de a lista de pães chegar; criar nesse instante
        // grava um rascunho vazio. Espera a contagem de pães previstos.
        await expect(emptyDayCard.getByText(/^[1-9]\d* pães previstos para a data\.$/))
          .toBeVisible({ timeout: 30_000 })
        const createResponsePromise = page.waitForResponse(response => (
          response.request().method() === 'POST'
          && new URL(response.url()).pathname.endsWith('/rest/v1/production_plans')
        ))
        createdDayName = dayName
        await createDraft.click()
        const createResponse = await createResponsePromise
        expect(createResponse.ok(), 'a criação do rascunho deve ser aceita').toBe(true)
        const createdRows = await createResponse.json() as Array<{ id?: string }>
        createdPlanId = createdRows[0]?.id ?? null
        expect(createdPlanId, 'a criação do rascunho deve retornar seu identificador').toBeTruthy()
        await expect(planBanner).toBeVisible({ timeout: 30_000 })
        await expect(page.locator(`[data-plan-id="${createdPlanId}"]`)).toBeVisible()
        await expect(jcTotal, 'o rascunho criado pelo teste deve trazer os pães do dia')
          .toBeVisible({ timeout: 30_000 })
        foundDayWithBreads = true
        break
      }

      // Plano existente só mostra as linhas das lojas depois que a lista de pães
      // chega; a espera curta separa "ainda carregando" de "rascunho vazio".
      const existingPlanHasBreads = await jcTotal
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true, () => false)
      if (existingPlanHasBreads) {
        foundDayWithBreads = true
        break
      }
    }
    expect(foundDayWithBreads, `nenhum dia com pães planejáveis entre ${otherDayNames.join(', ')}`).toBe(true)
    await expect(summary).toBeVisible({ timeout: 30_000 })

    await expectLayoutFitsViewport(page, 1440, 1000)
    await expectLayoutFitsViewport(page, 1200, 900)
    await expectLayoutFitsViewport(page, 820, 1180)
    await expectLayoutFitsViewport(page, 390, 844)
  } finally {
    if (createdPlanId && !page.isClosed()) {
      // Rascunho esquecido no banco compartilhado derruba as próximas execuções,
      // então a limpeza que não conclui reprova o teste em vez de passar calada.
      let cleanupFailure = ''
      try {
        await page.setViewportSize({ width: 1440, height: 1000 })
        const ownPlan = page.locator(`[data-plan-id="${createdPlanId}"]`)
        if (!await ownPlan.isVisible()) {
          loadedPlanDates.clear()
          await page.reload()
          await waitForSelectedDay()
          await selectDay(createdDayName)
        }
        await expect(ownPlan).toBeVisible({ timeout: 30_000 })
        await expect(discard).toBeVisible()
        page.once('dialog', dialog => dialog.accept())
        await discard.click()
        await expect(createDraft).toBeVisible({ timeout: 30_000 })
      } catch (error) {
        cleanupFailure = error instanceof Error ? error.message : String(error)
      }
      expect.soft(cleanupFailure, `o rascunho ${createdPlanId} criado pelo teste deve ser apagado`).toBe('')
    }
  }
})
