import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Vinculos de NF-e. Consulta (fase 2): Administracao e o Financeiro com acesso
// ao Catalogo e ao Contas a pagar leem; o Financeiro JC ficticio nao tem a rota
// /produtos (supabase/seed.sql) e serve de bloqueado junto com Vendas JA e
// Expedicao JC, barrados na tela e no banco com o token da propria sessao.
// Correcao da memoria (fase 3): Administrador e Financeiro Catalogo JC gravam
// no banco isolado da PR, sempre voltando a memoria ficticia a um estado que
// permite rodar de novo no mesmo banco.

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
    // Erro de carga aparece com o botao de nova tentativa. Nao vale contar
    // role=alert: o anunciador de rota do Next.js e um alert vazio em toda pagina.
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0)
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

// ---- Fase 3: corrigir, desligar e religar a memoria (grava no banco da PR) ----
// Memorias ficticias do seed (supabase/seed.sql, "Vinculos de NF-e, fase 3").
// Cada teste parte do estado que encontrar e termina com a memoria ligada, para
// rodar de novo no mesmo banco a cada push.
const MEMORIA_ADMIN = '[TESTE] Manteiga caixa memoria admin'
const MEMORIA_FINANCEIRO = '[TESTE] Manteiga caixa memoria financeiro'
const MEMORIA_ADMIN_ID = '96500000-0000-4000-8000-000000000101'

async function abrirMemorias(page: Page) {
  await page.goto(TELA)
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Buscar produto do catálogo').fill('Manteiga contagem')
  await page.getByRole('button', { name: INSUMO, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Memórias de vínculo por fornecedor' })).toBeVisible({ timeout: 20_000 })
}

// So a secao das memorias: o historico de correcoes repete a descricao do item.
function memoria(page: Page, descricao: string) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Memórias de vínculo por fornecedor' }) })
    .locator('article', { hasText: descricao })
}

async function confirmarAcao(page: Page, descricao: string, botao: string, confirmar: string, aviso: string, estado: RegExp) {
  const cartao = memoria(page, descricao)
  await cartao.getByRole('button', { name: botao, exact: true }).click()
  await expect(cartao.getByText('Confira o efeito antes de confirmar')).toBeVisible()
  await expect(cartao.getByText(/Nenhuma nota já gravada muda|continuam como estão/)).toBeVisible()
  await cartao.getByRole('button', { name: confirmar }).click()
  await expect(page.getByRole('status').filter({ hasText: aviso })).toBeVisible({ timeout: 20_000 })
  // O aviso aparece antes de a lista recarregar: espera o cartao no estado novo.
  await expect(memoria(page, descricao).getByText(estado)).toBeVisible({ timeout: 20_000 })
}

async function corrigirNoBanco(page: Page, perfil: Perfil) {
  const acesso = await entrarComo(page, perfil)
  return page.request.post(`${acesso.url}/rest/v1/rpc/correct_payable_product_mapping`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {
      p_request_id: randomUUID(),
      p_mapping_id: MEMORIA_ADMIN_ID,
      p_expected_updated_at: new Date().toISOString(),
      p_action: 'desligar',
    },
    maxRedirects: 0,
  })
}

test('Administrador desliga e religa uma memoria de vinculo, e o desligamento persiste',
  matriz('Administrador', 'JC', 'permitido', 'Desligar e religar memoria (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'admin')
    await abrirMemorias(page)
    // Rodada anterior interrompida pode ter deixado desligada: religa antes.
    if (await memoria(page, MEMORIA_ADMIN).getByText(/Desligada: não é sugerida/).count() > 0) {
      await confirmarAcao(page, MEMORIA_ADMIN, 'Religar', 'Confirmar religação', 'Memória religada', /Ligada: sugerida/)
    }
    await confirmarAcao(page, MEMORIA_ADMIN, 'Desligar', 'Confirmar desligamento', 'Memória desligada', /Desligada: não é sugerida/)

    // Persistencia: relida do banco depois de recarregar a pagina.
    await page.reload()
    await abrirMemorias(page)
    await expect(memoria(page, MEMORIA_ADMIN).getByText(/Desligada: não é sugerida/)).toBeVisible()
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Correções de memória' }) })
      .locator('article', { hasText: 'Memória desligada' }).filter({ hasText: MEMORIA_ADMIN }).first()).toBeVisible()

    await confirmarAcao(page, MEMORIA_ADMIN, 'Religar', 'Confirmar religação', 'Memória religada', /Ligada: sugerida/)
  })

test('Financeiro Catalogo corrige o fator de uma memoria e a correcao persiste',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Corrigir memoria (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'financeiroCatalogoJc')
    await abrirMemorias(page)
    const cartao = memoria(page, MEMORIA_FINANCEIRO)
    // Alterna entre 10 e 12 kg por caixa: cada rodada muda alguma coisa.
    const novoFator = await cartao.getByText(/fator 12 \(/).count() > 0 ? '10' : '12'

    await cartao.getByRole('button', { name: 'Corrigir', exact: true }).click()
    await cartao.getByLabel('Produto certo').fill('Manteiga contagem')
    await cartao.getByRole('button', { name: `${INSUMO} (kg)` }).click()
    await cartao.getByLabel(/Quanto vem em 1 CX da nota/).fill(novoFator)

    // Descarte: voltar da previa nao grava nada.
    await cartao.getByRole('button', { name: 'Ver efeito' }).click()
    await expect(cartao.getByText(`vai sugerir ${INSUMO}, 1 CX = ${novoFator} kg`, { exact: false })).toBeVisible()
    await cartao.getByRole('button', { name: 'Voltar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Memória corrigida' })).toHaveCount(0)

    await cartao.getByRole('button', { name: 'Ver efeito' }).click()
    await cartao.getByRole('button', { name: 'Confirmar correção' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Memória corrigida' })).toBeVisible({ timeout: 20_000 })
    await expect(memoria(page, MEMORIA_FINANCEIRO).getByText(new RegExp(`fator ${novoFator} \\(`))).toBeVisible({ timeout: 20_000 })

    await page.reload()
    await abrirMemorias(page)
    await expect(memoria(page, MEMORIA_FINANCEIRO).getByText(new RegExp(`fator ${novoFator} \\(`))).toBeVisible()
    await expect(memoria(page, MEMORIA_FINANCEIRO).getByText(/por Financeiro Catalogo JC Teste/)).toBeVisible()
  })

for (const [perfil, nome, loja] of [
  ['financeiroJc', 'Financeiro JC', 'JC'],
  ['vendasJa', 'Vendas JA', 'JA'],
  ['expedicaoJc', 'Expedicao JC', 'JC'],
] as const) {
  test(`${nome} e barrado da correcao de memoria na Data API`,
    matriz(nome, loja, 'bloqueado', 'correct_payable_product_mapping (Data API)'),
    async ({ page }) => {
      const resposta = await corrigirNoBanco(page, perfil)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
    })
}

test('Expedicao JC e barrada da tela de vinculos',
  matriz('Expedicao JC', 'JC', 'bloqueado', 'Vinculos de NF-e (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'expedicaoJc')
    await page.goto(TELA)
    const origem = new URL(page.url()).origin
    await expect(page).toHaveURL((endereco) => endereco.origin === origem && endereco.pathname === '/')
    await expect(page.getByTitle('Expedicao JC Teste')).toBeVisible()
    await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0)
  })
