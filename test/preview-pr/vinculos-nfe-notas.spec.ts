import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Vinculos de NF-e, fase 4: corrigir itens de notas ja gravadas. O Financeiro
// Catalogo JC move o item ficticio do seed (maionese em balde gravada em
// "nota errada", fator 7) para "nota certa" com fator 3, confere a previa,
// descarta uma vez, confirma, rele e desfaz. Financeiro JC (sem o Catalogo),
// Vendas JA e Expedicao JC sao barrados na funcao com o token da propria sessao.
// O roteiro termina com o item de volta em "nota errada"; se uma rodada anterior
// parou no meio, ele desfaz primeiro.

const TELA = '/produtos/vinculos'
const ERRADO = '[TESTE] Vinculo nota errada'
const CERTO = '[TESTE] Vinculo nota certa'
const ITEM = '[TESTE] Maionese balde 3kg'
const ITEM_ID = '96600000-0000-4000-8000-0000000000d1'
const CERTO_ID = '96600000-0000-4000-8000-000000000012'
const CAIXA = `Corrigir item ${ITEM} da NF 966001`

async function abrirProduto(page: Page, nome: string) {
  await page.goto(TELA)
  await expect(page.getByRole('heading', { name: 'Vínculos por produto' })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Buscar produto do catálogo').fill(nome.replace('[TESTE] ', ''))
  await page.getByRole('button', { name: nome, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vínculos efetivamente salvos nas notas' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Correções de itens de notas' })).toBeVisible()
}

function historico(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Correções de itens de notas' }) })
}

async function desfazerUltima(page: Page) {
  const pendente = historico(page).locator('article', { hasText: 'Itens corrigidos' })
    .filter({ has: page.getByRole('button', { name: 'Desfazer' }) }).first()
  await pendente.getByRole('button', { name: 'Desfazer' }).click()
  // A previa repete as frases do historico: as conferencias ficam dentro dela.
  const previa = pendente.getByRole('region', { name: 'Confira o efeito de desfazer antes de confirmar' })
  await expect(previa).toBeVisible({ timeout: 20_000 })
  await expect(previa.getByText(/→ \[TESTE\] Vinculo nota errada, fator 7/)).toBeVisible()
  await previa.getByRole('button', { name: 'Confirmar desfazer' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Correção desfeita' })).toBeVisible({ timeout: 20_000 })
}

test('Financeiro Catalogo corrige o item de uma nota gravada, a correcao persiste e e desfeita',
  matriz('Financeiro Catalogo JC', 'JC', 'permitido', 'Corrigir item de nota (tela)'),
  async ({ page }) => {
    test.setTimeout(120_000)
    await entrarComo(page, 'financeiroCatalogoJc')
    await abrirProduto(page, ERRADO)

    // Rodada anterior parou depois de corrigir: volta ao estado do seed.
    if (await page.getByLabel(CAIXA).count() === 0) {
      await abrirProduto(page, CERTO)
      await desfazerUltima(page)
      await abrirProduto(page, ERRADO)
    }

    await expect(page.getByText('Marque os itens que entraram errados.')).toBeVisible()
    await page.getByLabel(CAIXA).check()
    await page.getByRole('button', { name: 'Corrigir itens marcados' }).click()
    await page.getByLabel('Ou buscar outro produto').fill('Vinculo nota certa')
    await page.getByRole('button', { name: `${CERTO} (kg)` }).click()
    await page.getByLabel(/Quanto vem em 1 UN da nota/).fill('3')

    // Entrada invalida bloqueia a previa com o motivo escrito.
    await page.getByLabel(/Quanto vem em 1 UN da nota/).fill('1.000')
    await expect(page.getByRole('button', { name: 'Ver prévia' })).toBeDisabled()
    await expect(page.getByText(/1\.000 é recusado/)).toBeVisible()
    await page.getByLabel(/Quanto vem em 1 UN da nota/).fill('3')

    // Descarte: voltar da previa nao grava nada.
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    // A previa repete as frases do historico: as conferencias ficam dentro dela.
    const previa = page.getByRole('region', { name: 'Confira o efeito antes de confirmar' })
    await expect(previa).toBeVisible({ timeout: 20_000 })
    await expect(previa.getByText(`${ITEM} (4 UN)`, { exact: false })).toBeVisible()
    await expect(previa.getByText(/→ \[TESTE\] Vinculo nota certa, fator 3, 12 kg/)).toBeVisible()
    await expect(previa.getByText(/Custo de \[TESTE\] Vinculo nota errada continua .*não sobrou outra nota/)).toBeVisible()
    await expect(previa.getByText(/Custo de \[TESTE\] Vinculo nota certa/)).toBeVisible()
    await expect(previa.getByText(/Contas, parcelas, pagamentos e o livro-caixa não mudam/)).toBeVisible()
    await previa.getByRole('button', { name: 'Voltar' }).click()
    await page.reload()
    await abrirProduto(page, ERRADO)
    await expect(page.getByLabel(CAIXA)).toBeVisible()

    await page.getByLabel(CAIXA).check()
    await page.getByRole('button', { name: 'Corrigir itens marcados' }).click()
    await page.getByLabel('Ou buscar outro produto').fill('Vinculo nota certa')
    await page.getByRole('button', { name: `${CERTO} (kg)` }).click()
    await page.getByLabel(/Quanto vem em 1 UN da nota/).fill('3')
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    await page.getByRole('region', { name: 'Confira o efeito antes de confirmar' })
      .getByRole('button', { name: 'Confirmar correção' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Correção gravada: 1 item(ns)' })).toBeVisible({ timeout: 20_000 })

    // Persistencia: o item sai de "errada" e aparece em "certa" com o fator novo.
    await page.reload()
    await abrirProduto(page, ERRADO)
    await expect(page.getByLabel(CAIXA)).toHaveCount(0)
    await expect(historico(page).getByText(/Itens corrigidos · por Financeiro Catalogo JC Teste/).first()).toBeVisible({ timeout: 20_000 })
    await abrirProduto(page, CERTO)
    await expect(page.getByLabel(CAIXA)).toBeVisible()
    await expect(page.getByText(/Conversão registrada: 3 \(simple\) · quantidade útil 12 kg/)).toBeVisible()

    await desfazerUltima(page)
    await page.reload()
    await abrirProduto(page, ERRADO)
    await expect(page.getByLabel(CAIXA)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Conversão registrada: 7 \(simple\) · quantidade útil 28 kg/)).toBeVisible()
    await expect(historico(page).getByText('Esta correção já foi desfeita.').first()).toBeVisible()
  })

async function corrigirNoBanco(page: Page, perfil: Perfil) {
  const acesso = await entrarComo(page, perfil)
  return page.request.post(`${acesso.url}/rest/v1/rpc/correct_payable_purchase_items`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {
      p_request_id: null,
      p_mode: 'previa',
      p_items: [{ item_id: ITEM_ID, product_id: CERTO_ID, conversion_factor: 3 }],
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
  test(`${nome} e barrado da correcao de itens de notas na Data API`,
    matriz(nome, loja, 'bloqueado', 'correct_payable_purchase_items (Data API)'),
    async ({ page }) => {
      const resposta = await corrigirNoBanco(page, perfil)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
    })
}
