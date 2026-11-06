import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

const DIA = '2026-09-15'
const JC_DIA = '2026-09-06' // domingo sem fixture
const METHODS = [
  ['banri_credit_amount', 'banrisul_credito', 'Banrisul crédito', 1.79],
  ['banri_debit_amount', 'banrisul_debito', 'Banrisul débito', 1.39],
  ['banri_pix_amount', 'banrisul_pix', 'Banrisul PIX', 0.89],
  ['stone_credit_amount', 'stone_credito', 'Stone crédito', 3.57],
  ['stone_debit_amount', 'stone_debito', 'Stone débito', 1.09],
  ['stone_pix_amount', 'stone_pix', 'Stone PIX', 0.50],
  ['sitef_credit_amount', 'sitef_credito', 'SiTef crédito', 2.05],
  ['sitef_debit_amount', 'sitef_debito', 'SiTef débito', 0.89],
  ['sitef_pix_amount', 'sitef_pix', 'SiTef PIX', null],
] as const

type Entry = { id: string; amount: number; source_detail: string; fee_of: string | null; fee_rate: number | null; fee_rate_version_id: string | null; reversed_at: string | null; entry_type: string }
async function read(page: Page, access: AcessoAoBanco, path: string) {
  const response = await page.request.get(access.url + '/rest/v1/' + path, { headers: await cabecalhosDaSessao(page, access), maxRedirects: 0 })
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}
async function rates(page: Page, access: AcessoAoBanco) {
  const response = await page.request.post(access.url + '/rest/v1/rpc/get_finance_fee_rates', { headers: await cabecalhosDaSessao(page, access), data: {}, maxRedirects: 0 })
  expect(response.status(), await response.text()).toBe(200)
  return response.json() as Promise<import('../../src/lib/financeFeeRates').FinanceFeeRates>
}
const input = (value: number) => value.toFixed(2).replace('.', ',')
async function save(page: Page) {
  const pending = page.waitForResponse(r => r.url().includes('/rpc/save_cash_closing') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /^(Salvar|Atualizar) fechamento$/ }).click()
  const response = await pending
  expect(response.status(), await response.text()).toBe(200)
  expect(Object.keys(response.request().postDataJSON())).toHaveLength(25)
  return response.json()
}
async function open(page: Page, store: string, day: string) {
  await page.goto('/fechamento-caixa?loja=' + store + '&data=' + day)
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue(day, { timeout: 20_000 })
  await expect(page.getByLabel('Loja')).toHaveValue(store)
  await expect(page.getByRole('button', { name: /^(Salvar|Atualizar) fechamento$/ })).toBeEnabled({ timeout: 20_000 })
}
async function verifyEntries(page: Page, access: AcessoAoBanco, closing: { id: string }, values: Record<string, number>, includeSitef: boolean) {
  const entries: Entry[] = await read(page, access, 'finance_entries?source_ref=eq.' + closing.id + '&select=*')
  const active = entries.filter(e => e.entry_type === 'lancamento' && !e.reversed_at)
  expect(active.filter(e => !e.fee_of)).toHaveLength(includeSitef ? 11 : 8)
  expect(active.filter(e => e.fee_of)).toHaveLength(includeSitef ? 8 : 6)
  for (const [column, method, , rate] of METHODS.filter(m => includeSitef || !m[0].startsWith('sitef'))) {
    const revenues = active.filter(e => e.source_detail === method && !e.fee_of)
    expect(revenues).toHaveLength(1)
    expect(revenues[0].amount).toBe(values[column])
    const fees = active.filter(e => e.fee_of === revenues[0].id)
    if (rate === null) expect(fees).toHaveLength(0)
    else {
      expect(fees).toHaveLength(1)
      expect(fees[0].fee_rate).toBe(rate)
      expect(fees[0].amount).toBe(Math.round(values[column] * rate) / 100)
    }
  }
  return active
}

