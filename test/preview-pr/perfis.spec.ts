import { expect, test } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz } from './apoio/entrar'

// Demonstracao do check "Navegador no preview desta PR": um perfil que deve
// conseguir e um que deve ser barrado, na tela e na Data API com o token da
// propria sessao. O mesmo pedido a Data API passa para o administrador; sem
// esse contraste, um 403 por qualquer outro motivo pareceria bloqueio.
//
// Nada aqui grava: list_kitchen_production_plan so le.

async function planoDaCozinha(page: import('@playwright/test').Page, perfil: 'admin' | 'vendasJa') {
  const acesso = await entrarComo(page, perfil)
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  return page.request.post(`${acesso.url}/rest/v1/rpc/list_kitchen_production_plan`, {
    headers: cabecalhos,
    data: { p_store: 'ja', p_production_date: hojeNaPadaria() },
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
}

test('Administrador entra e abre a Producao da Cozinha',
  matriz('Administrador', 'todas', 'entra', 'Producao da Cozinha (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'admin')
    await page.goto('/producao-cozinha')
    await expect(page).toHaveURL(/\/producao-cozinha$/)
    await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible()
  })

test('Administrador le o plano da Cozinha da JA pela Data API',
  matriz('Administrador', 'JA', 'permitido', 'list_kitchen_production_plan (Data API)'),
  async ({ page }) => {
    const resposta = await planoDaCozinha(page, 'admin')
    expect(resposta.status(), await resposta.text()).toBe(200)
    expect(Array.isArray(await resposta.json())).toBe(true)
  })

test('Vendas JA e barrada da Producao da Cozinha na tela',
  matriz('Vendas JA', 'JA', 'bloqueada', 'Producao da Cozinha (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'vendasJa')
    await page.goto('/producao-cozinha')
    await expect(page).toHaveURL(/\/romaneio$/)
    await expect(page.getByRole('heading', { name: 'Cozinha' })).toHaveCount(0)
  })

test('Vendas JA e barrada do plano da Cozinha na Data API',
  matriz('Vendas JA', 'JA', 'bloqueada', 'list_kitchen_production_plan (Data API)'),
  async ({ page }) => {
    const resposta = await planoDaCozinha(page, 'vendasJa')
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })
