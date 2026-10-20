import { expect, test } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({ browserName: 'chromium', channel: 'chrome' })

// A aba "Itens JC" (lista manual dos não-pães da JC) saiu em 11/10/2026: não
// tinha lançamento desde 16/06 e, ao salvar o dia, apagava as linhas dos
// produtos que ela não mostrava. Estes roteiros só leem; nada é gravado.

const previewAccounts = {
  admin: 'rodrigao+teste@gmail.com',
  geolarJc: 'rodrigao+teste-geolar-jc@gmail.com',
} as const

const visualBreadId = 'teste-tela-inicial-pao'
const visualBreadName = '[TESTE] Pão visual da tela inicial'

test('Administrador ve JC, JA, Relatorio e Admin na tela inicial, sem Itens JC', async ({ page }) => {
  await entrarComSessaoGuardada(page, previewAccounts.admin)
  await page.goto('/')

  const tabs = page.getByRole('tablist').getByRole('tab')
  await expect(tabs).toHaveText(['JC', 'JA', 'Relatório', 'Admin'], { timeout: 30_000 })

  // As abas que vinham depois da que saiu continuam abrindo o próprio conteúdo.
  const report = page.getByRole('tab', { name: 'Relatório', exact: true })
  await report.click()
  await expect(report).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '↻ Atualizar' })).toBeVisible({ timeout: 15_000 })

  const admin = page.getByRole('tab', { name: 'Admin', exact: true })
  await admin.click()
  await expect(admin).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Copiar para WhatsApp' })).toBeVisible()
})

async function mockGeolarSheet(page: import('@playwright/test').Page) {
  // O Banco Preview guarda de propósito uma sobra pendente que trava esta tela
  // (ver auth.smoke). Aqui a trava responde "nada pendente" e a folha recebe um
  // pão fictício com pedido nas três lojas; o resto vem do banco de teste.
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/breads*', route => route.fulfill({
    json: [{ id: visualBreadId, name: visualBreadName, days: [1, 2, 3, 4, 5, 6], active: true, is_pj: false }],
  }))
  await page.route('**/rest/v1/orders*', route => {
    const url = decodeURIComponent(route.request().url())
    if (url.includes('order_type=eq.encomenda')) return route.fulfill({ json: [] })
    return route.fulfill({
      json: (['ex', 'jc', 'ja'] as const).map((store, index) => ({
        store, bread_id: visualBreadId, quantity: index + 1, obs: '', order_date: '2026-10-12',
      })),
    })
  })
  // Imprimir e copiar ficam registrados na página, sem abrir janela nem mexer
  // na área de transferência da máquina do CI. Cada impressão guarda o total do
  // pão fictício, o cabeçalho da folha e as encomendas como estavam naquele instante.
  await page.addInitScript(breadName => {
    const record = window as Window & {
      __prints?: number; __printedTotals?: string[]; __printedHeaders?: string[]; __printedEncomendas?: string[]; __copied?: string
    }
    record.__prints = 0
    record.__printedTotals = []
    record.__printedHeaders = []
    record.__printedEncomendas = []
    window.print = () => {
      record.__prints = (record.__prints ?? 0) + 1
      const row = Array.from(document.querySelectorAll('.print-row'))
        .find(candidate => candidate.textContent?.includes(breadName))
      record.__printedTotals?.push(row?.querySelector('.ptotal')?.textContent ?? '')
      record.__printedHeaders?.push(document.querySelector('.print-card .pmeta')?.textContent ?? '')
      const encomendas = Array.from(document.querySelectorAll('.print-card'))
        .find(card => card.querySelector('h3')?.textContent?.includes('Encomendas'))
      record.__printedEncomendas?.push(encomendas?.textContent ?? '')
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { record.__copied = text } },
    })
  }, visualBreadName)
}

function printCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __prints?: number }).__prints)
}

function printedTotals(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __printedTotals?: string[] }).__printedTotals)
}

function printedHeaders(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __printedHeaders?: string[] }).__printedHeaders)
}

function printedEncomendas(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __printedEncomendas?: string[] }).__printedEncomendas)
}

