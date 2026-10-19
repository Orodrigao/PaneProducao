import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Vinculos de NF-e, fase 5: item de nota entre uso ou despesa e insumo. O
// Financeiro Catalogo JC tira do uso ou despesa a margarina ficticia de uma conta
// PAGA (com juros no livro), confere a previa financeira, descarta uma vez,
// confirma, rele e desfaz; depois marca o pano ficticio como uso ou despesa pela
// lista do produto e desfaz. Financeiro JC (sem o Catalogo), Vendas JA e
// Expedicao JC sao barrados na funcao com o token da propria sessao. Os roteiros
// terminam com os itens como no seed; se uma rodada anterior parou no meio,
// desfazem primeiro.

const TELA = '/produtos/vinculos'
const DESTINO = '[TESTE] Vinculo uso destino'
const MARGARINA = '[TESTE] Margarina caixa uso'
const CAIXA_MARGARINA = `Corrigir item ${MARGARINA} da NF 967001`
const PANO_PRODUTO = '[TESTE] Vinculo uso pano'
const PANO = '[TESTE] Pano multiuso rolao'
const CAIXA_PANO = `Corrigir item ${PANO} da NF 967002`
const PANO_ID = '96700000-0000-4000-8000-0000000000d2'

async function abrirTela(page: Page) {
  await page.goto(TELA)
  await expect(page.getByRole('heading', { name: 'Vínculos por produto' })).toBeVisible({ timeout: 20_000 })
}

function secaoUso(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Itens lançados como uso ou despesa' }) })
}

async function abrirUsoDespesa(page: Page, filtro: string) {
  await abrirTela(page)
  await secaoUso(page).getByRole('button', { name: 'Ver itens lançados como uso ou despesa' }).click()
  await expect(page.getByLabel('Filtrar por fornecedor, descrição ou número da nota')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Filtrar por fornecedor, descrição ou número da nota').fill(filtro)
}

async function abrirProduto(page: Page, nome: string) {
  await abrirTela(page)
  await page.getByLabel('Buscar produto do catálogo').fill(nome.replace('[TESTE] ', ''))
  await page.getByRole('button', { name: nome, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vínculos efetivamente salvos nas notas' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Correções de itens de notas' })).toBeVisible()
}

function historico(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Correções de itens de notas' }) })
}

