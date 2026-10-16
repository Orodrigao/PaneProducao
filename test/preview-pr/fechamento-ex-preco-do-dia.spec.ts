import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 15/10/2026 a Marselle viu o Fechamento EX de setembro com o preco novo do
// Italiano: a conta usava o preco de hoje para qualquer periodo. Agora cada
// romaneio paga o preco do seu dia, guardado no historico da Tabela Buck.
//
// Dados do seed: o [TESTE] Brioche PJ sai para a EX em "hoje - 5" e
// "hoje - 3", a 1,20 na Tabela Buck. O roteiro troca o preco hoje pelo mesmo
// caminho da tela de tabelas (gravacao direta na linha), confere que o passado
// continua a 1,20 na conta do banco e no Fechamento EX, e devolve o preco.

const BRIOCHE = 'teste-brioche-pj'
const NOME_BRIOCHE = '[TESTE] Brioche PJ'

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const resultado = new Date(Date.UTC(ano, mes - 1, dia))
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado.toISOString().slice(0, 10)
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

type LinhaDaConta = { product_id: string; preco_unitario: number | null; quantidade: number }

async function contaDoPeriodo(page: Page, acesso: AcessoAoBanco, de: string, ate: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/list_romaneio_ex_billing`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_de: de, p_ate: ate },
    maxRedirects: 0,
  })
}

async function linhaDoBriocheNaBuck(page: Page, acesso: AcessoAoBanco) {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  const tabela = await page.request.get(`${acesso.url}/rest/v1/price_tiers?name=eq.BUCK&active=eq.true&select=id`, {
    headers: cabecalhos, maxRedirects: 0,
  })
  expect(tabela.status(), await tabela.text()).toBe(200)
  const [{ id: tierId }] = await tabela.json() as Array<{ id: string }>
  const linha = await page.request.get(
    `${acesso.url}/rest/v1/price_tier_items?tier_id=eq.${tierId}&product_id=eq.${BRIOCHE}&active=eq.true&select=id,unit_price`,
    { headers: cabecalhos, maxRedirects: 0 },
  )
  expect(linha.status(), await linha.text()).toBe(200)
  const linhas = await linha.json() as Array<{ id: string; unit_price: number }>
  expect(linhas, 'o seed tem uma linha do brioche na Tabela Buck').toHaveLength(1)
  return { id: linhas[0].id, preco: Number(linhas[0].unit_price) }
}

async function gravarPreco(page: Page, acesso: AcessoAoBanco, id: string, preco: number) {
  // O mesmo pedido que a tela de tabelas de preco faz ao digitar o valor.
  const resposta = await page.request.patch(`${acesso.url}/rest/v1/price_tier_items?id=eq.${id}`, {
    headers: { ...(await cabecalhosDaSessao(page, acesso)), Prefer: 'return=representation' },
    data: { unit_price: preco },
    maxRedirects: 0,
  })
  expect(resposta.status(), await resposta.text()).toBe(200)
  expect(await resposta.json(), 'a linha do brioche foi gravada').toHaveLength(1)
}

test('Financeiro troca o preco hoje e o Fechamento EX dos dias anteriores continua com o preco da epoca',
  matriz('Financeiro', 'EX', 'permitido', 'Fechamento EX e list_romaneio_ex_billing (tela e Data API)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'financeiroJc')
    const hoje = hojeNaPadaria()
    const de = somarDias(hoje, -6)
    const ate = somarDias(hoje, -1)

    const linha = await linhaDoBriocheNaBuck(page, acesso)
    const antes = await contaDoPeriodo(page, acesso, de, ate)
    expect(antes.status(), await antes.text()).toBe(200)
    const briocheAntes = (await antes.json() as LinhaDaConta[]).filter(item => item.product_id === BRIOCHE)
    expect(briocheAntes.map(item => Number(item.preco_unitario)), 'o brioche dos ultimos dias sai pelo preco da tabela').toEqual([linha.preco])

    const precoNovo = Math.round((linha.preco + 0.15) * 100) / 100
    await gravarPreco(page, acesso, linha.id, precoNovo)
    try {
      const depois = await contaDoPeriodo(page, acesso, de, ate)
      expect(depois.status(), await depois.text()).toBe(200)
      const briocheDepois = (await depois.json() as LinhaDaConta[]).filter(item => item.product_id === BRIOCHE)
      expect(briocheDepois.map(item => Number(item.preco_unitario)), 'trocar o preco hoje nao muda os dias anteriores').toEqual([linha.preco])

      const historico = await page.request.get(
        `${acesso.url}/rest/v1/buck_price_history?price_tier_item_id=eq.${linha.id}&order=seq.desc&limit=1&select=event,unit_price,valid_from`,
        { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
      )
      expect(historico.status(), await historico.text()).toBe(200)
      expect(await historico.json(), 'a troca ficou no historico, valendo de hoje').toEqual([
        { event: 'troca_de_preco', unit_price: precoNovo, valid_from: hoje },
      ])

      await page.goto('/relatorios/romaneios')
      const tabela = page.locator('.ps-table')
      const linhaDaTela = tabela.locator('tbody tr', { hasText: NOME_BRIOCHE })
      await expect(linhaDaTela.first()).toBeVisible({ timeout: 60_000 })
      await expect(linhaDaTela, 'o brioche dos ultimos dias aparece numa linha so').toHaveCount(1)
      await expect(linhaDaTela).toContainText(`${reais(linha.preco)}/un`)
      await expect(linhaDaTela).not.toContainText(reais(precoNovo))
      await expect(page.getByText('com o preço do dia de cada romaneio')).toBeVisible()
    } finally {
      await gravarPreco(page, acesso, linha.id, linha.preco)
    }
  })

for (const perfil of [
  { nome: 'romaneioEx' as const, rotulo: 'Romaneio', loja: 'EX', motivo: 've o romaneio, mas nao o preco' },
  { nome: 'vendasJa' as const, rotulo: 'Vendas', loja: 'JA', motivo: 'sem acesso a relatorio de preco' },
]) {
  test(`${perfil.rotulo} ${perfil.loja} e barrado no Fechamento EX (${perfil.motivo})`,
    matriz(perfil.rotulo, perfil.loja, 'bloqueado', 'list_romaneio_ex_billing e buck_price_history (Data API)'),
    async ({ page }) => {
      const acesso = await entrarComo(page, perfil.nome)
      const hoje = hojeNaPadaria()
      const resposta = await contaDoPeriodo(page, acesso, somarDias(hoje, -6), hoje)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })

      const historico = await page.request.get(`${acesso.url}/rest/v1/buck_price_history?select=seq&limit=1`, {
        headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0,
      })
      expect(historico.status(), await historico.text()).toBe(200)
      expect(await historico.json(), 'o historico com autor e motivo fica fechado').toEqual([])
    })
}