// Conexão parada sem erro: ao abrir, a tela recebe 5 PJ do pão fictício. A
// partir do clique, a primeira leitura do PJ fica sem resposta até o fim do
// teste; as seguintes respondem com 8 PJ, como depois de uma programação nova.
async function stallPjAfterOpening(page: import('@playwright/test').Page) {
  const pj = { stalled: false, calls: 0, release: (): void => undefined }
  const released = new Promise<void>(resolve => { pj.release = resolve })
  page.once('close', () => pj.release())
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', async route => {
    if (!pj.stalled) return route.fulfill({ json: [{ bread_id: visualBreadId, quantity: 5 }] })
    pj.calls += 1
    if (pj.calls > 1) return route.fulfill({ json: [{ bread_id: visualBreadId, quantity: 8 }] })
    await released
    await route.fulfill({ json: [] }).catch(() => undefined)
  })
  return pj
}

async function openGeolarWithPj(page: import('@playwright/test').Page) {
  await entrarComSessaoGuardada(page, previewAccounts.geolarJc)
  await page.goto('/')

  // O rótulo muda durante a espera; o localizador aceita os dois.
  const printBreads = page.getByRole('button', { name: /Imprimir pães|Preparando impressão/ })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadTotal = page.locator('.print-row', { hasText: visualBreadName }).locator('.ptotal')
  await expect(breadTotal).toHaveText('11 (5 PJ)')
  return { printBreads, breadTotal }
}

test('Geolar imprime e copia a folha de paes, sem bloco de Itens JC', async ({ page }) => {
  await mockGeolarSheet(page)
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({ json: [] }))

  await entrarComSessaoGuardada(page, previewAccounts.geolarJc)
  await page.goto('/')

  const printBreads = page.getByRole('button', { name: '🖨 Imprimir pães' })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadRow = page.locator('.print-row', { hasText: visualBreadName })
  await expect(breadRow.locator('.ptotal')).toHaveText('6')
  await expect(page.getByText(/Itens JC/)).toHaveCount(0)

  await printBreads.click()
  await expect.poll(() => printCount(page)).toBe(1)
  expect(await printedTotals(page)).toEqual(['6'])

  // No papel fica a folha; a barra do topo e os botões somem.
  await page.emulateMedia({ media: 'print' })
  await expect(breadRow).toBeVisible()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(printBreads).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  const copied = () => page.evaluate(() => (window as Window & { __copied?: string }).__copied ?? '')
  await page.getByRole('button', { name: '📋 Copiar texto' }).click()
  await expect.poll(copied).toContain(`${visualBreadName}  1+2+3`)
  expect(await copied()).toMatch(/^\*Pane & Salute — Produção /)
  expect(await copied()).not.toContain('Itens JC')
})

test('Geolar imprime com o que esta na tela quando a leitura do PJ para sem erro', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  const pj = await stallPjAfterOpening(page)
  const { printBreads, breadTotal } = await openGeolarWithPj(page)

  pj.stalled = true
  await printBreads.click()
  // Soft: no código antigo o botão não muda, e o relatório ainda mostra que a
  // impressão não saiu, que é o defeito que este roteiro guarda.
  await expect.soft(printBreads).toHaveText('Preparando impressão…')
  await expect.soft(printBreads).toBeDisabled()

  await expect.poll(() => printCount(page), { timeout: 15_000 }).toBe(1)
  expect(pj.calls).toBe(1)
  expect(await printedTotals(page)).toEqual(['11 (5 PJ)'])
  await expect(printBreads).toHaveText('🖨 Imprimir pães')
  await expect(printBreads).toBeEnabled()

  // A resposta atrasada chega depois: atualiza a tela e não imprime de novo.
  pj.release()
  await expect(breadTotal).toHaveText('6')
  await page.waitForTimeout(1_000)
  expect(await printCount(page)).toBe(1)
})

