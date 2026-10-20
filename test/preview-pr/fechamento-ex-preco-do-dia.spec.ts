import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 15/10/2026 a Marselle viu o Fechamento EX de setembro com o preco novo do
// Italiano: a conta usava o preco de hoje para qualquer periodo. Desde a fase 1
// cada romaneio paga o preco do seu dia; desde a fase 2 o preco da Buck so
// muda pelo botao "Trocar preco", com data e motivo.
//
// Dados do seed: o [TESTE] Brioche PJ sai para a EX em "hoje - 5" e
// "hoje - 3", a 1,20 na Tabela Buck. O roteiro troca o preco pela tela a
// partir de "hoje - 4", confere que so o romaneio de "hoje - 3" muda, na conta
// do banco e no Fechamento EX, e devolve o preco pela mesma funcao da tela.

const BRIOCHE = 'teste-brioche-pj'
const NOME_BRIOCHE = '[TESTE] Brioche PJ'
const RECUSA_SEM_DATA = 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.'

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const resultado = new Date(Date.UTC(ano, mes - 1, dia))
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado.toISOString().slice(0, 10)
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

type LinhaDaConta = { product_id: string; preco_unitario: number | null; quantidade: number }

async function contaDoPeriodo(page: Page, acesso: AcessoAoBanco, de: string, ate: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/list_romaneio_ex_billing`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_de: de, p_ate: ate },
    maxRedirects: 0,
  })
}

async function linhaDoBriocheNaBuck(page: Page, acesso: AcessoAoBanco) {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  const tabela = await page.request.get(`${acesso.url}/rest/v1/price_tiers?name=eq.BUCK&active=eq.true&select=id`, {
    headers: cabecalhos, maxRedirects: 0,
  })
  expect(tabela.status(), await tabela.text()).toBe(200)
  const [{ id: tierId }] = await tabela.json() as Array<{ id: string }>
  const linha = await page.request.get(
    `${acesso.url}/rest/v1/price_tier_items?tier_id=eq.${tierId}&product_id=eq.${BRIOCHE}&active=eq.true&select=id,unit_price`,
    { headers: cabecalhos, maxRedirects: 0 },
  )
  expect(linha.status(), await linha.text()).toBe(200)
  const linhas = await linha.json() as Array<{ id: string; unit_price: number }>
  expect(linhas, 'o seed tem uma linha do brioche na Tabela Buck').toHaveLength(1)
  return { id: linhas[0].id, preco: Number(linhas[0].unit_price) }
}

async function trocarPeloBanco(page: Page, acesso: AcessoAoBanco, id: string, preco: number, valeAPartir: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/trocar_preco_buck`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {
      p_item_id: id, p_preco: preco, p_unidade: 'un', p_vale_a_partir: valeAPartir,
      p_motivo: 'correcao_digitacao', p_detalhe: 'roteiro do preview devolve o preco',
    },
    maxRedirects: 0,
  })
}

