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
    await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible()
    await page.getByRole('button', { name: 'Mais seções', exact: true }).click()
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?force=email&returnTo=%2Fpedidos-pj%3Fpiloto%3D1$/)
    await signInOnCurrentPage(page, profile)
    await expect(page).toHaveURL(/\/pedidos-pj\?piloto=1(?:&pedido=[^&]+)?$/)
    await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible()
    await expect(page.locator('.ps-sidebar-user')).toHaveAttribute('title',
      profile === 'financeiro' ? 'Financeiro JC Teste' : 'Expedicao JC Teste')
  }
  await page.getByRole('link', { name: 'Ver pedidos da rotina anterior', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos-pj\?legado=1$/)
  await page.getByRole('button', { name: 'Mais seções', exact: true }).click()
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
  await expect(page.getByText(/Produtos conferidos:.*R\$\s*1,01/)).toBeVisible()
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

test('entrada normal e link financeiro abrem a ficha certa, sem misturar pedido antigo', async ({ page }) => {
  await enter(page, 'financeiro')
  const second = { ...fixture, id: '96000000-0000-4000-8000-000000000202', customer: 'Segundo pedido fictício' }
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [fixture, second] }))
  await page.goto('/pedidos-pj')
  await expect(page.getByRole('region', { name: `Ficha de ${fixture.customer}`, exact: true })).toBeVisible()
  await page.goto(`/pedidos-pj?pedido=${second.id}`)
  await expect(page.getByRole('region', { name: `Ficha de ${second.customer}`, exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: `Ficha de ${fixture.customer}`, exact: true })).toHaveCount(0)
  await page.goto('/pedidos-pj?pedido=96000000-0000-4000-8000-000000000299')
  await expect(page.getByText('Esta lista contém somente pedidos da rotina anterior.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toHaveCount(0)
})

test('troca de ficha preserva rascunho e saída mantém pedido selecionado', async ({ page }) => {
  await enter(page, 'expedicao')
  let departed = false
  const second = { ...fixture, id: '96000000-0000-4000-8000-000000000202', customer: 'Segundo pedido fictício' }
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [
    { ...fixture, departed_at: departed ? '2026-09-08T12:00:00Z' : null }, second,
  ] }))
  await page.route('**/rest/v1/rpc/transition_pj_flow_pilot', async route => {
    departed = true
    await route.fulfill({ json: { repeated: false, version: 4 } })
  })
  await page.goto('/pedidos-pj?piloto=1')
  const quantity = page.getByLabel('Quantidade conferida (un)')
  const other = page.getByRole('navigation', { name: 'Escolher pedido' }).getByRole('button', { name: /Segundo pedido fictício/ })
  await quantity.fill('38')
  await expect(other).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Recarregar pedidos', exact: true })).toBeDisabled()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Recarregar ficha e descartar alterações' }).click()
  await expect(quantity).toHaveValue('40')
  await expect(other).toBeEnabled()
  await page.getByRole('button', { name: 'Registrar saída física', exact: true }).click()
  await page.getByRole('button', { name: 'Sim, confirmar', exact: true }).click()
  await expect(page.getByRole('region', { name: `Ficha de ${fixture.customer}` })).toContainText('Saída física registrada')
  await expect(page.getByRole('button', { name: 'Registrar saída física', exact: true })).toHaveCount(0)
})

test('falha de leitura após saída permite recuperar ficha sem repetir saída', async ({ page }) => {
  await enter(page, 'expedicao')
  let failed = false
  let mutations = 0
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill(failed
    ? { status: 503, json: { message: 'Falha de leitura fictícia' } }
    : { json: [{ ...fixture, departed_at: mutations ? '2026-09-08T12:00:00Z' : null }] }))
  await page.route('**/rest/v1/rpc/transition_pj_flow_pilot', async route => {
    mutations += 1; failed = true
    await route.fulfill({ json: { version: 4 } })
  })
  await page.goto('/pedidos-pj?piloto=1')
  await page.getByRole('button', { name: 'Registrar saída física', exact: true }).click()
  await page.getByRole('button', { name: 'Sim, confirmar', exact: true }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('Falha de leitura fictícia')
  failed = false
  await page.getByRole('button', { name: 'Recarregar pedidos', exact: true }).click()
  await expect(page.getByRole('region', { name: `Ficha de ${fixture.customer}` })).toContainText('Saída física registrada')
  expect(mutations).toBe(1)
})