test('Geolar imprime com a programacao PJ feita durante a espera, sem esperar a leitura parada', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  const pj = await stallPjAfterOpening(page)
  const { printBreads, breadTotal } = await openGeolarWithPj(page)

  pj.stalled = true
  await printBreads.click()
  await expect.poll(() => pj.calls).toBe(1)

  // Nova programação PJ enquanto a leitura do botão está parada: a folha sai
  // com ela assim que chega, bem antes do prazo de 5 segundos.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pj-production-scheduled')))
  await expect.poll(() => printCount(page), { timeout: 3_000 }).toBe(1)
  expect(pj.calls).toBe(2)
  expect(await printedTotals(page)).toEqual(['14 (8 PJ)'])

  // A leitura antiga, quando enfim responde, é descartada: a tela fica com a
  // programação nova e nada é impresso de novo.
  pj.release()
  await page.waitForTimeout(1_000)
  await expect(breadTotal).toHaveText('14 (8 PJ)')
  expect(await printCount(page)).toBe(1)
})

test('Geolar nao imprime o aviso de sobras quando a conferencia abre durante a espera do PJ', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  const pj = await stallPjAfterOpening(page)
  const { printBreads, breadTotal } = await openGeolarWithPj(page)

  // Daqui em diante a trava responde "proposta pendente", como quando uma loja
  // propõe reaproveitar sobra. A rota registrada por último vale primeiro.
  const gate = { pending: true }
  await page.route('**/rest/v1/bread_reuse_plans*', route => route.fulfill({
    json: gate.pending ? [{ id: 'teste-proposta-pendente' }] : [],
  }))

  pj.stalled = true
  await printBreads.click()
  await expect(printBreads).toHaveText('Preparando impressão…')
  // Durante a espera alguém atualiza a tela e a conferência de sobras fecha a lista.
  await page.getByRole('button', { name: '↻ Atualizar' }).click()
  await expect(page.getByRole('heading', { name: 'Confira as sobras antes da produção' })).toBeVisible()

  // Esgotado o prazo do PJ, nada vai para a impressora e o motivo fica escrito.
  // Soft: no código antigo o aviso não existe, e o relatório ainda mostra que o
  // aviso de bloqueio foi impresso, que é o defeito que este roteiro guarda.
  const cancelled = page.getByRole('status').filter({ hasText: 'A impressão dos pães foi cancelada' })
  await expect.soft(cancelled).toBeVisible({ timeout: 15_000 })
  expect(await printCount(page)).toBe(0)
  expect(pj.calls).toBe(1)

  // Com a lista liberada de novo, o aviso continua até a próxima tentativa,
  // não vai para o papel, e imprimir volta a funcionar. A outra data tem
  // pedidos diferentes (2+3+4) para provar que a folha nova terminou de chegar.
  gate.pending = false
  await page.route('**/rest/v1/orders*', route => {
    if (!decodeURIComponent(route.request().url()).includes('order_date=eq.2000-01-03')) return route.fallback()
    return route.fulfill({
      json: (['ex', 'jc', 'ja'] as const).map((store, index) => ({
        store, bread_id: visualBreadId, quantity: index + 2, obs: '', order_date: '2000-01-03',
      })),
    })
  })
  await page.locator('input[type="date"]').fill('2000-01-03')
  await expect(breadTotal).toHaveText('14 (5 PJ)')
  await expect(cancelled).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(cancelled).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  await printBreads.click()
  await expect(cancelled).toBeHidden()
  await expect.poll(() => printCount(page)).toBe(1)
  expect(pj.calls).toBe(2)
  expect(await printedTotals(page)).toEqual(['17 (8 PJ)'])

  // A leitura do PJ que travou, quando enfim responde, é descartada e não
  // imprime de novo.
  pj.release()
  await page.waitForTimeout(1_000)
  await expect(breadTotal).toHaveText('17 (8 PJ)')
  expect(await printCount(page)).toBe(1)
})

// Outra data com pedidos diferentes (2+3+4) para provar de onde veio a folha.
function ordersFor(date: string, quantities: readonly number[]) {
  return (['ex', 'jc', 'ja'] as const).map((store, index) => ({
    store, bread_id: visualBreadId, quantity: quantities[index], obs: '', order_date: date,
  }))
}

