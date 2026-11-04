import { expect, test, type Locator, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Formacao de preco, passos 0c e 0d: o indicador de mao de obra soma quilos de
// massa crua pela ficha tecnica, e o peso medio do cadastro de paes saiu.
//
// O seed (supabase/seed.sql, bloco dos indicadores) produz 62 unidades em
// setembro e 95 em outubro de 2026 de um pao ficticio ligado a um produto com
// ficha. O peso medio antigo desse pao e 500 g; a ficha nasce com 600 g de
// massa crua. Aqui o admin troca a massa da ficha pelo banco, do mesmo jeito
// que a tela da ficha grava, recarrega a Configuracao e confere que os quilos
// seguem a ficha. No fim a ficha volta ao valor do seed.

const TELA = '/admin/configuracao'
const PRODUTO_DA_FICHA = '96400000-0000-4000-8000-0000000007a1'
const QUADRO = 'Números recentes do Financeiro'
const ESPERA_DO_BANCO = 20_000
const QUILOS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

type Rendimento = { dough_weight_kg: number; finished_weight_kg: number; yield_units: number }
const DO_SEED: Rendimento = { dough_weight_kg: 1.2, finished_weight_kg: 1.0, yield_units: 2 }

async function gravarFicha(page: Page, acesso: AcessoAoBanco, rendimento: Rendimento) {
  const resposta = await page.request.patch(
    `${acesso.url}/rest/v1/product_recipe_yields?product_id=eq.${PRODUTO_DA_FICHA}&product_variant_id=is.null`,
    {
      headers: { ...await cabecalhosDaSessao(page, acesso), Prefer: 'return=representation' },
      data: { ...rendimento, basis: 'dough', updated_at: new Date().toISOString() },
      maxRedirects: 0,
    },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  expect(await resposta.json(), 'a linha da ficha ficticia existe no banco desta PR').toHaveLength(1)
}

async function indicadoresNoBanco(page: Page, acesso: AcessoAoBanco) {
  const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/get_pricing_financial_indicators`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: {},
    maxRedirects: 0,
  })
  expect(resposta.status(), await resposta.text()).toBe(200)
  return await resposta.json() as { months: { month: string; kilograms_with_known_weight: number }[] }
}

// A linha da Media tambem cita os meses no cabecalho: a linha do mes se acha
// pelo cabecalho exato.
function linhaDoMes(quadro: Locator, mes: string): Locator {
  return quadro.getByRole('row').filter({ has: quadro.page().getByRole('rowheader', { name: mes, exact: true }) })
}

async function conferirQuilos(page: Page, setembro: number, outubro: number) {
  const quadro = page.getByRole('region', { name: QUADRO })
  await expect(quadro).toBeVisible({ timeout: ESPERA_DO_BANCO })
  await expect(quadro.getByRole('columnheader', { name: 'Quilos de massa crua' })).toBeVisible()
  await expect(linhaDoMes(quadro, 'setembro de 2026')).toContainText(`${QUILOS.format(setembro)} kg`)
  await expect(linhaDoMes(quadro, 'outubro de 2026')).toContainText(`${QUILOS.format(outubro)} kg`)
}

test('Administrador ve na Configuracao os quilos de massa crua lidos da ficha tecnica',
  matriz('Administrador', 'todas', 'permitido', 'Numeros recentes do Financeiro (tela e banco)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'admin')
    try {
      // Ficha com 600 g de massa crua (500 g assado): 62 x 0,6 = 37,2 kg em
      // setembro e 95 x 0,6 = 57 kg em outubro. Com o peso medio antigo
      // (500 g) seriam 31 kg e 47,5 kg; com o assado, os mesmos 31 e 47,5.
      await gravarFicha(page, acesso, DO_SEED)
      await page.goto(TELA)
      await expect(page.getByRole('heading', { name: 'Configuração do Sistema' })).toBeVisible({ timeout: ESPERA_DO_BANCO })
      await conferirQuilos(page, 37.2, 57)

      // A ficha muda para 400 g de massa por unidade; o quadro acompanha.
      await gravarFicha(page, acesso, { dough_weight_kg: 0.8, finished_weight_kg: 0.7, yield_units: 2 })
      await page.reload()
      await conferirQuilos(page, 24.8, 38)

      // A tela mostra o que o banco calcula.
      const banco = await indicadoresNoBanco(page, acesso)
      const quilos = Object.fromEntries(banco.months.map((mes) => [mes.month, Number(mes.kilograms_with_known_weight)]))
      expect(quilos['2026-09']).toBeCloseTo(24.8, 6)
      expect(quilos['2026-10']).toBeCloseTo(38, 6)
    } finally {
      await gravarFicha(page, acesso, DO_SEED)
    }
  })

// Salario dos donos (decisao de 04/11/2026, "Fixo de R$ 20 mil"): o admin grava
// pela tela, o banco guarda em reais e o quadro soma nas despesas fixas.
const CAMPO_SALARIO = 'Salário dos donos por mês (vale para todos os canais)'
const REAIS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// O mesmo formato do quadro (formatIndicatorCurrency), com o espaço que o Intl põe depois do R$.
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

async function salarioNoBanco(page: Page, acesso: AcessoAoBanco): Promise<number | null> {
  const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/get_pricing_settings`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_history_limit: 1 },
    maxRedirects: 0,
  })
  expect(resposta.status(), await resposta.text()).toBe(200)
  const { current } = await resposta.json() as { current: { setting_key: string; value: number | null }[] }
  const salario = current.find((item) => item.setting_key === 'retirada_donos_mensal')
  return salario && salario.value !== null ? Number(salario.value) : null
}

