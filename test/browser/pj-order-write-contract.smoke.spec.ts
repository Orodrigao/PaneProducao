import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const slowPreviewDataTimeoutMs = 15_000

async function enterWithPreviewAccount(page: Page, email = financeiroJc) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas fictícias existe somente no secret do GitHub.')
  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: slowPreviewDataTimeoutMs })
}

function futureDelivery(): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + 5)
  if (date.getDay() === 0) date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function addBrioche(page: Page) {
  const search = page.getByPlaceholder('Digite ou clique pra ver produtos da tabela')
  await search.fill('Brioche PJ')
  await search.locator('..').locator('span').filter({ hasText: /^\[TESTE\] Brioche PJ/ }).first().click()
}

test('cria sem duplicar após resposta perdida, altera, relê e cancela o mesmo pedido', async ({ page, request }) => {
  test.setTimeout(120_000)
  await enterWithPreviewAccount(page)

  const createBodies: Array<{ p_request_id: string; p_order_group_id: string }> = []
  let firstCreate = true
  let rpcUrl = ''
  let rpcHeaders: Record<string, string> = {}
  await page.route('**/rest/v1/rpc/create_pj_order_atomic', async route => {
    const body = route.request().postDataJSON() as { p_request_id: string; p_order_group_id: string }
    createBodies.push(body)
    rpcUrl = route.request().url()
    const headers = route.request().headers()
    rpcHeaders = Object.fromEntries(
      ['authorization', 'apikey', 'content-type', 'prefer']
        .filter(name => headers[name])
        .map(name => [name, headers[name]]),
    )
    if (firstCreate) {
      firstCreate = false
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({ status: 503, json: { message: 'Resposta ficticiamente perdida depois da gravação' } })
      return
    }
    await route.continue()
  })

  let groupId: string | null = null
  try {
    await page.goto('/pedidos-pj?legado=1&novo=1')
    await page.locator('select').selectOption({ label: '[TESTE] Bistro Cliente PJ' })
    await addBrioche(page)
    await page.locator('input[type="date"]').fill(futureDelivery())

    await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Salvar pedido', exact: true })).toBeEnabled()

    // A memória da página some, como aconteceria após queda/reabertura. O
    // marcador persistente repete exatamente o pedido anterior antes de aceitar
    // qualquer rascunho novo.
    await page.reload()
    await page.getByRole('tab', { name: '+ Novo pedido', exact: true }).click()
    await page.locator('select').selectOption({ label: '[TESTE] Cafe Cliente PJ' })
    await addBrioche(page)
    await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
    await expect(page).toHaveURL(/pedido=/)

    expect(createBodies).toHaveLength(2)
    expect(createBodies[1]).toMatchObject(createBodies[0])
    groupId = createBodies[0].p_order_group_id

    await page.goto(`/pedidos-pj?legado=1&pedido=${groupId}`)
    const ficha = page.getByRole('dialog', { name: 'Ficha do pedido PJ' })
    await expect(ficha).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
    await expect(ficha).toContainText('Pedido: 12 un')

    await ficha.getByRole('button', { name: 'Editar', exact: true }).click()
    await page.getByLabel('Quantidade de [TESTE] Brioche PJ').fill('2')
    const replacePattern = '**/rest/v1/rpc/replace_pj_order_atomic_v2'
    const replaceBodies: Array<{
      p_order_group_id: string
      p_expected_rows: Array<{ id: string; updated_at: string }>
    }> = []
    const captureReplace = async (route: Route) => {
      replaceBodies.push(route.request().postDataJSON() as {
        p_order_group_id: string
        p_expected_rows: Array<{ id: string; updated_at: string }>
      })
      await route.continue()
    }
    await page.route(replacePattern, captureReplace)
    const replaceResponse = page.waitForResponse(response => response.url().includes('/rpc/replace_pj_order_atomic_v2'))
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    expect((await replaceResponse).ok()).toBe(true)
    await page.unroute(replacePattern, captureReplace)
    expect(replaceBodies).toHaveLength(1)
    expect(replaceBodies[0]).toMatchObject({
      p_order_group_id: groupId,
      p_expected_rows: [
        { id: expect.any(String), updated_at: expect.any(String) },
      ],
    })

    await page.goto(`/pedidos-pj?legado=1&pedido=${groupId}`)
    await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toContainText('Pedido: 24 un', {
      timeout: slowPreviewDataTimeoutMs,
    })

    await page.getByRole('button', { name: 'Editar', exact: true }).click()
    await page.getByLabel('Quantidade de [TESTE] Brioche PJ').fill('3')
    const rejectStaleReplace = async (route: Route) => {
      const body = route.request().postDataJSON() as {
        p_request_id: string
        p_order_group_id: string
        p_expected_rows: Array<{ id: string; updated_at: string }>
      }
      expect(body).toMatchObject({
        p_request_id: expect.any(String),
        p_order_group_id: groupId,
        p_expected_rows: [{ id: expect.any(String), updated_at: expect.any(String) }],
      })
      await route.fulfill({
        status: 400,
        json: { code: '40001', message: 'Pedido mudou; recarregue antes de salvar novamente.' },
      })
    }
    await page.route(replacePattern, rejectStaleReplace)
    const conflictResponse = page.waitForResponse(response => response.url().includes('/rpc/replace_pj_order_atomic_v2'))
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    expect((await conflictResponse).status()).toBe(400)
    await page.unroute(replacePattern, rejectStaleReplace)
    await expect(page.getByText('Erro: Pedido mudou; recarregue antes de salvar novamente.')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Pedidos', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: '+ Novo pedido', exact: true }).click()
    await expect(page.locator('select')).toHaveValue('')
    await expect(page.locator('input[type="date"]')).toHaveCount(0)
    await expect(page.getByPlaceholder('Digite ou clique pra ver produtos da tabela')).toHaveCount(0)

    await page.goto(`/pedidos-pj?legado=1&pedido=${groupId}`)
    await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toContainText('Pedido: 24 un', {
      timeout: slowPreviewDataTimeoutMs,
    })

    await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click()
    await page.getByPlaceholder('Ex.: cliente desistiu').fill('[TESTE] limpeza do contrato atômico')
    const cancelResponse = page.waitForResponse(response => response.url().includes('/rpc/cancel_pj_order_atomic'))
    await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click()
    expect((await cancelResponse).ok()).toBe(true)

    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toContainText('CANCELADO', {
      timeout: slowPreviewDataTimeoutMs,
    })
  } finally {
    // Se uma asserção falhar depois da criação, retira somente o pedido fictício
    // desta execução da fila operacional. Pedido cancelado continua no histórico.
    const cleanupGroupId = groupId ?? createBodies[0]?.p_order_group_id
    if (cleanupGroupId && rpcUrl) {
      await request.post(rpcUrl.replace('create_pj_order_atomic', 'cancel_pj_order_atomic'), {
        headers: rpcHeaders,
        data: {
          p_request_id: randomUUID(),
          p_order_group_id: cleanupGroupId,
          p_reason: '[TESTE] limpeza após execução interrompida',
        },
      }).catch(() => undefined)
    }
  }
})

test('sucesso no modo padrão abre o pedido na nova jornada', async ({ page }) => {
  await enterWithPreviewAccount(page)
  const groupId = '97000000-0000-4000-8000-000000000001'
  const customerId = '97000000-0000-4000-8000-000000000004'
  const tierId = '97000000-0000-4000-8000-000000000005'
  await page.route('**/rest/v1/rpc/create_pj_order_atomic', route => route.fulfill({ json: {
    repeated: false, order_group_id: groupId, row_count: 1, flow_enabled: true,
  } }))
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{
    id: groupId, version: 0, customer: '[TESTE] Bistro Cliente PJ', delivery_date: futureDelivery(),
    checked_at: null, released_at: null, departed_at: null, can_check: false, can_release: false,
    items: [], history: [],
  }] }))
  await page.route('**/rest/v1/rpc/read_pj_flow_activation_status', route => route.fulfill({ json: {
    mode: 'standard', can_return: false,
  } }))

  await page.goto('/pedidos-pj?legado=1&novo=1')
  await page.locator('select').selectOption({ label: '[TESTE] Bistro Cliente PJ' })
  await addBrioche(page)
  await page.locator('input[type="date"]').fill(futureDelivery())
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()

  await expect(page).toHaveURL(new RegExp(`pedido=${groupId}`))
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(page.getByRole('link', { name: 'Editar pedido', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cancelar pedido', exact: true })).toBeVisible()

  await page.route('**/rest/v1/orders*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'content-range': '0-0/1',
      'access-control-expose-headers': 'content-range',
    },
    json: [{
      id: '97000000-0000-4000-8000-000000000002',
      updated_at: '2026-09-11T10:00:00Z',
      order_group_id: groupId,
      customer_id: customerId,
      pj_client: '[TESTE] Bistro Cliente PJ',
      order_date: '2026-09-11',
      delivery_date: futureDelivery(),
      production_date: null,
      bread_id: '97000000-0000-4000-8000-000000000003',
      product_source: 'bread',
      product_name: '[TESTE] Brioche PJ',
      quantity: 12,
      unit_price: 31.55,
      pack_size: 12,
      pricing_unit: 'un',
      sale_option_id: null,
      obs: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      dispatched_at: null,
      dispatched_by: null,
      dispatched_by_name: null,
      dispatched_quantity: null,
      dispatched_quantity_reason: null,
      dispatched_quantity_at: null,
      dispatched_quantity_by_name: null,
      store: 'pj',
      order_type: 'pj',
    }],
  }))
  await page.route('**/rest/v1/customers*', route => route.fulfill({ json: [{
    id: customerId,
    name: '[TESTE] Bistro Cliente PJ',
    default_tier_id: tierId,
    discount_pct: 0,
    delivery_hours: 48,
    active: true,
  }] }))
  await page.route('**/rest/v1/price_tiers*', route => route.fulfill({ json: [{
    id: tierId,
    name: '[TESTE] Tabela PJ',
  }] }))
  await page.route('**/rest/v1/price_tier_items*', route => route.fulfill({ json: [{
    id: '97000000-0000-4000-8000-000000000006',
    tier_id: tierId,
    product_id: '97000000-0000-4000-8000-000000000003',
    product_source: 'bread',
    product_name: '[TESTE] Brioche PJ',
    unit_price: 31.55,
    pricing_unit: 'un',
    pack_size: 12,
    active: true,
    sale_option_id: null,
  }] }))
  await page.route('**/rest/v1/customer_price_overrides*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/replace_pj_order_atomic_v2', route => route.fulfill({ json: {
    repeated: false, order_group_id: groupId, row_count: 1, flow_enabled: true,
  } }))
  await page.route('**/rest/v1/rpc/cancel_pj_order_atomic', route => route.fulfill({ json: {
    repeated: false,
    order_group_id: groupId,
    row_count: 1,
    flow_enabled: true,
    cancelled_at: '2026-09-11T11:00:00Z',
    cancelled_by: 'Financeiro JC Teste',
    cancel_reason: '[TESTE] cancelamento standard',
  } }))
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`gerenciar=1.*pedido=${groupId}|pedido=${groupId}.*gerenciar=1`))
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancelar pedido', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByLabel('Quantidade de [TESTE] Brioche PJ').fill('2')
  const replaceResponse = page.waitForResponse(response => response.url().includes('/rpc/replace_pj_order_atomic_v2'))
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  expect((await replaceResponse).ok()).toBe(true)

  await page.getByRole('button', { name: /\[TESTE\] Bistro Cliente PJ/ }).first().click()
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click()
  await page.getByPlaceholder('Ex.: cliente desistiu').fill('[TESTE] cancelamento standard')
  const cancelResponse = page.waitForResponse(response => response.url().includes('/rpc/cancel_pj_order_atomic'))
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click()
  expect((await cancelResponse).ok()).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toContainText('CANCELADO')
})