test('zero e conferência incompleta explicam bloqueio financeiro', async ({ page }) => {
  await enter(page, 'financeiro')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{ ...fixture,
    can_check: false, can_release: true, released_at: null, payment_term_days: 7,
    items: [{ ...fixture.items[0], quantity: 0, price: 5 }],
  }] }))
  await page.goto('/pedidos-pj?piloto=1')
  await expect(page.getByText('Nenhum item para sair.', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Confirmar cobrança e liberar entrega/coleta' })).toBeDisabled()
  await page.unroute('**/rest/v1/rpc/read_pj_flow_pilot')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{ ...fixture,
    can_check: false, can_release: true, checked_at: null, released_at: null, payment_term_days: 7,
    items: [{ ...fixture.items[0], quantity: null, price: 5 }],
  }] }))
  await page.reload()
  await expect(page.getByText('A Expedição JC precisa concluir', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeDisabled()
})

const financialFixture = {
  ...fixture, can_check: false, can_release: true, can_correct_due: true, can_split: true,
  approved_amount: 190, agreed_date: '2026-09-10', due_date: '2026-09-17', payment_term_days: 7,
  items: fixture.items.map(item => ({ ...item, quantity: 38, price: 5 })), financial_history: [],
  bills: [{ id: '96000000-0000-4000-8000-000000000501', number: 1, count: 1, amount: 190,
    received: 0, status: 'aberta', invoice_date: '2026-09-08', original_due_date: '2026-09-17', due_date: '2026-09-17' }],
}

test('vencimento PJ exige justificativa, trava troca e repete a mesma tentativa', async ({ page }) => {
  await enter(page, 'financeiro')
  const current = structuredClone(financialFixture)
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [current,
    { ...financialFixture, id: '96000000-0000-4000-8000-000000000202', customer: 'Segundo cliente financeiro' }] }))
  const mutations: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/change_pj_flow_terms', async route => {
    mutations.push(route.request().postDataJSON())
    if (mutations.length === 1) { await route.abort(); return }
    current.version++; current.bills[0].due_date = '2026-09-20'
    await route.fulfill({ json: { repeated: true, version: current.version } })
  })
  await page.goto(`/pedidos-pj?piloto=1&pedido=${fixture.id}`)
  await page.getByRole('button', { name: 'Corrigir vencimento', exact: true }).click()
  await page.getByLabel('Novo vencimento').fill('2026-09-20')
  await expect(page.getByRole('button', { name: 'Revisar alteração', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Segundo cliente financeiro/ })).toBeDisabled()
  await page.getByLabel('Justificativa do acordo').fill('Acordo de prazo com cliente')
  await page.getByRole('button', { name: 'Revisar alteração', exact: true }).click()
  await expect(page.getByLabel('Novo vencimento')).toBeDisabled()
  await page.getByRole('button', { name: 'Confirmar alteração financeira', exact: true }).click()
  await page.getByRole('button', { name: 'Repetir alteração financeira', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(2)
  expect(mutations[0]).toEqual(mutations[1])
  expect(mutations[0]).toMatchObject({ p_expected_version: 3, p_due_date: '2026-09-20', p_action: 'due' })
  await expect(page.getByText('Novo vencimento registrado.', { exact: false })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Condições da cobrança' })).toContainText('20/09/2026')
  await expect(page.getByRole('button', { name: /Segundo cliente financeiro/ })).toBeEnabled()
})

test('parcelamento mostra centavos e datas antes da confirmação no celular', async ({ page }) => {
  await enter(page, 'financeiro')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [financialFixture] }))
  const mutations: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/change_pj_flow_terms', async route => {
    mutations.push(route.request().postDataJSON())
    await route.fulfill({ json: { repeated: false, version: 4 } })
  })
  await page.goto(`/pedidos-pj?piloto=1&pedido=${fixture.id}`)
  await page.getByRole('button', { name: 'Dividir em parcelas', exact: true }).click()
  await page.getByLabel('Quantidade de parcelas').selectOption('3')
  await page.getByLabel('Justificativa do acordo').fill('Divisão acordada com cliente')
  const conditions = page.getByRole('region', { name: 'Condições da cobrança' })
  await expect(conditions).toContainText('63,34')
  await expect(conditions).toContainText('12/09/2026')
  await expect(conditions).toContainText('15/09/2026')
  await expect(conditions).toContainText('17/09/2026')
  expect(mutations).toHaveLength(0)
  await page.getByRole('button', { name: 'Revisar alteração', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar alteração financeira', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]).toMatchObject({ p_action: 'split', p_installments: 3, p_due_date: null })
  await expect(page.getByText('Parcelas registradas.', { exact: false })).toBeVisible()
})

