import { expect, test, type Page } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// "Usar como base" substituiu o "Duplicar para hoje", que em 26/09 e 29/09/2026
// apagou o pedido de HOJE gerado pelo Planejamento e gravou por cima a cópia de
// outra semana. Aqui pedidos, pães e Planejamento vêm de rotas do próprio
// roteiro e toda gravação em `orders` é interceptada: nada chega ao banco de
// teste. O relógio do navegador fica parado numa segunda-feira, então o pedido
// aberto por padrão é o de terça e as datas conferidas são exatas.

const accounts = {
  admin: 'rodrigao+teste@gmail.com',
  expedicaoJc: 'rodrigao+teste-expedicao-jc@gmail.com',
  financeiroJc: 'rodrigao+teste-financeiro-jc@gmail.com',
} as const

const sourceDate = '2026-09-22'
const today = '2026-10-12' // segunda-feira na padaria
const target = '2026-10-13' // terça: o dia que o formulário abre por padrão
const mondayMorning = new Date('2026-10-12T13:00:00Z') // 10h em Brasília
const mondayLastMinute = new Date('2026-10-13T02:59:00Z') // 23h59 de segunda
const tuesdayFirstMinute = new Date('2026-10-13T03:01:00Z') // 00h01 de terça

const everyDayBread = { id: 'teste-base-pao-todo-dia', name: '[TESTE] Pão todo dia', days: [1, 2, 3, 4, 5, 6], active: true, is_pj: false }
const offDayBread = { id: 'teste-base-pao-fora-do-dia', name: '[TESTE] Pão fora do dia', days: [], active: true, is_pj: false }
const fromPlanning = 'Gerado pelo Planejamento'

type Row = ReturnType<typeof orderRow>

function orderRow(store: string, breadId: string, quantity: number, orderDate: string, obs = '') {
  return { store, bread_id: breadId, quantity, obs, pj_client: null, pj_delivery_date: null, order_date: orderDate }
}

function eqParam(url: string, name: string): string | null {
  const match = decodeURIComponent(url).match(new RegExp(`[?&]${name}=eq\\.([^&]+)`))
  return match ? match[1] : null
}

interface OrderWrite { method: string; url: string; body: unknown }

interface Scenario {
  ordersByDate: Record<string, Row[]>
  plannedStoresByDate: Record<string, string[]>
  /** Segura a consulta do Planejamento do dia até o roteiro soltar. */
  holdPlanning?: Promise<void>
  /** Segura a leitura dos pedidos de uma data até o roteiro soltar. */
  holdOrders?: { date: string; until: Promise<void> }
  /** A leitura dos pedidos desta data falha. */
  failOrdersOf?: string
}

async function enterWithPreviewAccount(page: Page, email: string) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

async function mockScenario(page: Page, scenario: Scenario): Promise<OrderWrite[]> {
  const writes: OrderWrite[] = []
  await page.route('**/rest/v1/sobras*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/breads*', route => route.fulfill({ json: [everyDayBread, offDayBread] }))
  await page.route('**/rest/v1/production_plans*', async route => {
    const url = decodeURIComponent(route.request().url())
    // Sem planejamento aberto: o cartão "Transformar em Pedido" fica fora da tela.
    if (url.includes('status=neq.fechado')) return route.fulfill({ json: [] })
    if (scenario.holdPlanning) await scenario.holdPlanning
    const date = eqParam(url, 'production_date') ?? ''
    return route.fulfill({ json: scenario.plannedStoresByDate[date] ? [{ id: `teste-plano-${date}` }] : [] })
  })
  await page.route('**/rest/v1/production_plan_items*', route => {
    const date = (eqParam(route.request().url(), 'plan_id') ?? '').replace('teste-plano-', '')
    return route.fulfill({ json: (scenario.plannedStoresByDate[date] ?? []).map(store => ({ store })) })
  })
  await page.route('**/rest/v1/orders*', async route => {
    const request = route.request()
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), url: decodeURIComponent(request.url()), body: request.postDataJSON() })
      return request.method() === 'DELETE'
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({ status: 201, json: [] })
    }
    const url = decodeURIComponent(request.url())
    if (url.includes('order_type=eq.encomenda')) return route.fulfill({ json: [] })
    const date = eqParam(url, 'order_date') ?? ''
    if (scenario.holdOrders?.date === date) await scenario.holdOrders.until
    if (scenario.failOrdersOf === date) return route.fulfill({ status: 500, json: { message: 'falha simulada' } })
    return route.fulfill({ json: scenario.ordersByDate[date] ?? [] })
  })
  return writes
}

