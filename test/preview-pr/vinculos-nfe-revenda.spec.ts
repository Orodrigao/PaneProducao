import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Revenda sem cadastro, fase 3: corrigir nota gravada entre uso ou despesa,
// revenda sem cadastro e produto. O Financeiro Catalogo JC passa a margarina
// ficticia de uma conta PAGA de uso ou despesa para revenda sem cadastro,
// confere a previa (conta, aviso de categoria, memoria do fornecedor), descarta
// uma vez, confirma, rele e desfaz pelo historico do proprio item (a troca de
// tipo nao tem produto); depois passa o pano ficticio de um produto para
// revenda sem cadastro pela lista do produto, rele e desfaz. Financeiro JC (sem
// o Catalogo), Vendas JA e Expedicao JC sao barrados na funcao com o token da
// propria sessao. Usa os itens do seed da fase 5 e termina com eles como no
// seed, porque o roteiro de uso ou despesa roda depois deste com os mesmos
// itens; se uma rodada anterior parou no meio, desfaz primeiro. A margarina do
// seed tem a data da decisao e a memoria gravada junto, como em producao: a
// troca passa o tipo da memoria e o desfazer a volta, rodada apos rodada.

const TELA = '/produtos/vinculos'
const DESTINO = '[TESTE] Vinculo uso destino'
const MARGARINA = '[TESTE] Margarina caixa uso'
const CAIXA_MARGARINA = `Corrigir item ${MARGARINA} da NF 967001`
const PANO_PRODUTO = '[TESTE] Vinculo uso pano'
const PANO = '[TESTE] Pano multiuso rolao'
const CAIXA_PANO = `Corrigir item ${PANO} da NF 967002`
const MARGARINA_ID = '96700000-0000-4000-8000-0000000000d1'

async function abrirTela(page: Page) {
  await page.goto(TELA)
  await expect(page.getByRole('heading', { name: 'Vínculos por produto' })).toBeVisible({ timeout: 20_000 })
}

function secaoFora(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Itens fora do cadastro' }) })
}

function grupo(page: Page, nome: 'Uso ou despesa' | 'Revenda sem cadastro') {
  return secaoFora(page).getByRole('region', { name: nome, exact: true })
}

