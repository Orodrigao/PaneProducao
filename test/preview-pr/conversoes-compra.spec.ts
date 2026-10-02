import { expect, test, type Page, type Route } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Conversoes de compra na tela Produtos: so leitura, com atalho para a
// correcao em Catalogo > Vinculos NF-e. Salvar o produto nao toca mais nas
// memorias do fornecedor (antes reenviava todas e marcava o fator como
// conferido). A funcao antiga public.update_payable_product_mappings foi
// removida do banco em 02/10/2026: nem o Administrador, que antes podia usa-la,
// a encontra mais na Data API.

// Insumo e memorias ficticias do seed (supabase/seed.sql, "Vinculos de NF-e, fase 3").
const INSUMO = '[TESTE] Manteiga contagem'
const INSUMO_ID = '96200000-0000-4000-8000-000000000013'
const MEMORIA_ADMIN_ID = '96500000-0000-4000-8000-000000000101'

interface MemoriaLida {
  id: string
  updated_at: string
  last_confirmed_at: string | null
  last_confirmed_by: string | null
  factor_confirmed: boolean
  conversion_factor: number
}

// Le com a sessao ja aberta: entrar de novo na mesma aba nao mostra o login.
async function memoriasDoInsumo(page: Page, acesso: AcessoAoBanco): Promise<MemoriaLida[]> {
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/payable_product_mappings?base_product_id=eq.${INSUMO_ID}&select=id,updated_at,last_confirmed_at,last_confirmed_by,factor_confirmed,conversion_factor&order=id`,
    { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  return await resposta.json() as MemoriaLida[]
}

async function abrirInsumoNoCatalogo(page: Page) {
  await page.goto('/produtos')
  await page.getByPlaceholder('Buscar produto...').fill('Manteiga contagem')
  await page.getByRole('button', { name: `Editar ${INSUMO}`, exact: true }).click()
  await expect(page.getByText('Conversões de compra', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('conversao-compra').first()).toBeVisible({ timeout: 20_000 })
}

for (const [perfil, nome] of [
  ['admin', 'Administrador'],
  ['financeiroCatalogoJc', 'Financeiro Catalogo JC'],
] as const) {
  test(`${nome} ve as conversoes so para leitura e o atalho abre os vinculos do produto`,
    matriz(nome, 'JC', 'permitido', 'Conversoes de compra (tela Produtos) e atalho para Vinculos NF-e'),
    async ({ page }) => {
      await entrarComo(page, perfil)
      await abrirInsumoNoCatalogo(page)

      const conversoes = page.getByTestId('conversao-compra')
      expect(await conversoes.count()).toBeGreaterThanOrEqual(2)
      // Nada editavel dentro dos cartoes: os campos antigos nao tinham rotulo
      // associado, entao a conferencia e por elemento, nao por nome.
      await expect(conversoes.locator('input, select, textarea')).toHaveCount(0)
      await expect(conversoes.first().getByText(/fator (conferido|ainda não conferido)/)).toBeVisible()

      const atalho = page.getByRole('link', { name: 'Corrigir em Vínculos NF-e' })
      await expect(atalho).toHaveAttribute('href', `/produtos/vinculos?produto=${INSUMO_ID}`)

      // Clique real: o atalho abre outra aba e o cadastro continua aberto nesta,
      // com a edicao pendente (nome alterado e nao salvo) intacta.
      // A cerca de rede de entrar.ts vale por pagina; a aba nova nao a tem, entao
      // tudo que ela pede e barrado aqui (as rotas da pagina cercada vencem as do
      // contexto) e so o endereco pedido e conferido.
      const campoNome = page.locator('.ps-fieldgroup', { has: page.locator('.ps-fieldlabel', { hasText: /^Nome$/ }) }).locator('input')
      const rascunho = `${INSUMO} rascunho nao salvo`
      await campoNome.fill(rascunho)
      const pedidosDaAba: string[] = []
      const barrarAbaNova = async (route: Route) => {
        pedidosDaAba.push(route.request().url())
        await route.abort('blockedbyclient')
      }
      await page.context().route('**/*', barrarAbaNova)
      try {
        const [aba] = await Promise.all([page.context().waitForEvent('page'), atalho.click()])
        await expect.poll(() => pedidosDaAba.map(url => { const alvo = new URL(url); return `${alvo.pathname}${alvo.search}` }))
          .toContain(`/produtos/vinculos?produto=${INSUMO_ID}`)
        await aba.close()
      } finally {
        await page.context().unroute('**/*', barrarAbaNova)
      }
      await expect(page.getByText('Conversões de compra', { exact: true })).toBeVisible()
      await expect(campoNome).toHaveValue(rascunho)

      // O mesmo endereco na pagina cercada: a tela abre ja no produto.
      await page.goto(`/produtos/vinculos?produto=${INSUMO_ID}`)
      await expect(page.getByRole('heading', { name: `${INSUMO} (kg)` })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('heading', { name: 'Memórias de vínculo por fornecedor' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /Tentar novamente|Carregar fichas de novo/ })).toHaveCount(0)
    })
}

test('Salvar o produto nao altera as memorias de vinculo do fornecedor',
  matriz('Administrador', 'JC', 'permitido', 'Salvar produto sem tocar nas memorias (tela Produtos)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'admin')
    const antes = await memoriasDoInsumo(page, acesso)
    expect(antes.length).toBeGreaterThanOrEqual(2)

    await abrirInsumoNoCatalogo(page)
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.locator('.toast').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.toast').filter({ hasText: 'Erro' })).toHaveCount(0)

    // Relido do banco depois de recarregar: mesma versao, mesmo autor, mesmo fator.
    await page.reload()
    const depois = await memoriasDoInsumo(page, acesso)
    expect(depois).toEqual(antes)
  })

test('A funcao antiga de conversoes nao existe mais na Data API, nem para o Administrador',
  matriz('Administrador', 'JC', 'bloqueado', 'update_payable_product_mappings removida (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'admin')
    const antes = await memoriasDoInsumo(page, acesso)
    const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/update_payable_product_mappings`, {
      headers: await cabecalhosDaSessao(page, acesso),
      data: {
        p_product_id: INSUMO_ID,
        p_mappings: [{ id: MEMORIA_ADMIN_ID, conversion_basis: 'package', conversion_factor: 10 }],
      },
      maxRedirects: 0,
    })
    const corpo = await resposta.text()
    // 404 com PGRST202: o PostgREST nao acha a funcao no schema, nao e recusa
    // de permissao (que seria 403 com 42501).
    expect(resposta.status(), corpo).toBe(404)
    expect(JSON.parse(corpo)).toMatchObject({ code: 'PGRST202' })
    expect(await memoriasDoInsumo(page, acesso)).toEqual(antes)
  })