const sourceRows = [
  orderRow('jc', everyDayBread.id, 21, sourceDate),
  orderRow('jc', offDayBread.id, 6, sourceDate),
  orderRow('ja', everyDayBread.id, 9, sourceDate),
  orderRow('ex', everyDayBread.id, 50, sourceDate),
]

async function openReportOf(page: Page, tabName: string, date: string) {
  await page.getByRole('tab', { name: tabName, exact: true }).click()
  await page.locator('input[type="date"]').fill(date)
}

test('Usar como base preenche o pedido de terça sem apagar o pedido de hoje do Planejamento', async ({ page }) => {
  await enterWithPreviewAccount(page, accounts.admin)
  await page.clock.setFixedTime(mondayMorning)
  let releasePlanning = () => {}
  const scenario: Scenario = {
    ordersByDate: {
      [sourceDate]: sourceRows,
      [today]: [orderRow('jc', everyDayBread.id, 40, today, fromPlanning), orderRow('ja', everyDayBread.id, 14, today, fromPlanning)],
      [target]: [orderRow('jc', everyDayBread.id, 33, target, fromPlanning), orderRow('ja', everyDayBread.id, 12, target)],
    },
    // Hoje as duas lojas vieram do Planejamento; na terça, só a JC.
    plannedStoresByDate: { [today]: ['jc', 'ja'], [target]: ['jc'] },
  }
  const writes = await mockScenario(page, scenario)
  await page.goto('/')

  const tabs = page.getByRole('tablist').getByRole('tab')
  await expect(tabs).toHaveText(['JC', 'JA', 'Relatório', 'Admin'], { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Ter', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const total = page.locator('.ps-total-num b')
  await expect(total).toHaveText('33')

  await openReportOf(page, 'Relatório', sourceDate)
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Duplicar/ })).toHaveCount(0)
  const useAsBase = page.getByRole('button', { name: 'Usar JC e JA como base do pedido', exact: true })

  // Quem desiste na confirmação fica com o pedido como estava.
  const declined = page.waitForEvent('dialog')
  await useAsBase.click()
  await (await declined).dismiss()
  await expect(page.getByRole('tab', { name: 'Relatório', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'JC', exact: true }).click()
  await expect(total).toHaveText('33')
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toHaveCount(0)

  // Enquanto confere o Planejamento, a tela fica coberta: ninguém troca o dia no meio.
  scenario.holdPlanning = new Promise<void>(resolve => { releasePlanning = resolve })
  await page.getByRole('tab', { name: 'Relatório', exact: true }).click()
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  const accepted = page.waitForEvent('dialog')
  await useAsBase.click()
  await expect(page.locator('.loading-overlay')).toContainText('Conferindo o Planejamento')
  releasePlanning()
  const confirmation = await accepted
  expect(confirmation.message()).toContain('Trocar o pedido de terça-feira, 13/10 pelas quantidades de terça-feira, 22/09?')
  expect(confirmation.message()).toContain('JC: agora 33 (esta data tem pedido gerado pelo Planejamento), cópia 21')
  expect(confirmation.message()).toContain('JA: agora 12, cópia 9')
  await confirmation.accept()

  await expect(page.getByRole('tab', { name: 'JC', exact: true })).toHaveAttribute('aria-selected', 'true')
  const notice = page.getByRole('status').filter({ hasText: 'ainda não salva' })
  await expect(notice).toContainText('Cópia de terça-feira, 22/09 ainda não salva')
  await expect(notice).toContainText(`${offDayBread.name} (6)`)
  await expect(total).toHaveText('21')
  expect(writes, 'a cópia não pode gravar nada antes do Salvar').toEqual([])

  // Dois toques no mesmo instante, antes de a tela travar o botão: um Salvar só.
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })
  await expect(notice).toHaveCount(0)
  await expect(page.locator('.toast', { hasText: 'Pedido salvo!' }).first()).toBeVisible()
  await page.waitForTimeout(500) // espaço para um Salvar duplicado aparecer, se existir
  expect(writes, 'um Salvar: um DELETE e um POST').toHaveLength(2)
  const [deletion, insertion] = writes
  expect(deletion.method).toBe('DELETE')
  expect(eqParam(deletion.url, 'store')).toBe('jc')
  expect(eqParam(deletion.url, 'order_date'), 'o Salvar grava a terça anunciada, nunca hoje').toBe(target)
  expect(insertion.method).toBe('POST')
  expect(insertion.body).toEqual([
    expect.objectContaining({ store: 'jc', bread_id: everyDayBread.id, quantity: 21, order_date: target }),
  ])

  // A JA continua com a cópia pendente até alguém salvar a aba dela.
  await page.getByRole('tab', { name: 'JA', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toBeVisible()
  await expect(total).toHaveText('9')

  // Meia-noite entre copiar e salvar: o "Ter" do Salvar já seria o da semana
  // que vem. O Salvar recusa em vez de gravar a cópia lá.
  await page.clock.setFixedTime(tuesdayFirstMinute)
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'O dia virou desde que o pedido foi aberto' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toBeVisible()
  expect(writes).toHaveLength(2)
})

