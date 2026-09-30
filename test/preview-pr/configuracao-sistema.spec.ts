import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type Perfil } from './apoio/entrar'

// Configuracao do Sistema (imposto, taxas e margens): so o administrador ve e
// muda, e quem garante e o banco. Aqui o admin grava pela tela um valor com
// marca unica desta execucao, rele (tela e banco) e devolve o valor que
// estava antes. O Financeiro da JC, que ve dinheiro mas nao administra, e
// barrado na tela e nas duas funcoes do banco com o token da propria sessao;
// o mesmo pedido passa para o admin, para um 403 por outro motivo nao parecer
// bloqueio.

const TELA = '/admin/configuracao'
const TITULO = 'Configuração do Sistema'
const CAMPO_IMPOSTO = 'Imposto sobre a venda (vale para todos os canais)'
const PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// Salvar vazio nao grava nada (o banco so grava o que mudou), mas passa pela
// mesma trava de admin que um salvamento de verdade.
const PEDIDOS = {
  ler: { rpc: 'get_pricing_settings', corpo: { p_history_limit: 1 } },
  gravar: { rpc: 'save_pricing_settings', corpo: { p_changes: [] } },
} as const

type Pedido = keyof typeof PEDIDOS

async function chamarNoBanco(page: Page, perfil: Perfil, pedido: Pedido) {
  const acesso = await entrarComo(page, perfil)
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  const { rpc, corpo } = PEDIDOS[pedido]
  return page.request.post(`${acesso.url}/rest/v1/rpc/${rpc}`, {
    headers: cabecalhos,
    data: corpo,
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
}

/** Um percentual desta execucao, diferente do que o campo ja mostra. */
function marcaDaExecucao(atual: string): string {
  let centesimos = 100 + (Date.now() % 9800)
  let texto = PERCENTUAL.format(centesimos / 100)
  if (texto === atual) {
    centesimos += 1
    texto = PERCENTUAL.format(centesimos / 100)
  }
  return texto
}

async function salvar(page: Page) {
  await page.getByRole('button', { name: 'Salvar configuração' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Configuração salva: 1 valor mudou.' })).toBeVisible()
}

test('Administrador grava e rele o imposto na Configuracao do Sistema',
  matriz('Administrador', 'todas', 'grava e rele', 'Configuracao do Sistema (tela)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'admin')
    await page.goto(TELA)
    await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()

    const campo = page.getByLabel(CAMPO_IMPOSTO)
    await expect(campo).toBeEnabled()
    const antes = await campo.inputValue()
    const marca = marcaDaExecucao(antes)

    await campo.fill(marca)
    await salvar(page)
    await page.reload()
    await expect(page.getByLabel(CAMPO_IMPOSTO)).toHaveValue(marca)

    // A tela pode mostrar o rascunho; o banco diz o que ficou gravado.
    const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/get_pricing_settings`, {
      headers: await cabecalhosDaSessao(page, acesso),
      data: { p_history_limit: 1 },
      maxRedirects: 0,
    })
    expect(resposta.status(), await resposta.text()).toBe(200)
    const { current } = await resposta.json() as { current: { setting_key: string; value: number | null }[] }
    const imposto = current.find((item) => item.setting_key === 'imposto_venda')
    expect(imposto && imposto.value !== null ? PERCENTUAL.format(imposto.value) : '').toBe(marca)

    // Devolve o valor de antes, para a proxima execucao partir do mesmo lugar.
    await page.getByLabel(CAMPO_IMPOSTO).fill(antes)
    await salvar(page)
    await page.reload()
    await expect(page.getByLabel(CAMPO_IMPOSTO)).toHaveValue(antes)
  })

test('Administrador le a Configuracao do Sistema pela Data API',
  matriz('Administrador', 'todas', 'permitido', 'get_pricing_settings (Data API)'),
  async ({ page }) => {
    const resposta = await chamarNoBanco(page, 'admin', 'ler')
    expect(resposta.status(), await resposta.text()).toBe(200)
    const corpo = await resposta.json() as { current?: unknown; history?: unknown }
    expect(Array.isArray(corpo.current)).toBe(true)
    expect(Array.isArray(corpo.history)).toBe(true)
  })

test('Administrador passa pela trava de gravacao da Data API',
  matriz('Administrador', 'todas', 'permitido', 'save_pricing_settings (Data API)'),
  async ({ page }) => {
    const resposta = await chamarNoBanco(page, 'admin', 'gravar')
    expect(resposta.status(), await resposta.text()).toBe(200)
    expect(await resposta.json()).toMatchObject({ saved: 0 })
  })

test('Financeiro JC e barrado da Configuracao do Sistema na tela',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'Configuracao do Sistema (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'financeiroJc')
    const inicio = new URL(page.url()).pathname
    expect(inicio, 'o financeiro precisa cair numa tela propria depois do login').not.toBe(TELA)

    await page.goto(TELA)
    await expect(page).toHaveURL((endereco) => endereco.pathname === inicio)
    await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0)
    await expect(page.getByLabel(CAMPO_IMPOSTO)).toHaveCount(0)
  })

test('Financeiro JC e barrado da leitura da Configuracao do Sistema na Data API',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'get_pricing_settings (Data API)'),
  async ({ page }) => {
    const resposta = await chamarNoBanco(page, 'financeiroJc', 'ler')
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })

test('Financeiro JC e barrado da gravacao da Configuracao do Sistema na Data API',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'save_pricing_settings (Data API)'),
  async ({ page }) => {
    const resposta = await chamarNoBanco(page, 'financeiroJc', 'gravar')
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })
