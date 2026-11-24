import { expect, test, type Page, type Route } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({ browserName: 'chromium', channel: 'chrome' })
const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const purchaseId = '00000000-0000-4000-8000-000000010101'
const installmentId = '00000000-0000-4000-8000-000000010102'
const account = { id: 'bank', key: 'bank', label: 'Banco X desativado', kind: 'banco', store: 'jc', sort_order: 1 }
const categories = [
  { id: 'cat', key: 'insumos', label: 'Insumos', nature: 'despesa', dre_tier: 'operacional', dre_group: 'cmv', sort_order: 1 },
  { id: 'extra', key: 'financeiras', label: 'Financeiras', nature: 'despesa', dre_tier: 'abaixo_da_linha', dre_group: 'financeiras', sort_order: 2 },
]
const installment = { id: installmentId, installment_number: 1, status: 'paga', amount: 987.65,
  paid_amount: 987.65, paid_date: '2026-11-18', due_date: '2026-11-18' }
const purchase = { id: purchaseId, purchase_date: '2026-08-15', document_type: 'nfe', payment_method: 'boleto',
  status: 'paga', total_value: 987.65, suppliers: { name: 'Fornecedor A' }, nfe_number: '10101',
  nfe_key: '1'.repeat(44), notes: 'Energia Elétrica e Açúcar', origin: 'xml', payable_installments: [installment] }

function entry(id: string, amount: number, changes: Record<string, unknown> = {}) {
  return { id, amount, planned_amount: amount, entry_type: 'lancamento', category_id: 'cat', account_id: 'bank', store: 'jc',
    competence_month: '2026-11-01', paid_date: '2026-11-19', payment_method: 'boleto', description: 'Fornecedor A NF 10101',
    source: 'avulso', source_ref: null, recurrence_month: null, transfer_id: null, transfer_leg: null,
    reversal_of: null, reversal_reason: null, reversed_at: null, created_at: '2026-11-19T12:00:00Z',
    source_detail: null, fee_of: null, fee_rate: null, fee_rate_version_id: null, ...changes }
}
const payableRows = [entry('split-1', 700, { source: 'contas_pagar', source_ref: installmentId, paid_date: '2026-11-18', competence_month: '2026-08-01' }),
  entry('split-2', 287.65, { source: 'contas_pagar', source_ref: installmentId, paid_date: '2026-11-18', category_id: 'extra' }),
  entry('old', 987.65, { source: 'contas_pagar', source_ref: installmentId, paid_date: '2026-11-18', reversed_at: '2026-11-20T13:00:00Z', reversal_reason: 'Reclassificação' })]
const looseEntry = entry('loose', 987.65)

function counted(route: Route, rows: unknown[]) {
  const url = new URL(route.request().url())
  const from = Number(url.searchParams.get('offset') ?? 0)
  const size = Number(url.searchParams.get('limit') ?? 500)
  const data = rows.slice(from, from + size)
  return route.fulfill({ json: data, headers: { 'content-range': data.length ? `${from}-${from + data.length - 1}/${rows.length}` : `*/${rows.length}` } })
}