test('Pedido mexido ou ainda carregando durante a cópia cancela a cópia', async ({ page }) => {
  await enterWithPreviewAccount(page, accounts.admin)
  await page.clock.setFixedTime(mondayMorning)
  const wednesday = '2026-10-14'
  const thursday = '2026-10-15'
  const friday = '2026-10-16'
  let releasePlanning = () => {}
  const dialogs: string[] = []
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept() })
  const scenario: Scenario = {
    ordersByDate: {
      [sourceDate]: sourceRows,
      [target]: [orderRow('jc', everyDayBread.id, 33, target, fromPlanning)],
      [wednesday]: [orderRow('jc', everyDayBread.id, 7, wednesday)],
      [thursday]: [orderRow('jc', everyDayBread.id, 4, thursday)],
    },
    plannedStoresByDate: { [target]: ['jc'] },
    holdPlanning: new Promise<void>(resolve => { releasePlanning = resolve }),
  }
  const writes = await mockScenario(page, scenario)
  await page.goto('/')

  await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['JC', 'JA', 'Relatório', 'Admin'], { timeout: 30_000 })
  await openReportOf(page, 'Relatório', sourceDate)
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Usar JC e JA como base do pedido', exact: true }).click()
  await expect(page.locator('.loading-overlay')).toContainText('Conferindo o Planejamento')

  // O clique de mouse para na tela coberta; o teclado não. dispatchEvent
  // aciona os botões como Tab + Enter fariam, por baixo da cobertura.
  await page.getByRole('tab', { name: 'JC', exact: true }).dispatchEvent('click')
  await page.getByRole('button', { name: 'Qua', exact: true }).dispatchEvent('click')
  await expect(page.locator('.ps-total-num b')).toHaveText('7')
  releasePlanning()

  await expect(page.locator('.toast', { hasText: 'O pedido mudou enquanto eu conferia o Planejamento' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toHaveCount(0)
  await expect(page.locator('.ps-total-num b')).toHaveText('7')

  // Pedido de quinta ainda chegando quando a cópia é pedida: a resposta
  // pendente reescreveria o formulário depois, então a cópia espera.
  let releaseThursday = () => {}
  scenario.holdOrders = { date: thursday, until: new Promise<void>(resolve => { releaseThursday = resolve }) }
  await page.getByRole('button', { name: 'Qui', exact: true }).click()
  await expect(page.locator('.loading-overlay')).toContainText('Carregando pedidos')
  // O Salvar por baixo da cobertura gravaria em quinta as quantidades de quarta.
  const waitToast = page.locator('.toast', { hasText: 'Aguarde o pedido do dia carregar' })
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).dispatchEvent('click')
  await expect(waitToast).toBeVisible()
  await expect(waitToast).toHaveCount(0) // some sozinho; o próximo aviso igual é da cópia
  await page.getByRole('tab', { name: 'Relatório', exact: true }).dispatchEvent('click')
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Usar JC e JA como base do pedido', exact: true }).dispatchEvent('click')
  await expect(waitToast).toBeVisible()
  releaseThursday()
  await page.getByRole('tab', { name: 'JC', exact: true }).click()
  await expect(page.locator('.ps-total-num b')).toHaveText('4')
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toHaveCount(0)

  // Leitura de sexta falha: a tela segue com os números de quinta, que não
  // podem ir para sexta nem pelo Salvar nem pela cópia.
  scenario.failOrdersOf = friday
  await page.getByRole('button', { name: 'Sex', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Erro ao carregar pedidos.' })).toBeVisible()
  await expect(page.locator('.ps-total-num b')).toHaveText('4')
  const notLoadedToast = page.locator('.toast', { hasText: 'O pedido deste dia não carregou' })
  await page.getByRole('button', { name: 'Salvar pedido', exact: true }).click()
  await expect(notLoadedToast).toBeVisible()
  await expect(notLoadedToast).toHaveCount(0, { timeout: 10_000 }) // aviso de 6 s; o próximo igual é da cópia
  await openReportOf(page, 'Relatório', sourceDate)
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Usar JC e JA como base do pedido', exact: true }).click()
  await expect(notLoadedToast).toBeVisible()

  expect(dialogs, 'a cópia cancelada não chega a perguntar').toEqual([])
  expect(writes).toEqual([])
})

test('Expedição JC: a virada do dia recusa a cópia e o dia recarregado recebe sem perguntar', async ({ page }) => {
  await enterWithPreviewAccount(page, accounts.expedicaoJc)
  await page.clock.setFixedTime(mondayLastMinute)
  const dialogs: string[] = []
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss() })
  const writes = await mockScenario(page, {
    ordersByDate: { [sourceDate]: sourceRows },
    plannedStoresByDate: {},
  })
  await page.goto('/')

  await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['Loja JC', 'Histórico'], { timeout: 30_000 })
  await openReportOf(page, 'Histórico', sourceDate)
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  const useAsBase = page.getByRole('button', { name: 'Usar como base do pedido', exact: true })

  // Meia-noite com a tela aberta: o formulário ainda é o desta terça, mas o
  // "Ter" do Salvar já seria o da semana que vem.
  await page.clock.setFixedTime(tuesdayFirstMinute)
  await useAsBase.click()
  await expect(page.locator('.toast', { hasText: 'O dia virou desde que o pedido foi aberto' })).toBeVisible()
  await page.getByRole('tab', { name: 'Loja JC', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toHaveCount(0)
  await expect(page.locator('.ps-total-num b')).toHaveText('0')

  await page.getByRole('button', { name: 'Ter', exact: true }).click()
  await openReportOf(page, 'Histórico', sourceDate)
  await expect(page.locator('.report-table tr', { hasText: everyDayBread.name })).toContainText('21', { timeout: 15_000 })
  await useAsBase.click()
  await expect(page.getByRole('tab', { name: 'Loja JC', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'ainda não salva' })).toContainText('terça-feira, 20/10')
  await expect(page.locator('.ps-total-num b')).toHaveText('21')
  expect(dialogs, 'formulário vazio não pede confirmação').toEqual([])
  expect(writes).toEqual([])
})

test('Financeiro no histórico PJ não tem cópia e é levado à tela Pedidos PJ', async ({ page }) => {
  await enterWithPreviewAccount(page, accounts.financeiroJc)
  await page.clock.setFixedTime(mondayMorning)
  const writes = await mockScenario(page, { ordersByDate: { [sourceDate]: sourceRows }, plannedStoresByDate: {} })
  await page.goto('/')

  await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['Histórico'], { timeout: 30_000 })
  await page.locator('input[type="date"]').fill(sourceDate)
  await expect(page.getByText('Nenhum pedido PJ nesta data.')).toBeVisible({ timeout: 15_000 })
  const pjNote = page.getByText('Pedido PJ novo ou alterado se faz na tela')
  await expect(pjNote.getByRole('link', { name: 'Pedidos PJ', exact: true })).toHaveAttribute('href', '/pedidos-pj')
  await expect(page.getByRole('button', { name: /Duplicar|como base/ })).toHaveCount(0)
  expect(writes).toEqual([])
})