async function abrirFora(page: Page, filtro: string) {
  await abrirTela(page)
  await secaoFora(page).getByRole('button', { name: 'Ver itens fora do cadastro' }).click()
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

/** Desfaz a correção mais recente que ainda tem o botão, dentro de um histórico. */
async function desfazerNoHistorico(page: Page, historicoAberto: ReturnType<Page['locator']>, conferir: RegExp, memoria?: RegExp) {
  const pendente = historicoAberto.locator('article', { hasText: 'Itens corrigidos' })
    .filter({ has: page.getByRole('button', { name: 'Desfazer' }) }).first()
  await pendente.getByRole('button', { name: 'Desfazer' }).click()
  // A previa repete as frases do historico: as conferencias ficam dentro dela.
  const previa = pendente.getByRole('region', { name: 'Confira o efeito de desfazer antes de confirmar' })
  await expect(previa).toBeVisible({ timeout: 20_000 })
  await expect(previa.getByText(conferir).first()).toBeVisible()
  if (memoria) await expect(previa.getByRole('list', { name: 'Memória do fornecedor' }).getByText(memoria)).toBeVisible()
  await previa.getByRole('button', { name: 'Confirmar desfazer' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Correção desfeita' })).toBeVisible({ timeout: 20_000 })
}

function historicoDoProduto(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Correções de itens de notas' }) })
}

async function abrirHistoricoDoItem(page: Page, caixa: string, nome: string) {
  const artigo = secaoFora(page).locator('article', { has: page.getByLabel(caixa) })
  await artigo.getByRole('button', { name: `Histórico deste item (${nome})` }).click()
  const historicoAberto = artigo.getByRole('region', { name: `Correções do item ${nome}` })
  await expect(historicoAberto.getByText(/Itens corrigidos|Nenhuma correção/).first()).toBeVisible({ timeout: 20_000 })
  return historicoAberto
}

/** Volta a margarina a uso ou despesa se uma rodada anterior parou no meio. */
async function margarinaComoNoSeed(page: Page) {
  await abrirFora(page, 'Margarina caixa uso')
  await expect(secaoFora(page).getByRole('heading', { name: /Uso ou despesa \(\d+\)/ })).toBeVisible({ timeout: 20_000 })
  if (await grupo(page, 'Revenda sem cadastro').getByLabel(CAIXA_MARGARINA).count() > 0) {
    const historicoAberto = await abrirHistoricoDoItem(page, CAIXA_MARGARINA, MARGARINA)
    await desfazerNoHistorico(page, historicoAberto, /revenda sem cadastro \(sem produto.*\) → uso ou despesa/)
    await abrirFora(page, 'Margarina caixa uso')
  } else if (await secaoFora(page).getByLabel(CAIXA_MARGARINA).count() === 0) {
    // Parou depois de ir para o produto (por este roteiro ou pelo de uso ou despesa).
    await abrirProduto(page, DESTINO)
    await desfazerNoHistorico(page, historicoDoProduto(page), /\[TESTE\] Vinculo uso destino, fator .* → (uso ou despesa|revenda sem cadastro)/)
    await abrirFora(page, 'Margarina caixa uso')
  }
  await expect(grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
}

async function pedirPreviaDaTroca(page: Page) {
  await grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA).check()
  await secaoFora(page).getByRole('button', { name: 'Passar para revenda sem cadastro' }).click()
  const previa = secaoFora(page).getByRole('region', { name: 'Confira o efeito antes de confirmar' })
  await expect(previa).toBeVisible({ timeout: 20_000 })
  return previa
}

test('Financeiro Catalogo passa um item de conta paga de uso ou despesa para revenda sem cadastro, confere a previa, a troca persiste e e desfeita pelo item',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Trocar uso ou despesa por revenda sem cadastro (tela)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    await entrarComo(page, 'financeiroCatalogoJc')
    await margarinaComoNoSeed(page)
    await expect(grupo(page, 'Uso ou despesa').getByText('conta paga').first()).toBeVisible()

    // O botao diz para que tipo vai; sem item marcado, a troca fica desligada.
    await grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA).check()
    await expect(secaoFora(page).getByRole('button', { name: 'Passar para revenda sem cadastro' })).toBeEnabled()
    await grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA).uncheck()
    await expect(secaoFora(page).getByRole('button', { name: 'Trocar o tipo' })).toBeDisabled()

    // Previa: o item, a conta paga com o aviso de categoria, a memoria e o consumo.
    let previa = await pedirPreviaDaTroca(page)
    await expect(previa.getByText(/uso ou despesa \(fora da receita, do estoque e do custo\) → revenda sem cadastro \(sem produto/)).toBeVisible()
    const conta = previa.getByRole('list', { name: 'Conta e livro-caixa' })
    await expect(conta.getByText(/conta paga: 1 de 1 parcela\(s\) paga\(s\), R\$\s275,00 saíram do caixa/)).toBeVisible()
    await expect(conta.getByText(/Nada disso muda com esta correção\./)).toBeVisible()
    await expect(conta.getByText(/mas não em CMV de revenda/)).toBeVisible()
    await expect(conta.getByText(/a conta inteira está em custo de mercadoria/)).toHaveCount(0)
    await expect(previa.getByRole('list', { name: 'Memória do fornecedor' })
      .getByText(/a memória deste item passa de uso ou despesa para revenda sem cadastro; a próxima nota sugere revenda sem cadastro\./)).toBeVisible()
    await expect(previa.getByRole('list', { name: 'Consumo semanal' })).toBeVisible()
    await expect(previa.getByText(/Contas, parcelas, pagamentos, rateio e o livro-caixa não mudam/)).toBeVisible()

    // Descarte: voltar da previa nao grava nada.
    await previa.getByRole('button', { name: 'Voltar' }).click()
    await page.reload()
    await abrirFora(page, 'Margarina caixa uso')
    await expect(grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })

    previa = await pedirPreviaDaTroca(page)
    await previa.getByRole('button', { name: 'Confirmar troca para revenda sem cadastro' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Troca gravada: 1 item(ns) passaram a revenda sem cadastro.' })).toBeVisible({ timeout: 20_000 })
    await expect(grupo(page, 'Revenda sem cadastro').getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })

    // Persistencia: depois de recarregar, o item esta no grupo da revenda.
    await page.reload()
    await abrirFora(page, 'Margarina caixa uso')
    await expect(grupo(page, 'Revenda sem cadastro').getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
    await expect(grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA)).toHaveCount(0)

    // A troca nao tem produto: o historico e o desfazer ficam no proprio item.
    const historicoAberto = await abrirHistoricoDoItem(page, CAIXA_MARGARINA, MARGARINA)
    await expect(historicoAberto.getByText(/Itens corrigidos · por Financeiro Catalogo JC Teste/).first()).toBeVisible()
    await desfazerNoHistorico(page, historicoAberto, /revenda sem cadastro \(sem produto.*\) → uso ou despesa \(fora da receita, do estoque e do custo\)/,
      /a memória deste item volta a uso ou despesa, como era antes da correção; a próxima nota sugere uso ou despesa\./)
    await page.reload()
    await abrirFora(page, 'Margarina caixa uso')
    await expect(grupo(page, 'Uso ou despesa').getByLabel(CAIXA_MARGARINA)).toBeVisible({ timeout: 20_000 })
  })

test('Financeiro Catalogo passa um item ligado a produto para revenda sem cadastro, a correcao persiste e e desfeita',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Passar item de produto para revenda sem cadastro (tela)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    await entrarComo(page, 'financeiroCatalogoJc')
    await abrirProduto(page, PANO_PRODUTO)

    // Rodada anterior parou depois de corrigir: volta ao estado do seed.
    if (await page.getByLabel(CAIXA_PANO).count() === 0) {
      await desfazerNoHistorico(page, historicoDoProduto(page), /→ \[TESTE\] Vinculo uso pano, fator 1/)
      await abrirProduto(page, PANO_PRODUTO)
    }
    await expect(page.getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })

    await page.getByLabel(CAIXA_PANO).check()
    await page.getByRole('button', { name: 'Corrigir itens marcados' }).click()
    await page.getByRole('button', { name: 'Revenda sem cadastro: sem produto, fora do estoque e do CMV %' }).click()
    await expect(page.getByLabel(/Quanto vem em 1 UN da nota/)).toHaveCount(0)
    await expect(page.getByText(/O valor da compra continua o mesmo; só o custo do cadastro deixa de vir desta nota\./)).toBeVisible()
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    const previa = page.getByRole('region', { name: 'Confira o efeito antes de confirmar' })
    await expect(previa).toBeVisible({ timeout: 20_000 })
    await expect(previa.getByText(/\[TESTE\] Vinculo uso pano, fator 1, 1 un, .* → revenda sem cadastro \(sem produto/)).toBeVisible()
    await expect(previa.getByText(/Custo de \[TESTE\] Vinculo uso pano continua .*não sobrou outra nota.*confira o cadastro/)).toBeVisible()
    await expect(previa.getByRole('list', { name: 'Conta e livro-caixa' }).getByText(/conta em aberto \(R\$\s95,00\), nenhuma parcela paga/)).toBeVisible()
    await previa.getByRole('button', { name: 'Confirmar correção' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'passaram a revenda sem cadastro' })).toBeVisible({ timeout: 20_000 })

    // Persistencia: o item sai do produto e aparece na revenda sem cadastro.
    await page.reload()
    await abrirProduto(page, PANO_PRODUTO)
    await expect(page.getByLabel(CAIXA_PANO)).toHaveCount(0, { timeout: 20_000 })
    await abrirFora(page, 'Pano multiuso rolao')
    await expect(grupo(page, 'Revenda sem cadastro').getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })

    // Desfazer tira a revenda de fora do cadastro pela correção e volta o produto.
    await abrirProduto(page, PANO_PRODUTO)
    await desfazerNoHistorico(page, historicoDoProduto(page), /revenda sem cadastro \(sem produto.*\) → \[TESTE\] Vinculo uso pano, fator 1/)
    await page.reload()
    await abrirProduto(page, PANO_PRODUTO)
    await expect(page.getByLabel(CAIXA_PANO)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Conversão registrada: 1 \(simple\) · quantidade útil 1 un/)).toBeVisible()
  })

async function passarParaRevendaNoBanco(page: Page, perfil: Perfil) {
  const acesso = await entrarComo(page, perfil)
  return page.request.post(`${acesso.url}/rest/v1/rpc/correct_payable_purchase_items`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {
      p_request_id: null,
      p_mode: 'previa',
      p_items: [{ item_id: MARGARINA_ID, product_id: null, conversion_factor: null, non_catalog_kind: 'revenda' }],
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
  test(`${nome} e barrado de passar item para revenda sem cadastro na Data API`,
    matriz(nome, loja, 'bloqueado', 'correct_payable_purchase_items com revenda sem cadastro (Data API)'),
    async ({ page }) => {
      const resposta = await passarParaRevendaNoBanco(page, perfil)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
    })
}