test('Financeiro troca o preco com data pelo botao e o Fechamento EX cobra cada romaneio pelo preco do seu dia',
  matriz('Financeiro', 'EX', 'permitido', 'Tabela Buck (Trocar preco), trocar_preco_buck e Fechamento EX'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'financeiroJc')
    const hoje = hojeNaPadaria()
    const de = somarDias(hoje, -6)
    const ate = somarDias(hoje, -1)
    const valeAPartir = somarDias(hoje, -4)

    const linha = await linhaDoBriocheNaBuck(page, acesso)
    const antes = await contaDoPeriodo(page, acesso, de, ate)
    expect(antes.status(), await antes.text()).toBe(200)
    const briocheAntes = (await antes.json() as LinhaDaConta[]).filter(item => item.product_id === BRIOCHE)
    expect(briocheAntes.map(item => Number(item.preco_unitario)), 'o brioche dos ultimos dias sai pelo preco da tabela').toEqual([linha.preco])

    // O caminho antigo da tela (gravar direto na linha) fica fechado.
    const direto = await page.request.patch(`${acesso.url}/rest/v1/price_tier_items?id=eq.${linha.id}`, {
      headers: { ...(await cabecalhosDaSessao(page, acesso)), Prefer: 'return=representation' },
      data: { unit_price: linha.preco + 1 },
      maxRedirects: 0,
    })
    const corpoDireto = await direto.text()
    expect(direto.status(), corpoDireto).toBe(400)
    expect(JSON.parse(corpoDireto)).toMatchObject({ code: '22023', message: RECUSA_SEM_DATA })

    const precoNovo = Math.round((linha.preco + 0.15) * 100) / 100
    // A devolucao do preco cobre tambem a troca: se ela gravar e uma
    // conferencia depois falhar, o preco volta mesmo assim.
    try {
      await page.goto('/tabelas-preco')
      await page.getByText('BUCK', { exact: true }).first().click({ timeout: 60_000 })
      const linhaDaTabela = page.locator('tr', { hasText: NOME_BRIOCHE })
      await expect(linhaDaTabela.first()).toBeVisible({ timeout: 30_000 })
      await expect(linhaDaTabela.first().locator('input[type="number"][step="0.01"]'), 'na Buck o preco nao se digita na linha').toHaveCount(0)
      await linhaDaTabela.first().getByRole('button', { name: 'Trocar preço', exact: true }).click()

      const cartao = page.getByRole('region', { name: `Trocar preço de ${NOME_BRIOCHE}` })
      await expect(cartao).toBeVisible()
      await cartao.getByLabel('Preço novo (R$) *').fill(precoNovo.toFixed(2).replace('.', ','))
      await cartao.getByLabel('Vale a partir de *').fill(valeAPartir)
      await cartao.getByLabel('Reajuste combinado com a Buck').check()
      await expect(cartao.getByText('O que muda na cobrança da Buck'), 'a previa mostra o efeito em R$ antes de gravar').toBeVisible({ timeout: 30_000 })
      await cartao.getByRole('button', { name: 'Trocar preço', exact: true }).click()
      await expect(cartao, 'gravou e fechou').toBeHidden({ timeout: 30_000 })
      await expect(linhaDaTabela.first()).toContainText(reais(precoNovo))
      await expect(linhaDaTabela.first()).toContainText(`desde ${dataBR(valeAPartir)}`)

      // Recarregar mostra o que ficou gravado, com o historico.
      await page.reload()
      await page.getByText('BUCK', { exact: true }).first().click({ timeout: 60_000 })
      await linhaDaTabela.first().getByRole('button', { name: 'Histórico', exact: true }).click()
      const historicoNaTela = page.getByRole('list', { name: 'Histórico de preço' })
      await expect(historicoNaTela).toContainText(`A partir de ${dataBR(valeAPartir)}`)
      await expect(historicoNaTela).toContainText('Reajuste combinado com a Buck')

      const historico = await page.request.get(
        `${acesso.url}/rest/v1/buck_price_history?price_tier_item_id=eq.${linha.id}&order=seq.desc&limit=1&select=event,origin,unit_price,valid_from,reason`,
        { headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0 },
      )
      expect(historico.status(), await historico.text()).toBe(200)
      expect(await historico.json(), 'a troca ficou no historico com a data e o motivo escolhidos').toEqual([
        { event: 'troca_de_preco', origin: 'troca_com_data', unit_price: precoNovo, valid_from: valeAPartir, reason: 'Reajuste combinado com a Buck' },
      ])

      const depois = await contaDoPeriodo(page, acesso, de, ate)
      expect(depois.status(), await depois.text()).toBe(200)
      const briocheDepois = (await depois.json() as LinhaDaConta[]).filter(item => item.product_id === BRIOCHE)
      expect(briocheDepois.map(item => Number(item.preco_unitario)).sort(),
        'hoje - 5 continua no preco antigo; hoje - 3 ja paga o novo').toEqual([linha.preco, precoNovo].sort())

      await page.goto('/relatorios/romaneios')
      const tabela = page.locator('.ps-table')
      const linhasDaTela = tabela.locator('tbody tr', { hasText: NOME_BRIOCHE })
      await expect(linhasDaTela.first()).toBeVisible({ timeout: 60_000 })
      await expect(linhasDaTela, 'o brioche aparece numa linha por preco').toHaveCount(2)
      await expect(tabela).toContainText(`${reais(linha.preco)}/un`)
      await expect(tabela).toContainText(`${reais(precoNovo)}/un`)
      await expect(page.getByText('com o preço do dia de cada romaneio')).toBeVisible()
    } finally {
      const devolvido = await trocarPeloBanco(page, acesso, linha.id, linha.preco, valeAPartir)
      expect([200, 400], await devolvido.text()).toContain(devolvido.status())
    }
    const conferido = await linhaDoBriocheNaBuck(page, acesso)
    expect(conferido.preco, 'o preco do brioche voltou').toBe(linha.preco)
  })

for (const perfil of [
  { nome: 'romaneioEx' as const, rotulo: 'Romaneio', loja: 'EX', motivo: 've o romaneio, mas nao o preco' },
  { nome: 'vendasJa' as const, rotulo: 'Vendas', loja: 'JA', motivo: 'sem acesso a relatorio de preco' },
]) {
  test(`${perfil.rotulo} ${perfil.loja} e barrado no Fechamento EX e na troca de preco (${perfil.motivo})`,
    matriz(perfil.rotulo, perfil.loja, 'bloqueado', 'list_romaneio_ex_billing, trocar_preco_buck, previa_troca_preco_buck e buck_price_history (Data API)'),
    async ({ page }) => {
      const acesso = await entrarComo(page, perfil.nome)
      const hoje = hojeNaPadaria()
      const resposta = await contaDoPeriodo(page, acesso, somarDias(hoje, -6), hoje)
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })

      const historico = await page.request.get(`${acesso.url}/rest/v1/buck_price_history?select=seq&limit=1`, {
        headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0,
      })
      expect(historico.status(), await historico.text()).toBe(200)
      expect(await historico.json(), 'o historico com autor e motivo fica fechado').toEqual([])

      // Sem enxergar a linha, o perfil tenta pelo identificador que nao conhece:
      // a funcao barra pela permissao antes de procurar a linha.
      const qualquerLinha = '00000000-0000-4000-8000-000000000000'
      const troca = await trocarPeloBanco(page, acesso, qualquerLinha, 9.99, hoje)
      const corpoTroca = await troca.text()
      expect(troca.status(), corpoTroca).toBe(403)
      expect(JSON.parse(corpoTroca)).toMatchObject({ code: '42501', message: 'Sem permissão para trocar preço da Tabela Buck.' })

      const previa = await page.request.post(`${acesso.url}/rest/v1/rpc/previa_troca_preco_buck`, {
        headers: await cabecalhosDaSessao(page, acesso),
        data: { p_item_id: qualquerLinha },
        maxRedirects: 0,
      })
      const corpoPrevia = await previa.text()
      expect(previa.status(), corpoPrevia).toBe(403)
      expect(JSON.parse(corpoPrevia)).toMatchObject({ code: '42501' })
    })
}
