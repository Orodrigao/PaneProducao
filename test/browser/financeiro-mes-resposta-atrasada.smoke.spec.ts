import { randomUUID } from 'node:crypto'
import { expect, test, type Route } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function previousMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} de ${year}`
}

function requestedMonth(url: string): string | null {
  return /competence_month=gte\.(\d{4}-\d{2})-01/.exec(decodeURIComponent(url))?.[1] ?? null
}

function ledgerEntry(monthKey: string, description: string) {
  return {
    id: randomUUID(),
    entry_type: 'lancamento',
    category_id: randomUUID(),
    account_id: null,
    store: 'jc',
    competence_month: `${monthKey}-01`,
    paid_date: `${monthKey}-02`,
    planned_amount: null,
    amount: 1,
    payment_method: null,
    description,
    source: 'avulso',
    source_ref: null,
    recurrence_month: null,
    transfer_id: null,
    transfer_leg: null,
    reversal_of: null,
    reversal_reason: null,
    reversed_at: null,
    created_at: new Date().toISOString(),
    source_detail: null,
    fee_of: null,
    fee_rate: null,
    fee_rate_version_id: null,
  }
}

// A tela abre no mês atual e a pessoa troca o Mês logo em seguida. Com a rede
// lenta, a resposta do mês atual chegava depois da do mês escolhido e a lista
// passava a ser a do mês atual sob o título do escolhido (PR 535, 30/10). Aqui
// toda leitura do mês de abertura fica segura (inclusive a repetida pelo
// Strict Mode do next dev) até a lista do mês escolhido aparecer, e então
// chega com um lançamento que só ela tem. O mês escolhido também é respondido
// aqui, com um lançamento conhecido, para provar que a lista dele aparece e
// fica. Somente leitura: nada é gravado.
test('Financeiro JC troca o mês e a resposta atrasada do mês de abertura não troca a lista', async ({ page }) => {
  await entrarComSessaoGuardada(page, financeiroJc)

  const marker = `[TESTE] resposta atrasada ${Date.now()}`
  const chosenMarker = `[TESTE] lista do mês escolhido ${Date.now()}`
  const held: Route[] = []
  let openedMonth: string | null = null
  let chosenMonth: string | null = null
  let markHeld: () => void = () => {}
  const firstHeld = new Promise<void>(resolve => { markHeld = resolve })
  await page.route(/\/rest\/v1\/finance_entries\?/, route => {
    const month = requestedMonth(route.request().url())
    openedMonth ??= month
    if (month !== null && month === chosenMonth) return route.fulfill({ json: [ledgerEntry(month, chosenMarker)] })
    if (month === null || month !== openedMonth) return route.fallback()
    held.push(route)
    markHeld()
  })
  // Aceita, a leitura antiga ainda pediria o status do relatório diário antes
  // de pintar a lista; respondido aqui na hora, sem ida ao banco, o caminho
  // dela até a tela fica só no navegador.
  await page.route('**/rest/v1/rpc/get_payable_due_report_status*', route => route.fulfill({ json: [] }))

  try {
    await page.goto('/financeiro')
    await expect(page.getByText('livro de entradas e saídas')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
    await firstHeld

    const monthInput = page.getByLabel('Mês')
    await expect(monthInput).toHaveValue(openedMonth!)
    const chosen = previousMonth(openedMonth!)
    chosenMonth = chosen
    await monthInput.fill(chosen)

    await expect(page.getByText(monthLabel(chosen), { exact: true })).toBeVisible()
    await expect(page.locator('article', { hasText: chosenMarker })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
    await expect(page.getByText('Carregando lançamentos...')).toHaveCount(0)
    await expect(page.getByText('Não foi possível carregar o financeiro')).toHaveCount(0)
    const chosenMonthCards = await page.locator('article').count()

    const lateResponses = held.map(route => page.waitForResponse(response => response.request() === route.request()))
    for (const route of held.splice(0)) await route.fulfill({ json: [ledgerEntry(openedMonth!, marker)] })
    await Promise.all(lateResponses)
    // Prova de ausência: sem ida ao banco no caminho da leitura antiga, três
    // segundos são folga larga para ela pintar a tela, se fosse aceita.
    await page.waitForTimeout(3_000)

    await expect(page.locator('article', { hasText: marker })).toHaveCount(0)
    await expect(page.locator('article', { hasText: chosenMarker })).toBeVisible()
    await expect(monthInput).toHaveValue(chosen)
    await expect(page.getByText(monthLabel(chosen), { exact: true })).toBeVisible()
    await expect(page.locator('article')).toHaveCount(chosenMonthCards)
  } finally {
    for (const route of held) await route.abort().catch(() => {})
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