interface Simulation {
  ledgerRows?: ReturnType<typeof entry>[]
  holdTerm?: string
  failPayables?: boolean
  noPayables?: boolean
}
async function simulate(page: Page, options: Simulation = {}) {
  await entrarComSessaoGuardada(page, financeiroJc)
  const held: Route[] = []
  const all = options.ledgerRows ?? [looseEntry, ...payableRows]
  // Apenas a resposta ao navegador muda; nenhuma permissão ou conta é gravada.
  if (options.noPayables) {
    await page.route('**/rest/v1/app_user_permissions*', route => route.fulfill({ json: [{ permission_key: 'financeiro.acessar', scope: 'ja' }] }))
  }
  await page.route('**/rest/v1/finance_accounts*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('active') ? [] : [account] }))
  await page.route('**/rest/v1/finance_categories*', route => route.fulfill({ json: categories }))
  await page.route('**/rest/v1/finance_recurring_rules*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/finance_fee_rates*', route => route.fulfill({ json: [] }))
  for (const table of ['payable_import_drafts', 'products', 'suppliers', 'nfe_inbox']) {
    await page.route(`**/rest/v1/${table}?*`, route => route.fulfill({ json: [] }))
  }
  await page.route('**/rest/v1/rpc/get_payable_due_report_status*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/payable_purchases*', route => options.failPayables
    ? route.fulfill({ status: 503, json: { message: 'Indisponível' } }) : counted(route, [purchase]))
  await page.route('**/rest/v1/finance_entries?*', route => {
    const url = new URL(route.request().url())
    const filter = url.searchParams.get('or') ?? ''
    if (options.holdTerm && filter.includes(options.holdTerm)) { held.push(route); return }
    if (url.searchParams.get('select') === 'paid_date') return route.fulfill({ json: [{ paid_date: '2026-06-19' }] })
    if (url.searchParams.has('source_ref')) return counted(route, payableRows)
    if (url.searchParams.has('id')) {
      const ids = url.searchParams.get('id')!
      return counted(route, all.filter(row => ids.includes(row.id)))
    }
    if (!filter) return counted(route, [looseEntry])
    if (filter.includes('inexistente')) return counted(route, [])
    if (filter.includes('987.65')) return counted(route, [looseEntry, payableRows[2]])
    return counted(route, all)
  })
  return held
}

test('busca mostra parcela paga e avulso, composição, histórico e banco desativado', async ({ page }) => {
  await simulate(page)
  await page.goto('/financeiro?busca=10101')
  const panel = page.getByRole('region', { name: 'Buscar pagamento', exact: true })
  const payable = panel.getByRole('region', { name: 'No Contas a pagar', exact: true })
  const ledger = panel.getByRole('region', { name: 'No livro', exact: true })
  await expect(payable).toContainText('Paga em 18/11/2026')
  await expect(payable).toContainText('Banco X desativado')
  await expect(payable).toContainText('700,00')
  await expect(payable).toContainText('287,65')
  await expect(payable).toContainText('classificação corrigida em 20/11/2026')
  await expect(payable).toContainText('nº da nota')
  await expect(ledger.locator('article')).toHaveCount(1)
  await expect(ledger).toContainText('Pago em 19/11/2026')
  await expect(page.getByText('Resumo do mês')).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill('987,65')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(payable).toContainText('valor pago')
  await expect(ledger).toContainText('valor desta linha')

  for (const term of ['fornecedor a', 'eletrica', 'ENERGIA', 'acucar']) {
    await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill(term)
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(payable).toContainText('Paga em 18/11/2026')
  }
  await page.getByLabel('Qual data vale').selectOption('competence_month')
  await page.getByLabel('Período', { exact: true }).selectOption('chosen')
  await page.getByLabel('Mês da busca').fill('2026-08')
  await expect(payable).toContainText('Paga em 18/11/2026')
  await page.getByLabel('Qual data vale').selectOption('paid_date')
  await expect(payable.locator('article')).toHaveCount(0)

  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await expect(payable.getByRole('link', { name: 'Ver a conta' })).toHaveAttribute('href', `/contas-pagar?purchase=${purchaseId}&installment=${installmentId}`)
  await payable.getByRole('link', { name: 'Ver a conta' }).click()
  await expect(page.locator(`#payable-installment-${installmentId}`)).toBeInViewport()
})

test('vazio é cauteloso, mostra cobertura, filtros e limpeza preserva o mês', async ({ page }) => {
  await simulate(page)
  await page.goto('/financeiro')
  await page.getByLabel('Mês', { exact: true }).fill('2026-07')
  await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill('inexistente')
  await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).press('Enter')
  await expect(page.getByText(/Isso não confirma que não foi pago/)).toBeVisible()
  await expect(page.getByText('Há lançamentos no livro a partir de 19/06/2026')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Buscar “inexistente” em Contas a pagar' })).toHaveAttribute('href', '/contas-pagar?busca=inexistente')
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click()
  await expect(page.getByLabel('Mês', { exact: true })).toHaveValue('2026-07')
  await expect(page.getByText('Resumo do mês')).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill('x')
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeDisabled()
  await expect(page.getByText('Digite pelo menos 2 caracteres.')).toBeVisible()
})

test('50 de N, mostrar mais e consulta repetida; falha de parcelas preserva livro', async ({ page }) => {
  await simulate(page, { failPayables: true, ledgerRows: Array.from({ length: 65 }, (_, index) => entry(`line-${String(index).padStart(3, '0')}`, 1, { description: `Pagamento ${index}` })) })
  await page.goto('/financeiro?busca=pagamento')
  const ledger = page.getByRole('region', { name: 'No livro', exact: true })
  await expect(ledger.getByText('50 de 65 pagamento(s)', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'no Contas a pagar' })).toBeVisible()
  await page.getByRole('button', { name: 'Mostrar mais', exact: true }).click()
  await expect(ledger.getByText('65 de 65 pagamento(s)', { exact: true })).toBeVisible()
  await expect(ledger.locator('article')).toHaveCount(65)
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(ledger.getByText('50 de 65 pagamento(s)', { exact: true })).toBeVisible()
})

test('resposta antiga não substitui busca nova nem reaparece após limpar', async ({ page }) => {
  const held = await simulate(page, { holdTerm: '10101' })
  try {
    await page.goto('/financeiro?busca=10101')
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill('inexistente')
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(page.getByText(/Isso não confirma que não foi pago/)).toBeVisible()
    const late = held.splice(0)
    await Promise.all(late.map(route => counted(route, [looseEntry, ...payableRows])))
    await page.waitForTimeout(500)
    await expect(page.getByRole('region', { name: 'No livro', exact: true }).locator('article')).toHaveCount(0)
    await expect(page.getByText(/Isso não confirma que não foi pago/)).toBeVisible()
    await page.getByRole('textbox', { name: 'Buscar pagamento', exact: true }).fill('10101')
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click()
    await Promise.all(held.splice(0).map(route => counted(route, [looseEntry])))
    await page.waitForTimeout(500)
    await expect(page.getByRole('region', { name: 'No livro', exact: true })).toHaveCount(0)
    await expect(page.getByText('Resumo do mês')).toBeVisible()
  } finally {
    await Promise.all(held.map(route => route.abort().catch(() => {})))
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('sem acesso a parcelas consulta só o livro e não oferece links para Contas a pagar', async ({ page }) => {
  await simulate(page, { noPayables: true })
  let purchasesRequested = 0
  page.on('request', request => { if (request.url().includes('/rest/v1/payable_purchases')) purchasesRequested++ })
  await page.goto('/financeiro?busca=10101')
  await expect(page.getByText('Busca nas parcelas do Contas a pagar disponível para quem acessa o Contas a pagar')).toBeVisible()
  await expect(page.getByRole('region', { name: 'No livro', exact: true }).locator('article')).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'Ver a conta', exact: true })).toHaveCount(0)
  expect(purchasesRequested).toBe(0)
})

test('sem financeiro.acessar continua sem a tela Financeiro', async ({ page }) => {
  await simulate(page)
  await page.route('**/rest/v1/app_user_permissions*', route => route.fulfill({ json: [] }))
  await page.goto('/financeiro?busca=10101')
  await expect(page).not.toHaveURL(/\/financeiro(?:[?#]|$)/, { timeout: 15_000 })
  await expect(page.getByRole('region', { name: 'Buscar pagamento', exact: true })).toHaveCount(0)
})

