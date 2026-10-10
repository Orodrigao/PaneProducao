import { expect, test, type Locator, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// O catalogo alimenta os paes das lojas. Antes, pao cadastrado so no Catalogo
// (o "LA Rustico", outubro de 2026) nunca chegava ao Planejamento nem a busca
// do Romaneio, que leem a lista antiga de paes. Agora "Lojas" no cadastro cria
// e mantem esse pao. Aqui o Administrador cadastra pela tela, o pao aparece no
// Planejamento do dia marcado e na busca do Romaneio, e inativar no Catalogo o
// tira da producao. Vendas JA le a lista, mas nao cadastra produto.

const MARCA = `[TESTE] Pao das lojas ${Date.now().toString(36)}`

type ProdutoLido = { id: string; is_loja: boolean; legacy_bread_id: string | null }
type PaoLido = { name: string; days: number[]; active: boolean; is_pj: boolean }

async function lerProduto(page: Page, acesso: AcessoAoBanco): Promise<ProdutoLido> {
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/products?name=eq.${encodeURIComponent(MARCA)}&select=id,is_loja,legacy_bread_id`,
    { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  const linhas = await resposta.json() as ProdutoLido[]
  expect(linhas, 'o cadastro desta execucao precisa existir uma vez so').toHaveLength(1)
  return linhas[0]
}

async function lerPao(page: Page, acesso: AcessoAoBanco, paoId: string): Promise<PaoLido> {
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/breads?id=eq.${encodeURIComponent(paoId)}&select=name,days,active,is_pj`,
    { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  const linhas = await resposta.json() as PaoLido[]
  expect(linhas).toHaveLength(1)
  return linhas[0]
}

function campo(folha: Locator, rotulo: RegExp): Locator {
  return folha.locator('.ps-fieldgroup', { has: folha.page().locator('.ps-fieldlabel', { hasText: rotulo }) })
}

/** Primeiro dia da semana com o planejamento ainda vazio (sem plano criado). */
async function diaSemPlano(page: Page): Promise<{ botao: Locator; nome: string; previstos: number }> {
  await page.goto('/planejamento-producao')
  await expect(page.getByText('Dia selecionado', { exact: true })).toBeVisible({ timeout: 30_000 })
  const dias = page.getByRole('group', { name: 'Planejar para' }).getByRole('button')
  const criar = page.getByRole('button', { name: 'Criar rascunho' })
  const previstos = page.getByText(/^\d+ pães previstos para a data\.$/)
  const total = await dias.count()
  for (let indice = 0; indice < total; indice += 1) {
    const botao = dias.nth(indice)
    await botao.click()
    await expect(botao).toHaveAttribute('aria-pressed', 'true')
    const banner = page.locator('.ps-banner').filter({ hasText: /\d{2}\/\d{2}\/\d{4}\s+-\s/ })
    await expect(criar.or(banner).first()).toBeVisible({ timeout: 30_000 })
    if (await criar.isVisible()) {
      await expect(previstos).toBeVisible({ timeout: 30_000 })
      const texto = await previstos.innerText()
      const nome = (await botao.locator('span').first().innerText()).trim()
      return { botao, nome, previstos: Number(texto.split(' ')[0]) }
    }
  }
  throw new Error('Nenhum dia da semana esta sem planejamento no banco desta PR; o roteiro nao cria nem apaga plano alheio.')
}

test('Administrador cadastra pao no Catalogo com Lojas e ele chega ao Planejamento e ao Romaneio',
  matriz('Administrador', 'JC/JA', 'permitido', 'Catalogo (Lojas) -> Planejamento e busca do Romaneio'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'admin')

    // Dia escolhido pela tela: o primeiro ainda sem plano, para o pao novo
    // entrar na contagem e no rascunho sem mexer em plano de outra execucao.
    const dia = await diaSemPlano(page)
    const indiceDoDia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].indexOf(dia.nome)
    expect(indiceDoDia, `dia da semana reconhecido: ${dia.nome}`).toBeGreaterThan(0)

    // Cadastro pela tela, como o Rodrigo fez com o LA Rustico.
    await page.goto('/produtos')
    await page.getByRole('tab', { name: /Fabricação própria/ }).click()
    await page.getByRole('button', { name: 'Novo', exact: true }).click()
    const folha = page.locator('.ps-sheet')
    await expect(folha.getByRole('heading', { name: 'Novo Produto' })).toBeVisible()
    await campo(folha, /^Nome$/).locator('input').fill(MARCA)
    await campo(folha, /^Categoria$/).locator('select').selectOption({ label: 'Pães Integ.' })
    const lojas = folha.getByRole('checkbox', { name: /Lojas/ })
    await expect(lojas, 'pao novo de fabricacao propria nasce marcado para as lojas').toBeChecked()
    await campo(folha, /Como o produto final é produzido/).locator('select').selectOption('forno')
    await folha.getByRole('checkbox', { name: /Aceita quantidade planejada/ }).check()
    await campo(folha, /^Dias de produção$/).getByRole('button', { name: dia.nome, exact: true }).click()
    await folha.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.locator('.toast').filter({ hasText: 'Produto criado' })).toBeVisible({ timeout: 20_000 })

    // Relido do banco: o pao das lojas nasceu ligado, com o nome e o dia.
    const produto = await lerProduto(page, acesso)
    expect(produto.is_loja).toBe(true)
    expect(produto.legacy_bread_id, 'o banco liga o produto ao pao que criou').toBeTruthy()
    expect(await lerPao(page, acesso, produto.legacy_bread_id!)).toEqual({
      name: MARCA, days: [indiceDoDia], active: true, is_pj: false,
    })

    // Depois de recarregar, o cadastro continua marcado Lojas.
    await page.reload()
    await page.getByPlaceholder('Buscar produto...').fill(MARCA)
    await page.getByRole('button', { name: `Editar ${MARCA}`, exact: true }).click()
    await expect(page.locator('.ps-sheet').getByRole('checkbox', { name: /Lojas/ })).toBeChecked()
    await page.locator('.ps-sheet').getByRole('button', { name: 'Cancelar', exact: true }).click()

    // Planejamento: um pao a mais previsto no dia, e ele aparece no rascunho.
    await page.goto('/planejamento-producao')
    const botaoDoDia = page.getByRole('group', { name: 'Planejar para' }).getByRole('button', { name: new RegExp(`^${dia.nome}`) })
    await botaoDoDia.click()
    await expect(botaoDoDia).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`${dia.previstos + 1} pães previstos para a data.`, { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Criar rascunho' }).click()
    await expect(page.locator('.ps-pname', { hasText: MARCA })).toBeVisible({ timeout: 30_000 })
    // Limpa o proprio rascunho: o banco da PR e de todos os roteiros dela.
    page.once('dialog', dialogo => void dialogo.accept())
    await page.getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByRole('button', { name: 'Criar rascunho' })).toBeVisible({ timeout: 30_000 })

    // Romaneio: o pao novo esta disponivel para a loja. Se a JA pediu algo
    // hoje, ele aparece na busca do catalogo; se nao pediu, o rascunho ja nasce
    // com o catalogo inteiro e ele aparece na lista (e a busca diz "Nada novo").
    await page.goto('/romaneio')
    await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
    await page.getByRole('tab', { name: /^\[TESTE\] Jardim America/ }).click()
    await expect(page.locator('.ps-banner.honey', { hasText: 'para [TESTE] Jardim America' })).toBeVisible({ timeout: 60_000 })
    await page.getByPlaceholder('Buscar pão cadastrado (ex.: ciabatta)...').fill(MARCA)
    const naBusca = page.getByRole('button', { name: MARCA })
    const naLista = page.locator('.ps-card', { hasText: MARCA })
    await expect(naBusca.or(naLista).first()).toBeVisible({ timeout: 20_000 })

    // Inativar no Catalogo tira o pao da producao.
    await page.goto('/produtos')
    await page.getByRole('tab', { name: /Fabricação própria/ }).click()
    await page.getByPlaceholder('Buscar produto...').fill(MARCA)
    const linha = page.locator('div', { has: page.getByRole('button', { name: `Editar ${MARCA}`, exact: true }) }).last()
    await linha.getByRole('button', { name: '✓ Ativo' }).click()
    await expect(linha.getByRole('button', { name: 'Inativo' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await lerPao(page, acesso, produto.legacy_bread_id!)).active, { timeout: 20_000 }).toBe(false)
  })

