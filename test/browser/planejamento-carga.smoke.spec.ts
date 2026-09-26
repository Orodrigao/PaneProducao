import { expect, test, type Page, type Route } from '@playwright/test'

// Corridas de carregamento da tela de Planejamento. As respostas do banco são
// seguradas e soltas pelo teste, na ordem que a rede real às vezes produz; o
// planejamento de cada dia é simulado, então nada é gravado no Preview.

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

function planDateOf(route: Route): string | null {
  const request = route.request()
  if (request.method() !== 'GET') return null
  const filter = new URL(request.url()).searchParams.get('production_date')
  return filter?.startsWith('eq.') ? filter.slice(3) : null
}

function fakePlan(id: string, productionDate: string) {
  return {
    id,
    production_date: productionDate,
    status: 'rascunho',
    created_by_name: 'Teste de carregamento',
    reopened_reason: null,
    created_at: `${productionDate}T09:00:00.000Z`,
    updated_at: `${productionDate}T09:00:00.000Z`,
  }
}

function deferred() {
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  return { release, released }
}

// Rede de segurança: estes cenários nunca gravam. Uma escrita que escape vira
// falha em vez de lixo no banco compartilhado.
async function refuseWrites(page: Page, writes: string[]) {
  await page.route(/\/rest\/v1\/production_plan(s|_items)(\?|$)/, async route => {
    if (route.request().method() === 'GET') return route.fallback()
    writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })
}

test('Criar rascunho espera a lista de pães do dia', async ({ page }) => {
  await enterAsAdmin(page)

  const writes: string[] = []
  await refuseWrites(page, writes)

  // Dia sem planejamento, para o cartão "Criar rascunho" aparecer.
  await page.route(/\/rest\/v1\/production_plans\?/, async route => {
    if (!planDateOf(route)) return route.fallback()
    return route.fulfill({ json: [] })
  })

  const breadsGate = deferred()
  let breadsHeld = 0
  await page.route(/\/rest\/v1\/breads\?/, async route => {
    breadsHeld += 1
    await breadsGate.released
    return route.fallback()
  })

  await page.goto('/planejamento-producao')

  const createDraft = page.getByRole('button', { name: 'Criar rascunho' })
  await expect(createDraft).toBeVisible({ timeout: 30_000 })
  expect(breadsHeld, 'a lista de pães precisa estar segurada neste ponto').toBeGreaterThan(0)

  // Enquanto os pães não chegam, o botão fica travado e diz por quê; a tela
  // não afirma "0 pães previstos".
  await expect(createDraft).toBeDisabled()
  await expect(page.getByText('Carregando os pães previstos para a data.')).toBeVisible()
  await expect(page.getByText(/^0 pães previstos/)).toHaveCount(0)

  breadsGate.release()

  await expect(createDraft).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByText(/^\d+ pães previstos para a data\.$/)).toBeVisible()
  await expect(page.getByText('Carregando os pães previstos para a data.')).toHaveCount(0)
  expect(writes).toEqual([])
})