const renamedBreadName = '[TESTE] Pão com nome trocado'
const previousEncomenda = '[TESTE] Bolo da data anterior'
const newEncomenda = '[TESTE] Bolo da data nova'

function encomendaFor(name: string) {
  return [{ product_name: name, bread_id: visualBreadId, quantity: 1, pj_client: 'Cliente ficticio' }]
}

type SheetRead = 'pedidos' | 'encomendas'
const sheetReads = [
  { read: 'pedidos', label: 'os pedidos' },
  { read: 'encomendas', label: 'as encomendas' },
] as const

// A data de abertura tem uma encomenda; a data nova (03/01) tem pedidos 2+3+4
// e outra encomenda. Cada leitura da data nova pode ficar parada ou falhar.
// Os pedidos das lojas filtram por order_date; as encomendas, por production_date.
async function routeNewDate(page: import('@playwright/test').Page) {
  const control = {
    hold: null as SheetRead | null,
    fail: null as SheetRead | null,
    reads: { pedidos: 0, encomendas: 0 },
    release: (): void => undefined,
  }
  const released = new Promise<void>(resolve => { control.release = resolve })
  page.once('close', () => control.release())
  await page.route('**/rest/v1/orders*', async route => {
    const url = decodeURIComponent(route.request().url())
    const read: SheetRead = url.includes('order_type=eq.encomenda') ? 'encomendas' : 'pedidos'
    const isNewDate = url.includes(read === 'encomendas' ? 'production_date=eq.2000-01-03' : 'order_date=eq.2000-01-03')
    if (!isNewDate) {
      if (read === 'encomendas') return route.fulfill({ json: encomendaFor(previousEncomenda) })
      return route.fallback()
    }
    control.reads[read] += 1
    if (control.hold === read) await released
    if (control.fail === read) {
      return route.fulfill({ status: 503, json: { message: 'fora do ar no teste' } }).catch(() => undefined)
    }
    const json = read === 'encomendas' ? encomendaFor(newEncomenda) : ordersFor('2000-01-03', [2, 3, 4])
    await route.fulfill({ json }).catch(() => undefined)
  })
  return control
}

function nothingPrinted(page: import('@playwright/test').Page) {
  return Promise.all([printedHeaders(page), printedTotals(page)])
    .then(([headers, totals]) => ({ headers, totals }))
}

for (const slow of sheetReads) {
  test(`Geolar nao imprime a data nova com a folha da data anterior quando ${slow.label} demoram durante a espera do PJ`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.clock.install()
    await mockGeolarSheet(page)
    const pj = await stallPjAfterOpening(page)
    const newDate = await routeNewDate(page)
    newDate.hold = slow.read
    const { printBreads, breadTotal } = await openGeolarWithPj(page)
    const encomendas = page.locator('.print-card', { hasText: 'Encomendas a produzir' })
    await expect(encomendas).toContainText(previousEncomenda)

    // O relógio da página para: os 5 s de espera do PJ só correm quando o
    // roteiro mandar, depois de o cenário estar montado.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000))
    pj.stalled = true
    await printBreads.click()
    await expect(printBreads).toHaveText('Preparando impressão…')

    // Durante a espera a pessoa troca a data. A trava libera e a leitura da
    // data nova fica parada, com a tela carregando.
    await page.locator('input[type="date"]').fill('2000-01-03')
    await expect.poll(() => newDate.reads[slow.read]).toBe(1)
    await expect(page.locator('.loading-overlay')).toBeVisible()
    // Nenhum cartão de bloqueio: nem a trava de sobras nem falha de leitura.
    await expect(page.locator('.ps-card[role="alert"]')).toHaveCount(0)
    // Soft: no código antigo a folha misturada fica na tela, com imprimir e
    // copiar; o relatório ainda mostra o papel impresso logo abaixo.
    await expect.soft(page.getByRole('status').filter({ hasText: 'Carregando a lista de produção' })).toBeVisible()
    await expect.soft(breadTotal).toBeHidden()
    await expect.soft(page.getByRole('button', { name: '📋 Copiar texto' })).toBeHidden()

    // Esgotado o prazo do PJ, nada vai para a impressora e o motivo fica escrito.
    await page.clock.runFor(5_000)
    const cancelled = page.getByRole('status').filter({ hasText: 'A impressão dos pães foi cancelada' })
    await expect.soft(cancelled).toBeVisible()
    expect(await nothingPrinted(page)).toEqual({ headers: [], totals: [] })
    expect(pj.calls).toBe(1)
    await page.clock.resume()

    // Com a folha da data nova na tela, imprimir de novo sai com ela inteira.
    newDate.release()
    await expect(page.locator('.loading-overlay')).toBeHidden()
    await expect(breadTotal).toHaveText('14 (5 PJ)')
    await expect(encomendas).toContainText(newEncomenda)
    await expect(cancelled).toBeVisible()
    await printBreads.click()
    await expect(cancelled).toBeHidden()
    await expect.poll(() => printCount(page)).toBe(1)
    expect(pj.calls).toBe(2)
    expect(await printedTotals(page)).toEqual(['17 (8 PJ)'])
    expect((await printedHeaders(page))?.[0]).toContain('03/01')
    const printedEncomenda = (await printedEncomendas(page))?.[0]
    expect(printedEncomenda).toContain(newEncomenda)
    expect(printedEncomenda).not.toContain(previousEncomenda)

    // A leitura do PJ que travou, quando enfim responde, não imprime de novo.
    pj.release()
    await page.waitForTimeout(1_000)
    expect(await printCount(page)).toBe(1)
  })
}

