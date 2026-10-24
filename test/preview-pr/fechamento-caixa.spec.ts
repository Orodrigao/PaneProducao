import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

const ESPERA_DO_BANCO = 20_000
const VALORES = { store: 'ja', closing_cash_amount: 100, stone_amount: 40.25, food99_sales_amount: 80.5, total_amount: 140.25, site_sales_amount: 0 }
const RECUSA = 'Esta tela está desatualizada. Anote os números, recarregue a página e salve de novo.'

function diaDescartavel() {
  return new Date(Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 365 * 30) * 86_400_000).toISOString().slice(0, 10)
}

function carregado(page: Page, dia?: string) {
  return Promise.all([
    page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes('/rest/v1/cash_closings')
      && r.url().includes('store=eq.ja') && r.url().includes(dia ? `closing_date=eq.${dia}` : 'closing_date=eq.')),
    page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes('/rest/v1/cash_closings')
      && r.url().includes('store=eq.ja') && r.url().includes('order=closing_date.desc')),
  ])
}

async function ler(page: Page, acesso: AcessoAoBanco, caminho: string) {
  const resposta = await page.request.get(`${acesso.url}/rest/v1/${caminho}`, {
    headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0,
  })
  expect(resposta.status(), await resposta.text()).toBe(200)
  return resposta.json()
}

// Os quatro casos acompanham a mesma criação, sem depender de dados do seed.
// A data fictícia fica no banco descartável, pois fechamento não tem exclusão.
test.describe('Fechamento protegido no banco desta PR', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  let dia: string
  let id: string
  let autorId: string
  let autorNome: string

  test('Vendas JA salva e relê Stone e 99Food',
    matriz('Vendas JA', 'JA', 'permitido: grava e relê', 'Fechamento (tela e Data API)'), async ({ page }) => {
      dia = diaDescartavel()
      const acesso = await entrarComo(page, 'vendasJa')
      const inicial = carregado(page)
      await page.goto('/fechamento-caixa')
      await inicial
      await expect(page.getByLabel('Loja')).toHaveValue('ja', { timeout: ESPERA_DO_BANCO })
      await expect(page.getByLabel('Loja')).toBeDisabled()
      const escolhido = carregado(page, dia)
      await page.getByLabel('Data', { exact: true }).fill(dia)
      await escolhido
      const salvar = page.getByRole('button', { name: 'Salvar fechamento' })
      await expect(salvar).toBeEnabled({ timeout: ESPERA_DO_BANCO })
      const dinheiro = page.getByRole('textbox', { name: /^1\. Total em dinheiro/ })
      const stone = page.getByRole('textbox', { name: /^4\. Stone/ })
      const food99 = page.getByRole('textbox', { name: /^9\. 99Food/ })
      await dinheiro.fill('100')
      await stone.fill('40,25')
      await food99.fill('80,50')
      const gravacao = page.waitForResponse(r => r.url().includes('/rest/v1/rpc/save_cash_closing') && r.request().method() === 'POST')
      await salvar.click()
      const resposta = await gravacao
      expect(resposta.status()).toBe(200)
      const linha = await resposta.json()
      expect(linha).toMatchObject({ ...VALORES, closing_date: dia })
      id = linha.id
      autorId = linha.created_by
      const perfis = await ler(page, acesso, `app_profiles?user_id=eq.${autorId}&select=display_name`)
      expect(perfis).toHaveLength(1)
      autorNome = perfis[0].display_name
      expect(autorNome.trim()).not.toBe('')
      await expect(page.getByRole('button', { name: 'Atualizar fechamento' })).toBeEnabled({ timeout: ESPERA_DO_BANCO })
      const recarga = carregado(page)
      await page.reload()
      await recarga
      const releitura = carregado(page, dia)
      await page.getByLabel('Data', { exact: true }).fill(dia)
      await releitura
      await expect(stone).toHaveValue('40,25', { timeout: ESPERA_DO_BANCO })
      await expect(food99).toHaveValue('80,50', { timeout: ESPERA_DO_BANCO })
      await expect(dinheiro).toHaveValue('100,00', { timeout: ESPERA_DO_BANCO })
      expect(await ler(page, acesso, `cash_closings?id=eq.${id}&select=*`)).toEqual([expect.objectContaining(VALORES)])
    })

  test('Vendas JA não fecha JC pela função',
    matriz('Vendas JA', 'JC', 'bloqueado: 42501', 'save_cash_closing (Data API)'), async ({ page }) => {
      const acesso = await entrarComo(page, 'vendasJa')
      const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/save_cash_closing`, {
        headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0,
        data: {
          p_request_id: randomUUID(), p_store: 'jc', p_closing_date: dia, p_updated_at: null,
          p_closing_cash_amount: 100, p_cash_withdrawal_amount: 0, p_opening_cash_amount: 0,
          p_banri_amount: 0, p_stone_amount: 40.25, p_sitef_amount: 0, p_pix_amount: 0,
          p_ifood_sales_amount: 0, p_food99_sales_amount: 80.5, p_envelope_amount: 0,
          p_next_day_cash_amount: 0, p_notes: null,
        },
      })
      expect(resposta.status(), await resposta.text()).toBe(403)
      expect(await resposta.json()).toMatchObject({ code: '42501' })
    })

  test('Vendas JA não grava diretamente nem apaga os valores salvos',
    matriz('Vendas JA', 'JA', 'bloqueado: 22023', 'cash_closings (PATCH e POST)'), async ({ page }) => {
      const acesso = await entrarComo(page, 'vendasJa')
      const headers = await cabecalhosDaSessao(page, acesso)
      const antes = await ler(page, acesso, `cash_closings?id=eq.${id}&select=*`)
      const patch = await page.request.patch(`${acesso.url}/rest/v1/cash_closings?id=eq.${id}`, {
        headers, maxRedirects: 0, data: { stone_amount: 0, closing_cash_amount: 200 },
      })
      expect(patch.status(), await patch.text()).toBe(400)
      expect(await patch.json()).toMatchObject({ code: '22023', message: RECUSA })
      let novoDia = diaDescartavel()
      while (novoDia === dia) novoDia = diaDescartavel()
      const post = await page.request.post(`${acesso.url}/rest/v1/cash_closings`, {
        headers, maxRedirects: 0, data: { ...VALORES, closing_date: novoDia },
      })
      expect(post.status(), await post.text()).toBe(400)
      expect(await post.json()).toMatchObject({ code: '22023', message: RECUSA })
      expect(await ler(page, acesso, `cash_closings?id=eq.${id}&select=*`)).toEqual(antes)
      expect(await ler(page, acesso, `cash_closings?store=eq.ja&closing_date=eq.${novoDia}&select=id`)).toEqual([])
    })

  test('Financeiro JC lê o caixa JA e sua autoria no histórico',
    matriz('Financeiro JC', 'JA', 'permitido: lê fechamento e criação', 'cash_closings e cash_closing_revisions'), async ({ page }) => {
      const acesso = await entrarComo(page, 'financeiroJc')
      expect(await ler(page, acesso, `cash_closings?id=eq.${id}&select=*`)).toEqual([expect.objectContaining(VALORES)])
      const revisoes = await ler(page, acesso, `cash_closing_revisions?closing_id=eq.${id}&revision_type=eq.criacao&select=*`)
      expect(revisoes).toEqual([expect.objectContaining({
        author_id: autorId, author_name: autorNome,
        after_values: expect.objectContaining({ stone_amount: 40.25 }),
      })])
    })
})