async function salvarSalario(page: Page, texto: string) {
  await page.getByLabel(CAMPO_SALARIO).fill(texto)
  await page.getByRole('button', { name: 'Salvar configuração' }).click()
  const aviso = page.getByRole('main').getByRole('status').filter({ hasText: 'Configuração salva' })
  await expect(aviso).toHaveText('Configuração salva: 1 valor mudou.', { timeout: ESPERA_DO_BANCO })
}

test('Administrador grava o salario dos donos e o quadro soma nas despesas fixas',
  matriz('Administrador', 'todas', 'grava e rele', 'Salario dos donos (tela, banco e quadro)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'admin')
    const antes = await salarioNoBanco(page, acesso)
    // Um valor desta execucao, diferente do vigente.
    const marca = antes === 20000 ? 21000 : 20000
    await page.goto(TELA)
    await expect(page.getByLabel(CAMPO_SALARIO)).toBeEnabled({ timeout: ESPERA_DO_BANCO })
    let devolvido = false
    try {
      await salvarSalario(page, REAIS.format(marca).replace(',00', ''))
      // O quadro relê sozinho depois de salvar, sem recarregar a página.
      const quadro = page.getByRole('region', { name: QUADRO })
      await expect(linhaDoMes(quadro, 'setembro de 2026'))
        .toContainText(`inclui ${MOEDA.format(marca)} de salário dos donos`, { timeout: ESPERA_DO_BANCO })
      await page.reload()
      await expect(page.getByLabel(CAMPO_SALARIO)).toHaveValue(REAIS.format(marca), { timeout: ESPERA_DO_BANCO })
      expect(await salarioNoBanco(page, acesso)).toBe(marca)
      await expect(linhaDoMes(quadro, 'setembro de 2026'))
        .toContainText(`inclui ${MOEDA.format(marca)} de salário dos donos`, { timeout: ESPERA_DO_BANCO })

      // Texto que pode ser R$ 20,50 ou R$ 20.500 e recusado na tela, sem gravar.
      await page.getByLabel(CAMPO_SALARIO).fill('20.5')
      await expect(page.getByText('Digite o valor em reais, como 20.000 ou 20.000,00.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Salvar configuração' })).toBeDisabled()
      expect(await salarioNoBanco(page, acesso)).toBe(marca)

      // Devolve o que estava antes, pela tela.
      await salvarSalario(page, antes === null ? '' : REAIS.format(antes))
      devolvido = true
      expect(await salarioNoBanco(page, acesso)).toBe(antes)
    } finally {
      if (!devolvido) {
        try {
          await page.request.post(`${acesso.url}/rest/v1/rpc/save_pricing_settings`, {
            headers: await cabecalhosDaSessao(page, acesso),
            data: { p_changes: [{ setting_key: 'retirada_donos_mensal', value: antes, previous_value: marca }] },
            maxRedirects: 0,
          })
        } catch {
          // O teste ja falhou; a falha original e a que precisa aparecer.
        }
      }
    }
  })

test('Financeiro JC e barrado dos indicadores de preco na Data API',
  matriz('Financeiro JC', 'JC', 'bloqueado', 'get_pricing_financial_indicators (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'financeiroJc')
    const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/get_pricing_financial_indicators`, {
      headers: await cabecalhosDaSessao(page, acesso),
      data: {},
      maxRedirects: 0,
    })
    const corpo = await resposta.text()
    expect(resposta.status(), corpo).toBe(403)
    expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
  })

test('Administrador nao ve mais o peso medio do cadastro de paes em Produtos',
  matriz('Administrador', 'todas', 'removido', 'Produtos > Fabricacao propria (tela)'),
  async ({ page }) => {
    await entrarComo(page, 'admin')
    await page.goto('/produtos')
    const aba = page.getByRole('tab', { name: /Fabricação própria/ })
    await aba.click()
    await expect(aba).toHaveAttribute('aria-selected', 'true')
    // A lista carregou (o seed tem produtos de fabricacao propria ativos)...
    await expect(page.getByText('[TESTE] Indicadores pão pesado').first()).toBeVisible({ timeout: ESPERA_DO_BANCO })
    // ...e o quadro antigo, que aparecia para paes com peso medio como o do
    // seed (500 g), nao existe mais.
    await expect(page.getByText('Peso médio para pedido PJ por peso')).toHaveCount(0)
  })