for (const undo of ['desfeito', 'não desfeito'] as const) {
  test(`Rascunho cujos pães não gravam é ${undo} e a tela avisa`, async ({ page }) => {
    await enterAsAdmin(page)

    const fakeId = '0c0c0c0c-0000-4000-8000-00000000000c'
    let createdDate: string | null = null
    let planSurvives = false
    const deletes: string[] = []

    // Toda gravação é simulada: o plano "nasce", os pães recusam e a exclusão
    // compensatória responde conforme o cenário.
    await page.route(/\/rest\/v1\/production_plans(\?|$)/, async route => {
      const request = route.request()
      const method = request.method()
      if (method === 'GET') {
        const date = planDateOf(route)
        if (!date) return route.fallback()
        const exists = planSurvives && date === createdDate
        return route.fulfill({ json: exists ? [fakePlan(fakeId, date)] : [] })
      }
      if (method === 'POST') {
        const body = request.postDataJSON() as Array<{ production_date: string }>
        createdDate = body[0].production_date
        return route.fulfill({ status: 201, json: [fakePlan(fakeId, createdDate)] })
      }
      if (method === 'DELETE') {
        deletes.push(new URL(request.url()).searchParams.get('id') ?? '')
        if (undo === 'desfeito') return route.fulfill({ json: [{ id: fakeId }] })
        planSurvives = true
        return route.fulfill({ json: [] })
      }
      return route.abort()
    })
    await page.route(/\/rest\/v1\/production_plan_items(\?|$)/, async route => {
      const method = route.request().method()
      if (method === 'POST') {
        return route.fulfill({ status: 500, json: { message: 'falha simulada' } })
      }
      if (method === 'GET' && route.request().url().includes(fakeId)) {
        return route.fulfill({ json: [] })
      }
      if (method === 'GET') return route.fallback()
      return route.abort()
    })

    await page.goto('/planejamento-producao')
    const createDraft = page.getByRole('button', { name: 'Criar rascunho' })
    const dayGroup = page.getByRole('group', { name: 'Planejar para' })
    await expect(dayGroup.getByRole('button')).toHaveCount(6, { timeout: 30_000 })

    // Um dia com pães previstos, para existir o que gravar.
    let found = false
    for (const button of await dayGroup.getByRole('button').all()) {
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(createDraft).toBeEnabled({ timeout: 30_000 })
      const text = await page.getByText(/pães previstos para a data\.$/).innerText()
      if (Number(text.split(' ')[0]) > 0) { found = true; break }
    }
    expect(found, 'algum dia da semana com pães previstos').toBe(true)

    await createDraft.click()
    await expect.poll(() => deletes).toEqual([`eq.${fakeId}`])

    if (undo === 'desfeito') {
      await expect(page.getByText('Não foi possível criar o planejamento.')).toBeVisible()
      await expect(createDraft).toBeVisible()
    } else {
      await expect(page.getByText(
        'O rascunho foi criado sem os pães do dia. Toque em Descartar e crie de novo.',
      )).toBeVisible()
      await expect(page.locator(`[data-plan-id="${fakeId}"]`)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Descartar' })).toBeVisible()
    }
  })
}

test('Resposta atrasada do dia anterior não toma o lugar do dia escolhido', async ({ page }) => {
  await enterAsAdmin(page)

  const writes: string[] = []
  await refuseWrites(page, writes)

  const oldDayGate = deferred()
  let firstDate: string | null = null
  let oldDayAnswered = false
  const planIdFor = (date: string) => (
    date === firstDate
      ? '0a0a0a0a-0000-4000-8000-00000000000a'
      : '0b0b0b0b-0000-4000-8000-00000000000b'
  )

  await page.route(/\/rest\/v1\/production_plans\?/, async route => {
    const date = planDateOf(route)
    if (!date) return route.fallback()
    firstDate ??= date
    if (date === firstDate) {
      await oldDayGate.released
      await route.fulfill({ json: [fakePlan(planIdFor(date), date)] })
      oldDayAnswered = true
      return
    }
    return route.fulfill({ json: [fakePlan(planIdFor(date), date)] })
  })

  await page.route(/\/rest\/v1\/production_plan_items\?/, async route => {
    const planFilter = new URL(route.request().url()).searchParams.get('plan_id') ?? ''
    if (route.request().method() === 'GET' && planFilter.startsWith('eq.')) {
      return route.fulfill({ json: [] })
    }
    return route.fallback()
  })

  await page.goto('/planejamento-producao')
  await expect(page.getByText('Dia selecionado', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => firstDate, { timeout: 30_000 }).not.toBeNull()

  // Troca de dia com a consulta do primeiro dia ainda no ar.
  const dayGroup = page.getByRole('group', { name: 'Planejar para' })
  const otherDay = dayGroup.locator('button[aria-pressed="false"]').first()
  const otherDayName = await otherDay.innerText()
  await otherDay.click()
  const chosenDay = dayGroup.getByRole('button', { name: otherDayName, exact: true })
  await expect(chosenDay).toHaveAttribute('aria-pressed', 'true')

  const chosenDate = await page.locator('time[datetime]').getAttribute('datetime')
  expect(chosenDate).not.toBe(firstDate)
  const chosenPlan = page.locator(`[data-plan-id="${planIdFor(chosenDate!)}"]`)
  const oldPlan = page.locator(`[data-plan-id="${planIdFor(firstDate!)}"]`)
  await expect(chosenPlan).toBeVisible({ timeout: 30_000 })

  // Agora a resposta do primeiro dia chega, atrasada.
  oldDayGate.release()
  await expect.poll(() => oldDayAnswered, { timeout: 30_000 }).toBe(true)
  // A tela de antes da correção levava duas idas ao banco para trocar o plano
  // (plano e depois itens); esperar a rede assentar cobre as duas.
  await page.waitForLoadState('networkidle')

  await expect(oldPlan).toHaveCount(0)
  await expect(chosenPlan).toBeVisible()
  await expect(chosenDay).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Carregando planejamento...')).toHaveCount(0)
  expect(writes).toEqual([])
})
