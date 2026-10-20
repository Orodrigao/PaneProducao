import { expect, test, type Browser, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 19/10/2026 o Panetone de Frutas V1 foi duplicado do Panetone de Chocolate
// V1 e nao apareceu na busca do Romaneio: o Duplicar nao copiava a marcacao
// Lojas. Agora a copia de um pao das lojas nasce inativa, ja marcada e com o pao
// ligado desligado; ativada, chega a busca do Romaneio. O Administrador monta a
// origem (como o panetone: vende para PJ e para as lojas), duplica e ativa pela
// tela; a Expedicao JC procura no Romaneio antes e depois da ativacao.

const MARCA = Date.now().toString(36)
const ORIGEM = `[TESTE] Panetone origem ${MARCA}`
const COPIA = `[TESTE] Panetone copia ${MARCA}`
const LOJA = '[TESTE] Julio de Castilhos'

type ProdutoLido = { id: string; active: boolean; is_loja: boolean; legacy_bread_id: string | null }
type PaoLido = { name: string; active: boolean; is_pj: boolean }

async function lerProduto(page: Page, acesso: AcessoAoBanco, nome: string): Promise<ProdutoLido> {
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/products?name=eq.${encodeURIComponent(nome)}&select=id,active,is_loja,legacy_bread_id`,
    { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  const linhas = await resposta.json() as ProdutoLido[]
  expect(linhas, `o cadastro "${nome}" precisa existir uma vez so`).toHaveLength(1)
  return linhas[0]
}

async function lerPao(page: Page, acesso: AcessoAoBanco, paoId: string): Promise<PaoLido> {
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/breads?id=eq.${encodeURIComponent(paoId)}&select=name,active,is_pj`,
    { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  const linhas = await resposta.json() as PaoLido[]
  expect(linhas).toHaveLength(1)
  return linhas[0]
}

/**
 * A Expedicao JC abre um romaneio novo da JC num navegador limpo (sem rascunho
 * guardado) e procura o pao. Se a JC pediu algo hoje, ele aparece na busca do
 * catalogo; se nao pediu, o rascunho ja nasce com o catalogo inteiro e ele
 * aparece na lista.
 */
async function expedicaoAchaNoRomaneio(browser: Browser, nome: string): Promise<boolean> {
  const contexto = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const page = await contexto.newPage()
    await entrarComo(page, 'expedicaoJc')
    await page.goto('/romaneio')
    await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
    await page.getByRole('tab', { name: /^\[TESTE\] Julio de Castilhos/ }).click()
    await expect(page.locator('.ps-banner.honey', { hasText: `para ${LOJA}` })).toBeVisible({ timeout: 60_000 })
    await page.getByPlaceholder('Buscar pão cadastrado (ex.: ciabatta)...').fill(nome)
    const naBusca = page.getByRole('button', { name: nome })
    const naLista = page.locator('.ps-card', { hasText: nome })
    const nadaNovo = page.getByText(/^Nada novo com esse nome/)
    await expect(naBusca.or(naLista).or(nadaNovo).first()).toBeVisible({ timeout: 20_000 })
    return (await naBusca.count()) + (await naLista.count()) > 0
  } finally {
    await contexto.close()
  }
}

test('Administrador duplica pao das lojas; a copia ativada chega a busca do Romaneio da Expedicao JC',
  matriz('Administrador e Expedicao', 'JC', 'permitido', 'Duplicar produto (Lojas) -> busca do Romaneio'),
  async ({ page, browser }) => {
    test.setTimeout(240_000)
    const acesso = await entrarComo(page, 'admin')
    const cabecalhos = await cabecalhosDaSessao(page, acesso)
    const rest = `${acesso.url}/rest/v1`

    // Origem como o Panetone de Chocolate V1: categoria controlada, vende para
    // PJ e esta marcada Lojas.
    const categorias = await page.request.get(
      `${rest}/product_categories?name=eq.${encodeURIComponent('Pães Integ.')}&select=id,catalog_type`,
      { headers: cabecalhos, maxRedirects: 0 },
    )
    expect(categorias.status(), await categorias.text()).toBe(200)
    const [categoria] = await categorias.json() as Array<{ id: string; catalog_type: string }>
    expect(categoria, 'a categoria Pães Integ. existe no banco da PR').toBeTruthy()
    const criada = await page.request.post(`${rest}/products`, {
      headers: { ...cabecalhos, Prefer: 'return=minimal' },
      data: {
        name: ORIGEM, category: 'Pães Integ.', category_id: categoria.id, catalog_type: categoria.catalog_type,
        unit: 'un', kind: 'final', active: true, is_fabricacao_propria: true, is_pj: true, is_loja: true,
        production_area: 'padaria', production_process: 'forno', allows_planned_production: true,
        production_days: [1, 2, 3, 4, 5, 6],
      },
      maxRedirects: 0,
    })
    expect(criada.status(), await criada.text()).toBe(201)
    const origem = await lerProduto(page, acesso, ORIGEM)
    expect(origem.legacy_bread_id, 'a origem tem o pao das lojas ligado').toBeTruthy()

    // Duplicar pela tela.
    await page.goto('/produtos')
    await page.getByRole('tab', { name: /Fabricação própria/ }).click()
    await page.getByPlaceholder('Buscar fabricação própria...').fill(ORIGEM)
    await page.getByRole('button', { name: `Duplicar ${ORIGEM}`, exact: true }).click()
    const folha = page.getByRole('dialog', { name: 'Duplicar produto' })
    await expect(folha.getByText(/a marcação Lojas, mas começa inativa/)).toBeVisible()
    await folha.getByLabel('Novo nome').fill(COPIA)
    await folha.getByRole('button', { name: 'Duplicar produto', exact: true }).click()
    await expect(page.locator('.toast').filter({ hasText: 'foi duplicado' })).toBeVisible({ timeout: 20_000 })

    // Relido do banco: a copia nasce inativa, marcada Lojas e com pao proprio desligado.
    const copia = await lerProduto(page, acesso, COPIA)
    expect(copia.active).toBe(false)
    expect(copia.is_loja, 'a copia leva a marcacao Lojas').toBe(true)
    expect(copia.legacy_bread_id).toBe(`catalogo_${copia.id.replace(/-/g, '')}`)
    expect(await lerPao(page, acesso, copia.legacy_bread_id!)).toEqual({ name: COPIA, active: false, is_pj: false })

    // Inativa, a copia ainda nao aparece para a Expedicao.
    expect(await expedicaoAchaNoRomaneio(browser, COPIA), 'copia inativa fora do Romaneio').toBe(false)

    // Ativar pela lista de produtos acende o pao da copia.
    await page.getByPlaceholder('Buscar fabricação própria...').fill(COPIA)
    const linha = page.locator('div', { has: page.getByRole('button', { name: `Editar ${COPIA}`, exact: true }) }).last()
    await linha.getByRole('button', { name: 'Inativo' }).click()
    await expect(linha.getByRole('button', { name: '✓ Ativo' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await lerPao(page, acesso, copia.legacy_bread_id!)).active, { timeout: 20_000 }).toBe(true)

    expect(await expedicaoAchaNoRomaneio(browser, COPIA), 'copia ativada na busca do Romaneio').toBe(true)

    // Limpeza: inativar origem e copia tira os dois paes da producao.
    for (const nome of [COPIA, ORIGEM]) {
      await page.getByPlaceholder('Buscar fabricação própria...').fill(nome)
      const alvo = page.locator('div', { has: page.getByRole('button', { name: `Editar ${nome}`, exact: true }) }).last()
      page.once('dialog', dialogo => void dialogo.accept())
      await alvo.getByRole('button', { name: '✓ Ativo' }).click()
      await expect(alvo.getByRole('button', { name: 'Inativo' })).toBeVisible({ timeout: 20_000 })
    }
    await expect.poll(async () => (await lerPao(page, acesso, copia.legacy_bread_id!)).active, { timeout: 20_000 }).toBe(false)
  })
