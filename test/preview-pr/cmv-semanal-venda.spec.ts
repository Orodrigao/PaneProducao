import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Consumo semanal da JC: o CMV em % sobre a venda (caixa JC + JA + iFood +
// cobrancas PJ + EX). O admin ve o painel na tela, sobre o periodo das duas
// contagens fechadas do seed. Na Data API, com o token da propria sessao: o
// Financeiro JC (Contas a pagar e a receber) le a venda; o Financeiro Catalogo
// JC (so Contas a pagar) le os itens fora da contagem mas e barrado na venda;
// a Expedicao JC e barrada nas duas. Nada e gravado.

const TELA = '/estoque/consumo'

async function rpc(page: Page, acesso: AcessoAoBanco, nome: string) {
  const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/${nome}`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_store: 'jc' },
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
  return { status: resposta.status(), texto: await resposta.text() }
}

test('Admin ve o CMV sobre a venda da semana no consumo semanal',
  matriz('Admin', 'JC', 'permitido', 'Painel CMV sobre a venda (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'admin')
    await page.goto(TELA)

    await expect(page.getByText('CMV sobre a venda')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Venda da semana')).toBeVisible()
    await expect(page.getByText(/caixa da JC · \d+ dias? com fechamento/)).toBeVisible()
    await expect(page.getByText(/EX · \d+ de \d+ dias cobrados/)).toBeVisible()
    await expect(page.getByText('O % conta só os insumos da contagem semanal', { exact: false })).toBeVisible()
    // Venda vazia ou consumo sem valor nunca vira "0,0%".
    await expect(page.getByText('0,0%', { exact: true })).toHaveCount(0)
  })

test('Financeiro JC le a venda da semana pela Data API',
  matriz('Financeiro JC', 'JC', 'permitido', 'inventory_consumption_revenue (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'financeiroJc')
    const venda = await rpc(page, acesso, 'inventory_consumption_revenue')
    expect(venda.status, venda.texto).toBe(200)
    const linhas = JSON.parse(venda.texto) as { period_end_count_id: string; revenue_total: number | string }[]
    expect(linhas.length, 'o seed tem duas contagens fechadas, logo ao menos um periodo').toBeGreaterThan(0)
    for (const linha of linhas) expect(Number.isFinite(Number(linha.revenue_total))).toBe(true)
  })

test('Financeiro Catalogo JC le os itens fora da contagem, mas nao a venda',
  matriz('Financeiro Catalogo JC', 'JC', 'bloqueado', 'inventory_consumption_revenue (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'financeiroCatalogoJc')
    const fora = await rpc(page, acesso, 'inventory_consumption_outside_items')
    expect(fora.status, fora.texto).toBe(200)
    const venda = await rpc(page, acesso, 'inventory_consumption_revenue')
    expect(venda.status, venda.texto).toBe(403)
    expect(venda.texto).toContain('Sem permissao para ver a venda da semana.')
  })

test('Expedicao JC e barrada na venda e nos itens fora da contagem',
  matriz('Expedicao JC', 'JC', 'bloqueado', 'Venda e itens fora da contagem (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'expedicaoJc')
    const venda = await rpc(page, acesso, 'inventory_consumption_revenue')
    expect(venda.status, venda.texto).toBe(403)
    const fora = await rpc(page, acesso, 'inventory_consumption_outside_items')
    expect(fora.status, fora.texto).toBe(403)
  })
