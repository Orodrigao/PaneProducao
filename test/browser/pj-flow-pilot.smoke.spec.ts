import { expect, test, type Page } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 } })

async function enter(page: Page, profile: 'financeiro' | 'expedicao') {
  await page.goto('/login')
  await signInOnCurrentPage(page, profile)
}

async function signInOnCurrentPage(page: Page, profile: 'financeiro' | 'expedicao') {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'Credencial fictícia disponível apenas no GitHub.')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(`rodrigao+teste-${profile}-jc@gmail.com`)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

const fixture = {
  id: '96000000-0000-4000-8000-000000000201', version: 3, customer: '[TESTE] Piloto de interface',
  delivery_date: '2026-09-10', checked_at: '2026-09-08T10:00:00Z', released_at: '2026-09-08T11:00:00Z',
  departed_at: null, can_check: true, can_release: false, history: [],
  items: [{ id: '96000000-0000-4000-8000-000000000101', name: 'Brioche fictício', ordered: 40,
    quantity: 40, unit: 'un', reason: null }],
}

test('trocar Expedição e Financeiro mantém o piloto; saída comum não força o piloto', async ({ page }) => {
  test.setTimeout(90_000)
  await enter(page, 'expedicao')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [fixture] }))
  await page.goto('/pedidos-pj?piloto=1')
  for (const profile of ['financeiro', 'expedicao'] as const) {
    await expect(page.getByRole('heading', { name: 'Piloto do novo fluxo PJ', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?force=email&returnTo=%2Fpedidos-pj%3Fpiloto%3D1$/)
    await signInOnCurrentPage(page, profile)
    await expect(page).toHaveURL(/\/pedidos-pj\?piloto=1$/)
    await expect(page.getByRole('heading', { name: 'Piloto do novo fluxo PJ', exact: true })).toBeVisible()
    await expect(page.locator('.ps-sidebar-user')).toHaveAttribute('title',
      profile === 'financeiro' ? 'Financeiro JC Teste' : 'Expedicao JC Teste')
  }
  await page.getByRole('link', { name: 'Voltar aos pedidos', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos-pj$/)
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})

// Estes testes provam a interface com contratos fictícios. Não são prova de
// transação live: a matriz de escrita e preservação financeira está no pgTAP.
test('rascunho não salvo não conclui nem sai; diálogo congela os campos', async ({ page }) => {
  await enter(page, 'expedicao')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [fixture] }))
  const mutations: unknown[] = []
  await page.route('**/rest/v1/rpc/transition_pj_flow_pilot', async route => {
    mutations.push(route.request().postDataJSON())
    await route.fulfill({ json: { repeated: false, version: 3 } })
  })
  await page.goto('/pedidos-pj?piloto=1')
  const quantity = page.getByLabel('Quantidade conferida (un)')
  await quantity.fill('38')
  await expect(page.getByRole('button', { name: 'Registrar saída física', exact: true })).toBeDisabled()
  await expect(page.getByText('Salve as quantidades alteradas antes', { exact: false })).toBeVisible()
  await quantity.fill('40')
  await page.getByRole('button', { name: 'Registrar saída física', exact: true }).click()
  await expect(quantity).toBeDisabled()
  await page.getByRole('button', { name: 'Sim, confirmar', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]).toMatchObject({ p_action: 'depart', p_expected_version: 3, p_items: [] })
  await expect(page.locator('main')).not.toContainText('R$')
})

test('resposta perdida repete a mesma operação, sem inventar outra saída', async ({ page }) => {
  await enter(page, 'expedicao')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [fixture] }))
  const mutations: unknown[] = []
  await page.route('**/rest/v1/rpc/transition_pj_flow_pilot', async route => {
    mutations.push(route.request().postDataJSON())
    await route.fulfill(mutations.length === 1
      ? { status: 503, json: { message: 'Resposta perdida fictícia' } }
      : { json: { repeated: true, version: 3 } })
  })
  await page.goto('/pedidos-pj?piloto=1')
  await page.getByRole('button', { name: 'Registrar saída física', exact: true }).click()
  await page.getByRole('button', { name: 'Sim, confirmar', exact: true }).click()
  await page.getByRole('button', { name: 'Repetir a mesma tentativa', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(2)
  expect(mutations[1]).toEqual(mutations[0])
})

test('revisão mostra o mesmo centavo do banco e exige NF', async ({ page }) => {
  await enter(page, 'financeiro')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{ ...fixture,
    released_at: null, can_check: false, can_release: true, payment_term_days: 7,
    items: [{ ...fixture.items[0], unit: 'kg', ordered: 1.005, quantity: 1.005, price: 1 }],
  }] }))
  await page.goto('/pedidos-pj?piloto=1')
  await expect(page.getByText(/Valor conferido: R\$\s*1,01/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar cobrança e liberar entrega/coleta' })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(page.getByRole('button', { name: 'Confirmar cobrança e liberar entrega/coleta' })).toBeEnabled()
})

test('contrato ausente permanece indisponível, sem botão do envio antigo', async ({ page }) => {
  await enter(page, 'expedicao')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ status: 404,
    json: { message: 'Contrato ainda não instalado', code: 'PGRST202' } }))
  await page.goto('/pedidos-pj?piloto=1')
  await expect(page.locator('main').getByRole('alert')).toContainText('Nenhuma ação do fluxo antigo será usada')
  await expect(page.getByRole('button', { name: 'Registrar saída física', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Confirmar.*envio/ })).toHaveCount(0)
})
