import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const slowPreviewDataTimeoutMs = 15_000

async function enterWithPreviewAccount(page: Page) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas fictícias existe somente no secret do GitHub.')
  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(financeiroJc)
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
    await page.getByPlaceholder('Digite ou clique pra ver produtos da tabela').fill('Brioche PJ')
    await page.getByText('[TESTE] Brioche PJ', { exact: true }).click()
    await page.locator('input[type="date"]').fill(futureDelivery())

    await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Salvar pedido', exact: true })).toBeEnabled()

    // A memória da página some, como aconteceria após queda/reabertura. O
    // marcador persistente repete exatamente o pedido anterior antes de aceitar
    // qualquer rascunho novo.
    await page.reload()
    await page.getByRole('tab', { name: '+ Novo pedido', exact: true }).click()
    await page.locator('select').selectOption({ label: '[TESTE] Cafe Cliente PJ' })
    await page.getByPlaceholder('Digite ou clique pra ver produtos da tabela').fill('Brioche PJ')
    await page.getByText('[TESTE] Brioche PJ', { exact: true }).click()
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
    const replaceResponse = page.waitForResponse(response => response.url().includes('/rpc/replace_pj_order_atomic'))
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    expect((await replaceResponse).ok()).toBe(true)

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
    if (groupId && rpcUrl) {
      await request.post(rpcUrl.replace('create_pj_order_atomic', 'cancel_pj_order_atomic'), {
        headers: rpcHeaders,
        data: {
          p_request_id: randomUUID(),
          p_order_group_id: groupId,
          p_reason: '[TESTE] limpeza após execução interrompida',
        },
      }).catch(() => undefined)
    }
  }
})

test('sucesso no modo padrão abre o pedido na nova jornada', async ({ page }) => {
  await enterWithPreviewAccount(page)
  const groupId = '97000000-0000-4000-8000-000000000001'
  await page.route('**/rest/v1/rpc/create_pj_order_atomic', route => route.fulfill({ json: {
    repeated: false, order_group_id: groupId, row_count: 1, flow_enabled: true,
  } }))
  await page.route('**/rest/v1/rpc/read_pj_flow_pilot', route => route.fulfill({ json: [{
    id: groupId, version: 0, customer: '[TESTE] Bistro Cliente PJ', delivery_date: futureDelivery(),
    checked_at: null, released_at: null, departed_at: null, can_check: false, can_release: false,
    items: [], history: [],
  }] }))

  await page.goto('/pedidos-pj?legado=1&novo=1')
  await page.locator('select').selectOption({ label: '[TESTE] Bistro Cliente PJ' })
  await page.getByPlaceholder('Digite ou clique pra ver produtos da tabela').fill('Brioche PJ')
  await page.getByText('[TESTE] Brioche PJ', { exact: true }).click()
  await page.locator('input[type="date"]').fill(futureDelivery())
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()

  await expect(page).toHaveURL(new RegExp(`pedido=${groupId}`))
  await expect(page.getByRole('navigation', { name: 'Escolher pedido' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
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
  await page.getByPlaceholder('Digite ou clique pra ver produtos da tabela').fill('Brioche PJ')
  await page.getByText('[TESTE] Brioche PJ', { exact: true }).click()
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