test('URL direta não libera gerenciamento de pedido acompanhado', async ({ page }) => {
  await enterWithPreviewAccount(page)
  const groupId = '97000000-0000-4000-8000-000000000011'
  let activationMode: 'controlled_real' | 'standard' = 'controlled_real'
  let version = 0
  let checkedAt: string | null = null
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{
    id: groupId, version, customer: '[TESTE] Pedido protegido', delivery_date: futureDelivery(),
    checked_at: checkedAt, released_at: null, departed_at: null, can_check: true, can_release: false,
    items: [], history: [],
  }] }))
  await page.route('**/rest/v1/rpc/read_pj_flow_activation_status', route => route.fulfill({ json: {
    mode: activationMode, can_return: activationMode === 'controlled_real',
  } }))

  await page.goto(`/pedidos-pj?legado=1&gerenciar=1&pedido=${groupId}`)
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(page.getByRole('link', { name: 'Editar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cancelar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toHaveCount(0)

  activationMode = 'standard'
  version = 1
  checkedAt = '2026-09-11T11:00:00Z'
  await page.goto(`/pedidos-pj?legado=1&gerenciar=1&pedido=${groupId}`)
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(page.getByRole('link', { name: 'Editar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cancelar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toHaveCount(0)
})

test('URL direta não libera gerenciamento standard para Expedição', async ({ page }) => {
  await enterWithPreviewAccount(page, 'rodrigao+teste-expedicao-jc@gmail.com')
  const groupId = '97000000-0000-4000-8000-000000000012'
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{
    id: groupId, version: 0, customer: '[TESTE] Pedido standard protegido', delivery_date: futureDelivery(),
    checked_at: null, released_at: null, departed_at: null, can_check: true, can_release: false,
    items: [], history: [],
  }] }))
  await page.route('**/rest/v1/rpc/read_pj_flow_activation_status', route => route.fulfill({ json: {
    mode: 'standard', can_return: false,
  } }))

  await page.goto(`/pedidos-pj?legado=1&gerenciar=1&pedido=${groupId}`)
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(page.getByRole('link', { name: 'Editar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cancelar pedido', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ficha do pedido PJ' })).toHaveCount(0)
})

test('recusa confirmada libera a correção do rascunho', async ({ page }) => {
  await enterWithPreviewAccount(page)
  const bodies: Array<{ p_request_id: string; p_order_group_id: string }> = []
  await page.route('**/rest/v1/rpc/create_pj_order_atomic', async route => {
    bodies.push(route.request().postDataJSON() as { p_request_id: string; p_order_group_id: string })
    if (bodies.length === 1) {
      await route.fulfill({ status: 400, json: { code: '22023', message: 'Revise os dados do pedido' } })
      return
    }
    await route.fulfill({ json: {
      repeated: false, order_group_id: bodies[1].p_order_group_id, row_count: 1, flow_enabled: false,
    } })
  })

  await page.goto('/pedidos-pj?legado=1&novo=1')
  await page.locator('select').selectOption({ label: '[TESTE] Bistro Cliente PJ' })
  await addBrioche(page)
  const quantity = page.getByLabel('Quantidade de [TESTE] Brioche PJ')
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Salvar pedido', exact: true })).toBeEnabled()
  await quantity.fill('2')
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Pedidos', exact: true })).toHaveAttribute('aria-selected', 'true')

  expect(bodies).toHaveLength(2)
  expect(bodies[1].p_request_id).not.toBe(bodies[0].p_request_id)
  expect(bodies[1].p_order_group_id).not.toBe(bodies[0].p_order_group_id)
})