for (const failing of sheetReads) {
  test(`Geolar nao mostra nem imprime a folha da data anterior quando ${failing.label} da data nova nao carregam`, async ({ page }) => {
    test.setTimeout(90_000)
    await mockGeolarSheet(page)
    const pj = await stallPjAfterOpening(page)
    const newDate = await routeNewDate(page)
    newDate.fail = failing.read
    const { printBreads, breadTotal } = await openGeolarWithPj(page)
    const encomendas = page.locator('.print-card', { hasText: 'Encomendas a produzir' })

    pj.stalled = true
    await printBreads.click()
    await expect(printBreads).toHaveText('Preparando impressão…')
    await page.locator('input[type="date"]').fill('2000-01-03')

    // A leitura falha: no lugar da folha da data anterior fica o motivo, sem
    // imprimir nem copiar. Soft pelo mesmo motivo dos roteiros acima.
    const failed = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os pedidos' })
    await expect.soft(failed).toBeVisible()
    await expect.soft(breadTotal).toBeHidden()
    await expect.soft(encomendas).toBeHidden()
    await expect.soft(page.getByRole('button', { name: '📋 Copiar texto' })).toBeHidden()
    const cancelled = page.getByRole('status').filter({ hasText: 'A impressão dos pães foi cancelada' })
    await expect.soft(cancelled).toBeVisible({ timeout: 15_000 })
    expect(await nothingPrinted(page)).toEqual({ headers: [], totals: [] })

    // Com a conexão de volta, Tentar novamente traz a folha da data nova.
    newDate.fail = null
    await failed.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(breadTotal).toHaveText('14 (5 PJ)')
    await expect(encomendas).toContainText(newEncomenda)
    await expect(failed).toBeHidden()
    await printBreads.click()
    await expect.poll(() => printCount(page)).toBe(1)
    expect(await printedTotals(page)).toEqual(['17 (8 PJ)'])
    expect((await printedHeaders(page))?.[0]).toContain('03/01')
    expect((await printedEncomendas(page))?.[0]).toContain(newEncomenda)

    pj.release()
    await page.waitForTimeout(1_000)
    expect(await printCount(page)).toBe(1)
  })
}

