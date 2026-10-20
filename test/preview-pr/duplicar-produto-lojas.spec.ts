import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 19/10/2026 o Panetone de Frutas V1 foi duplicado do Panetone de Chocolate
// V1 e nao apareceu na busca do Romaneio: o Duplicar nao copiava a marcacao
// Lojas. Agora a copia de um pao das lojas nasce inativa, ja marcada e com o pao
// ligado desligado; editada e salva, continua marcada; ativada, chega a busca do
// Romaneio. O Administrador monta a origem (como o panetone: vende para PJ e
// para as lojas), duplica, edita e ativa pela tela; a Expedicao JC procura no
// Romaneio antes e depois da ativacao.

const MARCA = Date.now().toString(36)
const ORIGEM = `[TESTE] Panetone origem ${MARCA}`
const COPIA = `[TESTE] Panetone copia ${MARCA}`
const COPIA_EDITADA = `[TESTE] Panetone de frutas ${MARCA}`
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

/** Inativa os produtos desta execucao; o gatilho desliga os paes ligados. */
async function inativarProdutos(page: Page, acesso: AcessoAoBanco, ids: string[]): Promise<number> {
  const resposta = await page.request.patch(`${acesso.url}/rest/v1/products?id=in.(${ids.join(',')})`, {
    headers: { ...await cabecalhosDaSessao(page, acesso), Prefer: 'return=minimal' },
    data: { active: false },
    maxRedirects: 0,
  })
  return resposta.status()
}

function campo(folha: Locator, rotulo: RegExp): Locator {
  return folha.locator('.ps-fieldgroup', { has: folha.page().locator('.ps-fieldlabel', { hasText: rotulo }) })
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

test('Administrador duplica pao das lojas; a copia editada e ativada chega a busca do Romaneio da Expedicao JC',
  matriz('Administrador e Expedicao', 'JC', 'permitido', 'Duplicar produto (Lojas) -> busca do Romaneio'),
  async ({ page, browser }) => {
    test.setTimeout(240_000)
    const acesso = await entrarComo(page, 'admin')
    const cabecalhos = await cabecalhosDaSessao(page, acesso)
    const rest = `${acesso.url}/rest/v1`
    const criados: string[] = []

    try {
      // Origem como o Panetone de Chocolate V1: categoria controlada, vende
      // para PJ e esta marcada Lojas.
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
      criados.push(origem.id)
      expect(origem.legacy_bread_id, 'a origem tem o pao das lojas ligado').toBeTruthy()

      // Duplicar pela tela.
      await page.goto('/produtos')
      await page.getByRole('tab', { name: /Fabricação própria/ }).click()
      const busca = page.getByPlaceholder('Buscar fabricação própria...')
      await busca.fill(ORIGEM)
      await page.getByRole('button', { name: `Duplicar ${ORIGEM}`, exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Duplicar produto' })
      await expect(modal.getByText(/a marcação Lojas, mas começa inativa/)).toBeVisible()
      await modal.getByLabel('Novo nome').fill(COPIA)
      await modal.getByRole('button', { name: 'Duplicar produto', exact: true }).click()
      await expect(page.locator('.toast').filter({ hasText: 'foi duplicado' })).toBeVisible({ timeout: 20_000 })

      // Relido do banco: a copia nasce inativa, marcada Lojas e com pao proprio desligado.
      const copia = await lerProduto(page, acesso, COPIA)
      criados.push(copia.id)
      expect(copia.active).toBe(false)
      expect(copia.is_loja, 'a copia leva a marcacao Lojas').toBe(true)
      const paoDaCopia = `catalogo_${copia.id.replace(/-/g, '')}`
      expect(copia.legacy_bread_id).toBe(paoDaCopia)
      expect(await lerPao(page, acesso, paoDaCopia)).toEqual({ name: COPIA, active: false, is_pj: false })

      // Editar e salvar a copia inativa pela tela mantem a marcacao e leva o
      // nome novo ao pao, que continua desligado.
      await busca.fill(COPIA)
      await page.getByRole('button', { name: `Editar ${COPIA}`, exact: true }).click()
      const folha = page.locator('.ps-sheet')
      await expect(folha.getByRole('heading', { name: 'Editar Produto' })).toBeVisible()
      await expect(folha.getByRole('checkbox', { name: /Lojas/ }), 'a copia abre marcada Lojas').toBeChecked()
      await campo(folha, /^Nome$/).locator('input').fill(COPIA_EDITADA)
      await folha.getByRole('button', { name: 'Salvar', exact: true }).click()
      await expect(page.locator('.toast').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 20_000 })
      expect(await lerProduto(page, acesso, COPIA_EDITADA)).toEqual({
        id: copia.id, active: false, is_loja: true, legacy_bread_id: paoDaCopia,
      })
      expect(await lerPao(page, acesso, paoDaCopia)).toEqual({ name: COPIA_EDITADA, active: false, is_pj: false })

      // Inativa, a copia ainda nao aparece para a Expedicao.
      expect(await expedicaoAchaNoRomaneio(browser, COPIA_EDITADA), 'copia inativa fora do Romaneio').toBe(false)

      // Ativar pela lista de produtos acende o pao da copia.
      await busca.fill(COPIA_EDITADA)
      const linha = page.locator('div', { has: page.getByRole('button', { name: `Editar ${COPIA_EDITADA}`, exact: true }) }).last()
      await linha.getByRole('button', { name: 'Inativo' }).click()
      await expect(linha.getByRole('button', { name: '✓ Ativo' })).toBeVisible({ timeout: 20_000 })
      await expect.poll(async () => (await lerPao(page, acesso, paoDaCopia)).active, { timeout: 20_000 }).toBe(true)

      expect(await expedicaoAchaNoRomaneio(browser, COPIA_EDITADA), 'copia ativada na busca do Romaneio').toBe(true)

      // Limpeza conferida: inativar origem e copia desliga os dois paes.
      expect(await inativarProdutos(page, acesso, criados)).toBe(204)
      expect((await lerPao(page, acesso, paoDaCopia)).active).toBe(false)
      expect((await lerPao(page, acesso, origem.legacy_bread_id!)).active).toBe(false)
    } finally {
      // Falha no meio nao deixa pao desta execucao ativo no banco da PR.
      if (criados.length) await inativarProdutos(page, acesso, criados).catch(() => 0)
    }
  })