async function desfazerUltima(page: Page, conferir: RegExp) {
  const pendente = historico(page).locator('article', { hasText: 'Itens corrigidos' })
    .filter({ has: page.getByRole('button', { name: 'Desfazer' }) }).first()
  await pendente.getByRole('button', { name: 'Desfazer' }).click()
  // A previa repete as frases do historico: as conferencias ficam dentro dela.
  const previa = pendente.getByRole('region', { name: 'Confira o efeito de desfazer antes de confirmar' })
  await expect(previa).toBeVisible({ timeout: 20_000 })
  await expect(previa.getByText(conferir).first()).toBeVisible()
  await expect(previa.getByText(/Desfazer não religa memória desligada/)).toBeVisible()
  await previa.getByRole('button', { name: 'Confirmar desfazer' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Correção desfeita' })).toBeVisible({ timeout: 20_000 })
}

async function pedirPreviaDaMargarina(page: Page) {
  await page.getByLabel(CAIXA_MARGARINA).check()
  await secaoUso(page).getByRole('button', { name: 'Corrigir para um produto' }).click()
  await page.getByLabel('Produto certo').fill('Vinculo uso destino')
  await page.getByRole('button', { name: `${DESTINO} (kg)` }).click()
  await page.getByLabel(/Quanto vem em 1 CX da nota/).fill('30')
  await secaoUso(page).getByRole('button', { name: 'Ver prévia' }).click()
  const previa = secaoUso(page).getByRole('region', { name: 'Confira o efeito antes de confirmar' })
  await expect(previa).toBeVisible({ timeout: 20_000 })
  return previa
}

test('Financeiro Catalogo tira de uso ou despesa um item de conta paga, confere a previa financeira, a correcao persiste e e desfeita',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Tirar item de uso ou despesa (tela)'),
  async ({ page }) => {
    test.setTimeout(150_000)
    await entrarComo(page, 'financeiroCatalogoJc')
    await abrirUsoDespesa(page, 'Margarina caixa uso')

    // Rodada anterior parou depois de corrigir: volta ao estado do seed.
    if (await page.getByLabel(CAIXA_MARGARINA).count() === 0) {
      await abrirProduto(page, DESTINO)
      await desfazerUltima(page, /→ uso ou despesa/)
      await abrirUsoDespesa(page, 'Margarina caixa uso')
    }
    await expect(page.getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
    await expect(secaoUso(page).getByText('conta paga').first()).toBeVisible()

    // Entrada invalida bloqueia a previa com o motivo escrito.
    await page.getByLabel(CAIXA_MARGARINA).check()
    await secaoUso(page).getByRole('button', { name: 'Corrigir para um produto' }).click()
    await page.getByLabel('Produto certo').fill('Vinculo uso destino')
    await page.getByRole('button', { name: `${DESTINO} (kg)` }).click()
    await page.getByLabel(/Quanto vem em 1 CX da nota/).fill('1.000')
    await expect(secaoUso(page).getByRole('button', { name: 'Ver prévia' })).toBeDisabled()
    await expect(secaoUso(page).getByText(/1\.000 é recusado/)).toBeVisible()
    await secaoUso(page).getByRole('button', { name: 'Cancelar' }).click()
    await page.getByLabel(CAIXA_MARGARINA).uncheck()

    // Previa: item, custo, conta paga com juros e livro, consumo e memoria.
    let previa = await pedirPreviaDaMargarina(page)
    await expect(previa.getByText(/uso ou despesa \(fora da receita, do estoque e do custo\) → \[TESTE\] Vinculo uso destino, fator 30, 30 kg/)).toBeVisible()
    await expect(previa.getByText(/Custo de \[TESTE\] Vinculo uso destino/)).toBeVisible()
    const conta = previa.getByRole('list', { name: 'Conta e livro-caixa' })
    await expect(conta.getByText(/conta paga: 1 de 1 parcela\(s\) paga\(s\), R\$\s275,00 saíram do caixa/)).toBeVisible()
    await expect(conta.getByText(/dos quais R\$\s5,00 de juros ou multa/)).toBeVisible()
    await expect(conta.getByText(/no livro-caixa: CMV — Matéria-prima R\$\s270,00 em março de 2025; Financeiras R\$\s5,00 em março de 2025/)).toBeVisible()
    await expect(conta.getByText(/Nada disso muda com esta correção\./)).toBeVisible()
    await expect(previa.getByRole('list', { name: 'Consumo semanal' })).toBeVisible()
    await expect(previa.getByRole('list', { name: 'Memória do fornecedor' }).getByText(/(será desligada|chega sem sugestão)/)).toBeVisible()
    await expect(previa.getByText(/Contas, parcelas, pagamentos, rateio e o livro-caixa não mudam/)).toBeVisible()

    // Descarte: voltar da previa nao grava nada.
    await previa.getByRole('button', { name: 'Voltar' }).click()
    await page.reload()
    await abrirUsoDespesa(page, 'Margarina caixa uso')
    await expect(page.getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })

    previa = await pedirPreviaDaMargarina(page)
    await previa.getByRole('button', { name: 'Confirmar correção' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Correção gravada: 1 item(ns) saíram de uso ou despesa' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel(CAIXA_MARGARINA)).toHaveCount(0, { timeout: 20_000 })

    // Persistencia: o item sai da lista de uso ou despesa e entra no produto.
    await page.reload()
    await abrirUsoDespesa(page, 'Margarina caixa uso')
    await expect(page.getByLabel(CAIXA_MARGARINA)).toHaveCount(0)
    await abrirProduto(page, DESTINO)
    await expect(page.getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Conversão registrada: 30 \(package\) · quantidade útil 30 kg/)).toBeVisible()
    await expect(historico(page).getByText(/Itens corrigidos · por Financeiro Catalogo JC Teste/).first()).toBeVisible({ timeout: 20_000 })

    await desfazerUltima(page, /→ uso ou despesa \(fora da receita, do estoque e do custo\)/)
    await page.reload()
    await abrirUsoDespesa(page, 'Margarina caixa uso')
    await expect(page.getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
  })

test('Financeiro Catalogo marca como uso ou despesa um item ligado a produto, a correcao persiste e e desfeita',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Marcar item como uso ou despesa (tela)'),
  async ({ page }) => {
    test.setTimeout(150_000)
    await entrarComo(page, 'financeiroCatalogoJc')
    await abrirProduto(page, PANO_PRODUTO)

    // Rodada anterior parou depois de corrigir: volta ao estado do seed.
    if (await page.getByLabel(CAIXA_PANO).count() === 0) {
      await desfazerUltima(page, /→ \[TESTE\] Vinculo uso pano, fator 1/)
      await abrirProduto(page, PANO_PRODUTO)
    }

    // A lista de uso ou despesa fica aberta na mesma página enquanto o pano
    // muda pela lista do produto: ela precisa reler sozinha.
    await abrirUsoDespesa(page, 'Pano multiuso rolao')
    await expect(secaoUso(page).getByLabel(CAIXA_PANO)).toHaveCount(0)
    await page.getByLabel('Buscar produto do catálogo').fill('Vinculo uso pano')
    await page.getByRole('button', { name: PANO_PRODUTO, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Vínculos efetivamente salvos nas notas' })).toBeVisible({ timeout: 20_000 })

    await page.getByLabel(CAIXA_PANO).check()
    await page.getByRole('button', { name: 'Corrigir itens marcados' }).click()
    await page.getByRole('button', { name: 'Uso ou despesa: não entra em receita, estoque nem custo' }).click()
    await expect(page.getByLabel(/Quanto vem em 1 UN da nota/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    const previa = page.getByRole('region', { name: 'Confira o efeito antes de confirmar' })
    await expect(previa).toBeVisible({ timeout: 20_000 })
    await expect(previa.getByText(/\[TESTE\] Vinculo uso pano, fator 1, 1 un, .* → uso ou despesa/)).toBeVisible()
    await expect(previa.getByText(/Custo de \[TESTE\] Vinculo uso pano continua .*não sobrou outra nota.*confira o cadastro/)).toBeVisible()
    await expect(previa.getByRole('list', { name: 'Conta e livro-caixa' }).getByText(/conta em aberto \(R\$\s95,00\), nenhuma parcela paga/)).toBeVisible()
    await previa.getByRole('button', { name: 'Confirmar correção' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'passaram a uso ou despesa' })).toBeVisible({ timeout: 20_000 })
    await expect(secaoUso(page).getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })

    // Persistencia: o item sai do produto e aparece na lista de uso ou despesa.
    await page.reload()
    await abrirProduto(page, PANO_PRODUTO)
    await expect(page.getByLabel(CAIXA_PANO)).toHaveCount(0, { timeout: 20_000 })
    await abrirUsoDespesa(page, 'Pano multiuso rolao')
    await expect(page.getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })

    await abrirProduto(page, PANO_PRODUTO)
    await desfazerUltima(page, /uso ou despesa \(fora da receita, do estoque e do custo\) → \[TESTE\] Vinculo uso pano, fator 1/)
    await page.reload()
    await abrirProduto(page, PANO_PRODUTO)
    await expect(page.getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Conversão registrada: 1 \(simple\) · quantidade útil 1 un/)).toBeVisible()
  })

async function marcarComoUsoNoBanco(page: Page, perfil: Perfil) {
  const acesso = await entrarComo(page, perfil)
  return page.request.post(`${acesso.url}/rest/v1/rpc/correct_payable_purchase_items`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {
      p_request_id: null,
      p_mode: 'previa',
      p_items: [{ item_id: PANO_ID, product_id: null, conversion_factor: null }],
      p_undo_correction_id: null,
      p_expected_impact_hash: null,
    },
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
}

for (const [perfil, nome, loja] of [
  ['financeiroJc', 'Financeiro JC', 'JC'],
  ['vendasJa', 'Vendas JA', 'JA'],
  ['expedicaoJc', 'Expedicao JC', 'JC'],
] as const) {
  test(`${nome} e barrado de marcar item como uso ou despesa na Data API`,
    matriz(nome, loja, 'bloqueado', 'correct_payable_purchase_items com uso ou despesa (Data API)'),
    async ({ page }) => {
      const resposta = await marcarComoUsoNoBanco(page, perfil)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
    })
}