test('Geolar fica com a ultima data escolhida quando duas trocas de data se cruzam', async ({ page }) => {
  test.setTimeout(90_000)
  await mockGeolarSheet(page)
  await page.route('**/rest/v1/rpc/list_pj_production_for_oven_v2', route => route.fulfill({ json: [] }))

  // A conferência de sobras da primeira data escolhida (03/01) demora. A tela
  // de conferência não cobre o campo de data, e a pessoa escolhe 10/01.
  const firstGate = { release: (): void => undefined }
  const firstGateReleased = new Promise<void>(resolve => { firstGate.release = resolve })
  page.once('close', () => firstGate.release())
  // O catálogo lido pela primeira data, quando ela enfim anda, é outro (pão
  // renomeado entre as leituras). Ele também não pode chegar à folha.
  const staleCatalog = { active: false }
  await page.route('**/rest/v1/breads*', route => {
    if (!staleCatalog.active) return route.fallback()
    return route.fulfill({
      json: [{ id: visualBreadId, name: renamedBreadName, days: [1, 2, 3, 4, 5, 6], active: true, is_pj: false }],
    })
  })
  await page.route('**/rest/v1/bread_reuse_plans*', async route => {
    if (decodeURIComponent(route.request().url()).includes('target_production_date=eq.2000-01-03')) await firstGateReleased
    await route.fulfill({ json: [] }).catch(() => undefined)
  })
  await page.route('**/rest/v1/orders*', route => {
    const url = decodeURIComponent(route.request().url())
    if (url.includes('order_type=eq.encomenda')) {
      if (url.includes('production_date=eq.2000-01-03')) return route.fulfill({ json: encomendaFor('[TESTE] Bolo de 03/01') })
      if (url.includes('production_date=eq.2000-01-10')) return route.fulfill({ json: encomendaFor('[TESTE] Bolo de 10/01') })
      return route.fallback()
    }
    if (url.includes('order_date=eq.2000-01-03')) return route.fulfill({ json: ordersFor('2000-01-03', [2, 3, 4]) })
    if (url.includes('order_date=eq.2000-01-10')) return route.fulfill({ json: ordersFor('2000-01-10', [3, 4, 5]) })
    return route.fallback()
  })

  await entrarComSessaoGuardada(page, previewAccounts.geolarJc)
  await page.goto('/')
  const printBreads = page.getByRole('button', { name: '🖨 Imprimir pães' })
  await expect(printBreads).toBeEnabled({ timeout: 30_000 })
  const breadTotal = page.locator('.print-row', { hasText: visualBreadName }).locator('.ptotal')
  await expect(breadTotal).toHaveText('6')
  const encomendas = page.locator('.print-card', { hasText: 'Encomendas a produzir' })

  const dateInput = page.locator('input[type="date"]')
  await dateInput.fill('2000-01-03')
  await expect(page.getByRole('heading', { name: 'Conferindo sobras…' })).toBeVisible()
  await dateInput.fill('2000-01-10')
  await expect(breadTotal).toHaveText('12')
  await expect(encomendas).toContainText('[TESTE] Bolo de 10/01')

  // A primeira data termina depois. Sua última leitura são as encomendas:
  // terminada essa leitura e uma volta pela fila da página, a carga antiga
  // acabou, e a folha continua sendo a da data escolhida por último.
  const firstLastRead = page.waitForEvent('requestfinished', request => {
    const url = decodeURIComponent(request.url())
    return url.includes('order_type=eq.encomenda') && url.includes('production_date=eq.2000-01-03')
  })
  staleCatalog.active = true
  firstGate.release()
  await firstLastRead
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
  await expect(dateInput).toHaveValue('2000-01-10')
  await expect(page.locator('.print-card .pmeta').first()).toContainText('10/01')
  await expect(breadTotal).toHaveText('12')
  await expect(page.getByText(renamedBreadName)).toHaveCount(0)
  await expect(encomendas).toContainText('[TESTE] Bolo de 10/01')
  await expect(page.locator('.loading-overlay')).toBeHidden()

  await printBreads.click()
  await expect.poll(() => printCount(page)).toBe(1)
  expect(await printedTotals(page)).toEqual(['12'])
  expect((await printedHeaders(page))?.[0]).toContain('10/01')
  const printedEncomenda = (await printedEncomendas(page))?.[0]
  expect(printedEncomenda).toContain('[TESTE] Bolo de 10/01')
  expect(printedEncomenda).not.toContain('[TESTE] Bolo de 03/01')
})
