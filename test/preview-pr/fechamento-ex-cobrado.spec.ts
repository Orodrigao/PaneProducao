import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Tabela Buck, fase 3: o Fechamento EX mostra o que foi cobrado nas semanas ja
// cobradas, pela foto da confirmacao, e nao as recalcula pelo preco do dia.
//
// Dados do seed (supabase/seed.sql): a semana de 17/08 a 23/08/2026 foi
// cobrada por R$ 225,00 (romaneios 220,00, pao sem romaneio +10,00 e desconto
// -5,00). Depois da cobranca a EX conferiu 36 dos 40 brioches de 20/08 e saiu
// um romaneio de 22/08 com 10 baguetes. O financeiro ve a semana pela foto, o
// que mudou depois a parte, e nada dela no "a cobrar"; num periodo sem o
// domingo dela, a semana nao aparece e a tela diz onde ela esta. A Romaneio EX
// e a Vendas JA nao leem o Fechamento EX, nem pela tela nem pelo banco.
//
// Sem conta ficticia que leia o Fechamento EX sem o Contas a receber (como a
// vendas da EX): esse caso fica no pgTAP (fechamento_ex_mostra_cobrado).

const TELA = '/relatorios/romaneios'
const SEMANA = 'Semana de 17/08 a 23/08'
const RECUSA = 'Sem permissão para ver o Fechamento EX.'

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function fechamentoNoBanco(page: Page, acesso: AcessoAoBanco, de: string, ate: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/list_romaneio_ex_fechamento`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_de: de, p_ate: ate },
    maxRedirects: 0,
  })
}

async function escolherPeriodo(page: Page, de: string, ate: string) {
  await page.getByRole('button', { name: 'Custom', exact: true }).click()
  const datas = page.locator('input[type="date"]')
  await datas.nth(0).fill(de)
  await datas.nth(1).fill(ate)
}

test('Financeiro ve a semana cobrada pela foto, com os ajustes e o que mudou depois, fora do a cobrar',
  matriz('Financeiro', 'EX', 'permitido', 'Fechamento EX (Ja cobrado) e list_romaneio_ex_fechamento'),
  async ({ page }) => {
    test.setTimeout(150_000)
    const acesso = await entrarComo(page, 'financeiroJc')

    const banco = await fechamentoNoBanco(page, acesso, '2026-08-10', '2026-08-30')
    expect(banco.status(), await banco.text()).toBe(200)
    const corpo = await banco.json() as {
      mostra_cobrado: boolean
      a_cobrar: unknown[]
      cobrancas: Array<{ period_start: string; amount: number; com_foto: boolean; depois: unknown[] }>
    }
    expect(corpo.mostra_cobrado, 'o financeiro le o Contas a receber').toBe(true)
    expect(corpo.cobrancas.map(cobranca => [cobranca.period_start, Number(cobranca.amount), cobranca.com_foto, cobranca.depois.length]))
      .toEqual([['2026-08-17', 225, true, 2]])
    expect(corpo.a_cobrar, 'os romaneios da semana cobrada nao voltam para o a cobrar').toEqual([])

    await page.goto(TELA)
    await escolherPeriodo(page, '2026-08-10', '2026-08-30')
    const semana = page.getByRole('article', { name: SEMANA })
    await expect(semana, 'a semana cobrada aparece no periodo que contem o domingo dela').toBeVisible({ timeout: 60_000 })
    await expect(semana.getByTestId('fechamento-ex-cobrado')).toHaveText(`Cobrado ${reais(225)}`)

    await semana.locator('summary').click()
    const linhas = semana.getByRole('list', { name: 'Linhas cobradas na semana de 17/08 a 23/08' })
    await expect(linhas.getByRole('listitem')).toHaveCount(2)
    await expect(linhas.getByRole('listitem').filter({ hasText: '[TESTE] Brioche PJ' })).toContainText(reais(144))
    await expect(linhas.getByRole('listitem').filter({ hasText: '[TESTE] Ciabatta Buck' })).toContainText(reais(76))

    const ajustes = semana.getByRole('list', { name: 'Ajustes da semana de 17/08 a 23/08' })
    await expect(ajustes.getByRole('listitem').filter({ hasText: 'Saiu no carro sem romaneio (4 un de [TESTE] Baguete)' }))
      .toContainText(`+${reais(10)}`)
    await expect(ajustes.getByRole('listitem').filter({ hasText: 'Desconto combinado com a Buck' })).toContainText(reais(-5))

    const depois = semana.getByRole('note', { name: 'Mudou depois da cobrança da semana de 17/08 a 23/08' })
    await expect(depois.getByRole('listitem').filter({ hasText: '+10 un [TESTE] Baguete · entregue depois, não cobrado · 22/08' }))
      .toContainText(`+${reais(25)}`)
    await expect(depois.getByRole('listitem').filter({ hasText: '-4 un [TESTE] Brioche PJ · saiu do romaneio depois de cobrado · 20/08' }))
      .toContainText(reais(-4.8))
    await expect(depois).toContainText(`Diferença: +${reais(20.2)}.`)

    const aCobrar = page.getByRole('table', { name: 'A cobrar' })
    await expect(aCobrar).toContainText('Nada a cobrar no período fora das semanas já cobradas.')
    await expect(page.locator('.ps-kpi', { hasText: 'Já cobrado no período' })).toContainText(reais(225))

    // Periodo sem o domingo da semana: ela nao aparece e a tela diz onde esta.
    await escolherPeriodo(page, '2026-08-10', '2026-08-20')
    await expect(page.getByText('Os dias 17/08 a 20/08 já foram cobrados na semana de 17/08 a 23/08, que aparece no período que contém o domingo dela.'))
      .toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('article', { name: SEMANA })).toHaveCount(0)
    await expect(aCobrar).toContainText('Nada a cobrar no período fora das semanas já cobradas.')
  })

test('Romaneio EX nao le o Fechamento EX, nem pela tela nem pelo banco',
  matriz('Romaneio', 'EX', 'bloqueado', 'Fechamento EX (tela) e list_romaneio_ex_fechamento'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'romaneioEx')
    const banco = await fechamentoNoBanco(page, acesso, '2026-08-10', '2026-08-30')
    const corpo = await banco.text()
    expect(banco.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501', message: RECUSA })

    await page.goto(TELA)
    const origem = new URL(page.url()).origin
    // O guarda de rota manda para a primeira rota do perfil, o Romaneio.
    await expect(page).toHaveURL((endereco) => endereco.origin === origem && endereco.pathname === '/romaneio')
    await expect(page.getByTitle('Romaneio EX Teste')).toBeVisible()
    await expect(page.getByRole('heading', { name: '🚚 Fechamento EX' })).toHaveCount(0)
  })

test('Vendas JA nao le o Fechamento EX pelo banco',
  matriz('Vendas', 'JA', 'bloqueado', 'list_romaneio_ex_fechamento (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'vendasJa')
    const banco = await fechamentoNoBanco(page, acesso, '2026-08-10', '2026-08-30')
    const corpo = await banco.text()
    expect(banco.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501', message: RECUSA })
  })