test('Vendas JA le a lista de paes das lojas, mas nao cadastra produto',
  matriz('Vendas', 'JA', 'bloqueado', 'Cadastro de produto (Data API) e leitura dos paes do Romaneio'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'vendasJa')
    const cabecalhos = await cabecalhosDaSessao(page, acesso)

    const leitura = await page.request.get(`${acesso.url}/rest/v1/breads?active=eq.true&is_pj=eq.false&select=id&limit=1`, {
      headers: cabecalhos, maxRedirects: 0,
    })
    expect(leitura.status(), await leitura.text()).toBe(200)

    const nome = `${MARCA} vendas`
    const tentativa = await page.request.post(`${acesso.url}/rest/v1/products`, {
      headers: cabecalhos,
      data: { name: nome, unit: 'un', kind: 'final', is_fabricacao_propria: true, is_loja: true },
      maxRedirects: 0,
    })
    const corpo = await tentativa.text()
    expect(tentativa.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })

    const sobra = await page.request.get(`${acesso.url}/rest/v1/breads?name=eq.${encodeURIComponent(nome)}&select=id`, {
      headers: cabecalhos, maxRedirects: 0,
    })
    expect(sobra.status(), await sobra.text()).toBe(200)
    expect(await sobra.json(), 'a tentativa barrada nao cria pao').toEqual([])
  })
