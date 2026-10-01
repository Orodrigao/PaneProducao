import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Vinculos de NF-e (consulta somente leitura): Administracao e o Financeiro com
// acesso ao Catalogo e ao Contas a pagar leem. O Financeiro JC ficticio nao tem
// a rota /produtos (supabase/seed.sql), entao serve de bloqueado junto com
// Vendas JA: barrados na tela e na funcao de autores do banco com o token da
// propria sessao; o mesmo pedido passa para o admin, para um 403 por outro
// motivo nao parecer bloqueio. Nada aqui grava.

const TELA = '/produtos/vinculos'
const TITULO = 'Vínculos por produto'
// Insumo e NF-e ficticios do seed (consumo semanal de insumos, nota b3).
const INSUMO = '[TESTE] Manteiga contagem'
const INSUMO_ID = '96200000-0000-4000-8000-000000000013'

async function autoresNoBanco(page: Page, perfil: Perfil) {
  const acesso = await entrarComo(page, perfil)
  return page.request.post(`${acesso.url}/rest/v1/rpc/list_vinculo_nfe_authors`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_product_id: INSUMO_ID },
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
}

test('Administrador consulta os vinculos de NF-e de um insumo na tela',
  matriz('Administrador', 'JC', 'permitido', 'Vinculos de NF-e (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'admin')
    await page.goto(TELA)
    await expect(page.getByRole('heading', { name: TITULO })).toBeVisible({ timeout: 20_000 })

    await page.getByLabel('Buscar produto do catálogo').fill('Manteiga contagem')
    await page.getByRole('button', { name: INSUMO, exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Memórias de vínculo por fornecedor' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Vínculos efetivamente salvos nas notas' })).toBeVisible()
    await expect(page.getByText(/NF 962001/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Uso atual nas fichas de receita' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

test('Administrador le os autores dos vinculos pela Data API',
  matriz('Administrador', 'JC', 'permitido', 'list_vinculo_nfe_authors (Data API)'),
  async ({ page }) => {
    const resposta = await autoresNoBanco(page, 'admin')
    expect(resposta.status(), await resposta.text()).toBe(200)
    expect(Array.isArray(await resposta.json())).toBe(true)
  })

test('Financeiro JC sem o Catalogo e barrado dos vinculos na tela',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'Vinculos de NF-e (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'financeiroJc')
    await page.goto(TELA)
    const origem = new URL(page.url()).origin
    // O guarda de rota manda para a primeira rota do perfil, "/" na conta
    // ficticia. Pagina de erro ou login nao contam como bloqueio: o menu
    // precisa estar aberto com o nome do financeiro.
    await expect(page).toHaveURL((endereco) => endereco.origin === origem && endereco.pathname === '/')
    await expect(page.getByTitle('Financeiro JC Teste')).toBeVisible()
    await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0)
  })

test('Financeiro JC sem o Catalogo e barrado dos autores na Data API',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'list_vinculo_nfe_authors (Data API)'),
  async ({ page }) => {
    const resposta = await autoresNoBanco(page, 'financeiroJc')
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })

test('Vendas JA e barrada dos autores na Data API',
  matriz('Vendas JA', 'JA', 'bloqueada', 'list_vinculo_nfe_authors (Data API)'),
  async ({ page }) => {
    const resposta = await autoresNoBanco(page, 'vendasJa')
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })
