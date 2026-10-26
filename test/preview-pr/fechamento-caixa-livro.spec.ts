import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

const DIA = '2026-09-15'
type Entry = { id: string; amount: number; source_detail: string; fee_of: string | null; fee_rate: number | null; fee_rate_version_id: string | null; reversed_at: string | null; entry_type: string; created_at: string }
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

test.describe('Fechamento no livro no banco desta PR', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  let closing: { id: string }
  let stone: number
  const input = (value: number) => value.toFixed(2).replace('.', ',')

  test('Vendas JA salva pela tela e relê',
    matriz('Vendas JA', 'JA', 'permitido: salva e relê', 'Fechamento e Data API'), async ({ page }) => {
      // Estado anterior define a expectativa: o banco desta PR pode receber várias rodadas.
      const access = await entrarComo(page, 'vendasJa')
      const closings = await read(page, access, 'cash_closings?store=eq.ja&closing_date=eq.' + DIA + '&select=*')
      const previous = closings[0]
      const next = (key: string, base: number) => Math.round(((Number(previous?.[key]) || base) + 0.01) * 100) / 100
      const cash = next('cash_amount', 101)
      const banrisul = next('banri_amount', 202)
      stone = next('stone_amount', 303)
      const pix = next('pix_amount', 404)
      await page.goto('/fechamento-caixa?loja=ja&data=' + DIA)
      await expect(page.getByLabel('Data', { exact: true })).toHaveValue(DIA, { timeout: 20_000 })
      await expect(page.getByLabel('Loja')).toHaveValue('ja')
      await expect(page.getByLabel('Loja')).toBeDisabled()
      await expect(page.getByRole('button', { name: /^(Salvar|Atualizar) fechamento$/ })).toBeEnabled({ timeout: 20_000 })
      for (const [label, value] of [
        [/^1\. Total em dinheiro/, cash], [/^2\. Sangrias/, 0], [/^3\. Banrisul/, banrisul], [/^4\. Stone/, stone],
        [/^5\. SiTef/, 0], [/^6\. PIX/, pix], [/^7\. Abertura/, 0], [/^8\. iFood/, 0], [/^9\. 99Food/, 0],
      ] as const) await page.getByRole('textbox', { name: label }).fill(input(value))
      const savedResponse = page.waitForResponse(r => r.url().includes('/rpc/save_cash_closing') && r.request().method() === 'POST')
      await page.getByRole('button', { name: /^(Salvar|Atualizar) fechamento$/ }).click()
      const saved = await savedResponse
      expect(saved.status(), await saved.text()).toBe(200)
      closing = await saved.json()
      expect(closing).toMatchObject({ cash_amount: cash, banri_amount: banrisul, stone_amount: stone, pix_amount: pix, closing_date: DIA })
      expect(await read(page, access, 'cash_closings?id=eq.' + closing.id + '&select=*')).toEqual([
        expect.objectContaining({ cash_amount: cash, banri_amount: banrisul, stone_amount: stone, pix_amount: pix }),
      ])
    })

  test('Vendas JA não lê livro nem taxas',
    matriz('Vendas JA', 'JA', 'bloqueado: livro vazio e 42501', 'Livro e taxas (Data API)'), async ({ page }) => {
      const access = await entrarComo(page, 'vendasJa')
      expect(await read(page, access, 'finance_entries?source_ref=eq.' + closing.id + '&select=id')).toEqual([])
      const denied = await page.request.post(access.url + '/rest/v1/rpc/get_finance_fee_rates', { headers: await cabecalhosDaSessao(page, access), data: {}, maxRedirects: 0 })
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toMatchObject({ code: '42501' })
    })

  test('Financeiro JC lê receitas, grava Stone e vê orientação de correção',
    matriz('Financeiro JC', 'JA', 'permitido: receita, taxa e orientação', 'Livro (tela e Data API)'), async ({ page }) => {
      const access = await entrarComo(page, 'financeiroJc')
      const initialRates = await rates(page, access)
      const stoneBefore = initialRates.history.filter(r => r.method === 'stone' && r.valid_from <= DIA)
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.created_at.localeCompare(a.created_at))[0]
      await page.goto('/financeiro')
      await page.getByLabel('Mês').fill('2026-09')
      const panel = page.getByRole('region', { name: 'Taxas dos meios de pagamento' })
      await expect(panel.getByText('iFood: 15,2%', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByText('99Food: 14,1%', { exact: true })).toBeVisible()
      await expect(panel.getByText('PIX: 0%', { exact: true })).toBeVisible()
      for (const method of ['banrisul', 'stone', 'sitef']) {
        if (!initialRates.methods.find((r: { method: string }) => r.method === method)?.current) {
          const label = { banrisul: 'Banrisul', stone: 'Stone', sitef: 'SiTef' }[method]
          await expect(panel.getByText(label + ': Não informada', { exact: true })).toBeVisible()
        }
      }
      for (const method of ['Dinheiro', 'Banrisul', 'Stone', 'PIX']) {
        const article = page.locator('article').filter({ has: page.getByText('Fechamento JA 15/09/2026 · ' + method, { exact: true }) }).filter({ hasNotText: /Estornado ·|Estorno ·/ }).first()
        await expect(article).toBeVisible({ timeout: 20_000 })
        await expect(article.getByRole('button', { name: /^Estornar/ })).toHaveCount(0)
        await expect(article.getByRole('button', { name: /^Corrigir/ })).toHaveCount(0)
        await expect(article.getByText('Para corrigir, quem fecha o caixa da loja ou o administrador ajusta o dia 15/09/2026 no Fechamento de caixa.', { exact: true })).toBeVisible()
      }
      const before: Entry[] = await read(page, access, 'finance_entries?source_ref=eq.' + closing.id + '&select=*&order=created_at.desc')
      const revenue = before.find(e => e.source_detail === 'stone' && !e.fee_of && e.entry_type === 'lancamento' && !e.reversed_at)!
      expect(revenue.amount).toBe(stone)
      const feeBeforeSave = before.find(e => e.fee_of === revenue.id && e.entry_type === 'lancamento' && !e.reversed_at)
      const previousFee = before.find(e => e.source_detail === 'stone' && e.fee_of && e.entry_type === 'lancamento' && e.reversed_at)
      const frozen = previousFee ? previousFee.fee_rate : stoneBefore?.rate ?? null
      if (frozen !== null && Math.round(stone * frozen) > 0) expect(feeBeforeSave).toBeDefined()
      if (feeBeforeSave) {
        expect(feeBeforeSave.fee_rate).toBe(frozen)
        expect(feeBeforeSave.fee_rate_version_id).toBe(previousFee ? previousFee.fee_rate_version_id : stoneBefore?.id)
      }
      if (!feeBeforeSave && frozen === null) {
        const pending = await rates(page, access)
        expect(pending.pending).toContainEqual(expect.objectContaining({ method: 'stone', store: 'ja', competence_month: '2026-09-01', amount: expect.any(Number) }))
        await expect(panel.getByRole('heading', { name: 'Venda ainda sem taxa' })).toBeVisible()
      }
      // Mesmo início da venda: empate de vigência resolve pela gravação mais recente.
      // Percentual próprio desta rodada, sem presumir banco virgem.
      const newRate = 2 + (Number(initialRates.history.length) % 1000 + 1) / 10000
      await panel.getByLabel('Meio de pagamento').selectOption('stone')
      await panel.getByLabel('Taxa (%)', { exact: true }).fill(String(newRate).replace('.', ','))
      await panel.getByLabel('Vale a partir de').fill(DIA)
      page.once('dialog', async dialog => {
        expect(dialog.message()).toContain('Gravar Stone ' + String(newRate).replace('.', ',') + '% a partir de 15/09/2026?')
        expect(dialog.message()).toContain('Taxas já lançadas não mudam.')
        expect(dialog.message()).toMatch(/no mês de cada venda|próximas vendas/)
        await dialog.accept()
      })
      const rateResponse = page.waitForResponse(r => r.url().includes('/rpc/save_finance_fee_rate') && r.request().method() === 'POST')
      await panel.getByRole('button', { name: 'Gravar taxa', exact: true }).click()
      const recorded = await rateResponse
      expect(recorded.status(), await recorded.text()).toBe(200)
      const result = await recorded.json()
      await expect(panel.getByText(feeBeforeSave
        ? 'Nenhuma venda pendente recebeu esta taxa; ela vale para as próximas vendas.'
        : 'Taxas lançadas em setembro de 2026 (JA)', { exact: false })).toBeVisible({ timeout: 20_000 })
      const after: Entry[] = await read(page, access, 'finance_entries?source_ref=eq.' + closing.id + '&select=*')
      const fee = after.find(e => e.fee_of === revenue.id && e.entry_type === 'lancamento' && !e.reversed_at)
      expect(fee).toBeDefined()
      const expectedRate = feeBeforeSave?.fee_rate ?? newRate
      expect(fee!.fee_rate).toBe(expectedRate)
      expect(fee!.fee_rate_version_id).toBe(feeBeforeSave?.fee_rate_version_id ?? result.version.id)
      expect(fee!.amount).toBe(Math.round(stone * expectedRate!) / 100)
      const feeArticle = page.locator('article').filter({ hasText: 'Taxa da receita: Fechamento JA 15/09/2026 · Stone' }).filter({ hasNotText: /Estornado ·|Estorno ·/ }).first()
      await expect(feeArticle).toBeVisible({ timeout: 20_000 })
      await expect(feeArticle.getByRole('button', { name: /^Estornar/ })).toHaveCount(0)
    })

  test('Administrador corrige pelo livro',
    matriz('Administrador', 'JA', 'permitido: corrige pelo livro', 'Livro e Fechamento de caixa'), async ({ page }) => {
      await entrarComo(page, 'admin')
      await page.goto('/financeiro')
      await page.getByLabel('Mês').fill('2026-09')
      const correction = page.locator('article').filter({ has: page.getByText('Fechamento JA 15/09/2026 · Stone', { exact: true }) }).filter({ hasNotText: /Estornado ·|Estorno ·/ }).first()
      await expect(correction).toBeVisible({ timeout: 20_000 })
      await expect(correction.getByRole('button', { name: 'Corrigir no Fechamento de caixa' })).toBeVisible()
      await correction.getByRole('button', { name: 'Corrigir no Fechamento de caixa' }).click()
      await expect(page).toHaveURL(/fechamento-caixa\?loja=ja&data=2026-09-15/)
      await expect(page.getByLabel('Loja')).toHaveValue('ja', { timeout: 20_000 })
      await expect(page.getByLabel('Data', { exact: true })).toHaveValue(DIA)
      await expect(page.getByRole('textbox', { name: /^4\. Stone/ })).toHaveValue(input(stone), { timeout: 20_000 })
    })

})