test.describe('Fechamento no livro no banco desta PR', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  let closing: { id: string }
  const values: Record<string, number> = {}

  test('Vendas JA salva crédito, débito e PIX separados e relê',
    matriz('Vendas JA', 'JA', 'permitido: salva e relê', 'Fechamento e Data API'), async ({ page }) => {
      const access = await entrarComo(page, 'vendasJa')
      const previous = (await read(page, access, 'cash_closings?store=eq.ja&closing_date=eq.' + DIA + '&select=*'))[0]
      await open(page, 'ja', DIA)
      await expect(page.getByLabel('Loja')).toBeDisabled()
      await expect(page.getByRole('textbox', { name: 'SiTef crédito', exact: true })).toHaveCount(0)
      for (const [column, , label] of METHODS.filter(m => !m[0].startsWith('sitef'))) {
        values[column] = Math.round(((Number(previous?.[column]) || 100) + 0.01) * 100) / 100
        await page.getByRole('textbox', { name: label, exact: true }).fill(input(values[column]))
      }
      for (const [label, value] of [[/^1\. Total em dinheiro/, 110], [/^2\. Sangrias/, 0], [/^6\. PIX/, 50], [/^7\. Abertura/, 0], [/^8\. iFood/, 0], [/^9\. 99Food/, 0]] as const) {
        await page.getByRole('textbox', { name: label }).fill(input(value))
      }
      for (const machine of ['Banrisul', 'Stone']) await expect(page.getByText('Total ' + machine, { exact: true })).toBeVisible()
      closing = await save(page)
      const total = Math.round((160 + Object.values(values).reduce((a, b) => a + b, 0)) * 100) / 100
      expect(await read(page, access, 'cash_closings?id=eq.' + closing.id + '&select=*')).toEqual([
        expect.objectContaining({ ...values, total_amount: total, banri_amount: 0, stone_amount: 0, sitef_amount: 0 }),
      ])
      await open(page, 'ja', DIA)
      await expect(page.getByRole('textbox', { name: 'Stone débito', exact: true })).toHaveValue(input(values.stone_debit_amount))
    })

  test('Vendas JA não lê livro nem taxas e não grava taxa',
    matriz('Vendas JA', 'JA', 'bloqueado: livro vazio e 42501', 'Livro e taxas (Data API)'), async ({ page }) => {
      const access = await entrarComo(page, 'vendasJa')
      expect(await read(page, access, 'finance_entries?source_ref=eq.' + closing.id + '&select=id')).toEqual([])
      for (const [rpc, data] of [['get_finance_fee_rates', {}], ['save_finance_fee_rate', { p_request_id: crypto.randomUUID(), p_method: 'stone_debito', p_rate: 1.09, p_valid_from: DIA, p_expected_latest_id: null }]] as const) {
        const denied = await page.request.post(access.url + '/rest/v1/rpc/' + rpc, { headers: await cabecalhosDaSessao(page, access), data, maxRedirects: 0 })
        expect(denied.status(), await denied.text()).toBe(403)
        expect(await denied.json()).toMatchObject({ code: '42501' })
      }
    })

  test('Financeiro confere JA e salva os nove meios na JC',
    matriz('Financeiro JC', 'JC e JA', 'permitido: nove receitas e oito taxas', 'Livro e fechamento'), async ({ page }) => {
      const access = await entrarComo(page, 'financeiroJc')
      await verifyEntries(page, access, closing, values, false)
      const previous = (await read(page, access, 'cash_closings?store=eq.jc&closing_date=eq.' + JC_DIA + '&select=*'))[0]
      const jcValues: Record<string, number> = {}
      await open(page, 'jc', JC_DIA)
      for (const [column, , label] of METHODS) {
        jcValues[column] = Math.round(((Number(previous?.[column]) || 200) + 0.01) * 100) / 100
        await page.getByRole('textbox', { name: label, exact: true }).fill(input(jcValues[column]))
      }
      for (const [label, value] of [[/^1\. Total em dinheiro/, 100], [/^2\. Sangrias/, 0], [/^6\. PIX/, 50], [/^7\. Abertura/, 0], [/^8\. iFood/, 0], [/^9\. 99Food/, 0]] as const) {
        await page.getByRole('textbox', { name: label }).fill(input(value))
      }
      await expect(page.getByText('Total SiTef', { exact: true })).toBeVisible()
      const jcClosing = await save(page)
      const active = await verifyEntries(page, access, jcClosing, jcValues, true)
      await expect(page.getByRole('button', { name: 'Atualizar fechamento' })).toBeEnabled()
      await save(page)
      const unchanged = await verifyEntries(page, access, jcClosing, jcValues, true)
      expect(unchanged.map(e => e.id).sort()).toEqual(active.map(e => e.id).sort())
      const data = await rates(page, access)
      expect(data.pending).toContainEqual(expect.objectContaining({ method: 'sitef_pix', store: 'jc' }))
      await page.goto('/financeiro')
      await page.getByLabel('Mês').fill('2026-09')
      const panel = page.getByRole('region', { name: 'Taxas dos meios de pagamento' })
      await expect(panel.getByText('SiTef PIX: Não informada', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByLabel('Meio de pagamento')).toHaveValue('stone_credito')
      for (const method of ['banrisul', 'stone', 'sitef']) await expect(panel.locator('option[value="' + method + '"]')).toHaveCount(0)
      await expect(panel.getByText('Dias salvos antes da troca, com crédito e débito juntos: a taxa deles será corrigida pelo extrato de cada credenciadora, não por aqui.')).toBeVisible()
      // Exercita gravação sem mudar taxas de setembro nem a fixture de pendência.
      await panel.getByLabel('Meio de pagamento').selectOption('stone_credito')
      await panel.getByLabel('Taxa (%)', { exact: true }).fill('3,57')
      await panel.getByLabel('Vale a partir de').fill('2026-11-06')
      page.once('dialog', dialog => dialog.accept())
      const pending = page.waitForResponse(r => r.url().includes('/rpc/save_finance_fee_rate') && r.request().method() === 'POST')
      await panel.getByRole('button', { name: 'Gravar taxa', exact: true }).click()
      const recorded = await pending
      expect(recorded.status(), await recorded.text()).toBe(200)
      await verifyEntries(page, access, jcClosing, jcValues, true)
    })

  test('Administrador corrige pelo livro',
    matriz('Administrador', 'JA', 'permitido: corrige pelo livro', 'Livro e Fechamento de caixa'), async ({ page }) => {
      await entrarComo(page, 'admin')
      await page.goto('/financeiro')
      await page.getByLabel('Mês').fill('2026-09')
      const correction = page.locator('article').filter({ has: page.getByText('Fechamento JA 15/09/2026 · Stone débito', { exact: true }) }).filter({ hasNotText: /Estornado ·|Estorno ·/ }).first()
      await expect(correction).toBeVisible({ timeout: 20_000 })
      await correction.getByRole('button', { name: 'Corrigir no Fechamento de caixa' }).click()
      await expect(page).toHaveURL(/fechamento-caixa\?loja=ja&data=2026-09-15/)
      await expect(page.getByLabel('Loja')).toHaveValue('ja', { timeout: 20_000 })
      await expect(page.getByRole('textbox', { name: 'Stone débito', exact: true })).toHaveValue(input(values.stone_debit_amount), { timeout: 20_000 })
    })
})