test('crédito manual mostra produtos, abatimento e total líquido antes da liberação', async ({ page }) => {
  await enter(page, 'financeiro')
  const current = { ...financialFixture, released_at: null, approved_amount: null, net_amount: null,
    received_total: 0, pending_excess: 0, bills: [], refund_accounts: [],
    credit_sources: [{ id: '96000000-0000-4000-8000-000000000299', delivery_date: '2026-09-01',
      amount: 10, reason: 'Cliente aceitou o crédito' }] }
  const mutations: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [current] }))
  await page.route('**/rest/v1/rpc/transition_pj_flow_pilot', async route => {
    mutations.push(route.request().postDataJSON())
    await route.fulfill({ json: { repeated: false, version: 4 } })
  })
  await page.goto(`/pedidos-pj?piloto=1&pedido=${fixture.id}`)
  const creditFields = page.getByRole('group', { name: 'Crédito de pedido anterior (opcional)' })
  await creditFields.getByLabel('Pedido de origem').selectOption('96000000-0000-4000-8000-000000000299')
  await expect(page.getByText(/Crédito anterior:.*R\$\s*10,00/)).toBeVisible()
  await expect(page.getByText(/Total a receber:.*R\$\s*180,00/)).toBeVisible()
  await expect(creditFields.getByText('Informe a justificativa do crédito.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Confirmar cobrança e liberar entrega/coleta' })).toBeDisabled()
  expect(mutations).toHaveLength(0)
  await creditFields.getByLabel('Justificativa', { exact: true }).fill('Crédito combinado no pedido anterior')
  await expect(creditFields.getByText('Informe a justificativa do crédito.', { exact: true })).not.toBeVisible()
  await expect(page.getByRole('checkbox')).toBeEnabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirmar cobrança e liberar entrega/coleta' }).click()
  await page.getByRole('button', { name: 'Sim, confirmar', exact: true }).click()
  await expect.poll(() => mutations.length).toBe(1)
  expect(mutations[0]).toMatchObject({ p_credit_amount: 10,
    p_credit_source_group_id: '96000000-0000-4000-8000-000000000299',
    p_credit_reason: 'Crédito combinado no pedido anterior' })
})

test('perfil somente leitura não recebe controles nem mensagem falsa de pedido parcelado', async ({ page }) => {
  await enter(page, 'financeiro')
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{ ...financialFixture,
    can_release: false, can_resolve_excess: false, excess_resolution_supported: true,
    released_at: null, received_total: 200, current_gross_amount: 190, pending_excess: 10,
  }] }))
  await page.goto(`/pedidos-pj?piloto=1&pedido=${fixture.id}`)
  await expect(page.getByRole('region', { name: 'Tratamento do valor recebido a mais' })).toHaveCount(0)
  await expect(page.getByText('A cobrança tem parcelas', { exact: false })).toHaveCount(0)
})
