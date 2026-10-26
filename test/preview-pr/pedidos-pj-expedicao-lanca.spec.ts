import { expect, test, type Browser, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Fase 1 da Expedicao lancando Pedido PJ sem ver preco. Sem a permissao nova a
// Expedicao JC nao lanca (tela e banco recusam). O Administrador marca
// "Lancar Pedido PJ pela Expedicao" pela tela de usuarios, como sera feito em
// producao; a Expedicao lanca 3 Baguetes para o Bistro sem nenhum valor na
// tela; o Financeiro ve a origem do pedido e o preco da tabela (2,97). No fim
// o Financeiro cancela o pedido pelo contrato oficial e o Administrador
// desmarca a permissao.

const CLIENTE = '[TESTE] Bistro Cliente PJ'
const PRODUTO = '[TESTE] Baguete'
const EXPEDICAO = 'Expedicao JC Teste'
const PERMISSAO = /Lançar Pedido PJ pela Expedição/

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const resultado = new Date(Date.UTC(ano, mes - 1, dia))
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado.toISOString().slice(0, 10)
}

async function marcarPermissao(browser: Browser, marcada: boolean): Promise<void> {
  const contexto = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const admin = await contexto.newPage()
    await entrarComo(admin, 'admin')
    await admin.goto('/admin/usuarios')
    await admin.getByRole('button', { name: new RegExp(EXPEDICAO) }).click()
    const caixa = admin.getByRole('checkbox', { name: PERMISSAO })
    await expect(caixa).toBeVisible()
    if ((await caixa.isChecked()) !== marcada) await caixa.click()
    await admin.getByRole('button', { name: 'Salvar permissões' }).click()
    await expect(admin.getByText(`Permissões de ${EXPEDICAO} salvas com sucesso.`)).toBeVisible()
  } finally {
    await contexto.close()
  }
}

async function semValorNaTela(page: Page, momento: string): Promise<void> {
  await expect(page.locator('body'), `${momento}: a Expedicao nao ve valor`).not.toContainText(/R\$|\d+,\d{2}\s*\/\s*(un|kg)/)
}

async function lancamentoRecusadoNoBanco(page: Page, acesso: AcessoAoBanco): Promise<void> {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/list_pj_launch_catalog`, {
    headers: cabecalhos, data: {}, maxRedirects: 0,
  })
  expect(resposta.status(), 'sem a permissao o banco recusa o catalogo').toBe(403)
}

test('Expedicao JC lanca Pedido PJ sem ver preco depois da permissao marcada pela tela',
  matriz('Expedicao', 'JC', 'bloqueado sem permissao; permitido com permissao', 'Pedidos PJ: lancamento pela Expedicao sem preco'),
  async ({ browser }) => {
    test.setTimeout(240_000)
    const entrega = somarDias(hojeNaPadaria(), 40)

    // Rodada anterior interrompida pode ter deixado a permissao marcada.
    await marcarPermissao(browser, false)

    const semPermissao = await browser.newContext({ serviceWorkers: 'block' })
    try {
      const expedicao = await semPermissao.newPage()
      const acesso = await entrarComo(expedicao, 'expedicaoJc')
      await expedicao.goto('/pedidos-pj?lancar=1')
      await expect(expedicao.getByText('Seu acesso não permite lançar Pedido PJ. Peça ao administrador.')).toBeVisible()
      await lancamentoRecusadoNoBanco(expedicao, acesso)
    } finally {
      await semPermissao.close()
    }

    let pedido = ''
    try {
      await marcarPermissao(browser, true)

      const comPermissao = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const expedicao = await comPermissao.newPage()
        await entrarComo(expedicao, 'expedicaoJc')
        await expedicao.goto('/pedidos-pj')
        await expedicao.getByRole('link', { name: 'Novo pedido' }).click()
        await expect(expedicao.getByRole('heading', { name: 'Novo pedido PJ' })).toBeVisible()
        await expect(expedicao.getByText('Escolha o cliente.')).toBeVisible()

        await expedicao.getByLabel('Cliente', { exact: true }).selectOption({ label: CLIENTE })
        await expedicao.getByLabel('Entrega ou coleta', { exact: true }).fill(entrega)
        await expedicao.getByLabel('Procurar produto da tabela do cliente', { exact: true }).fill('Baguete')
        await expedicao.locator('div', { hasText: PRODUTO }).getByRole('button', { name: 'Adicionar' }).first().click()
        await expedicao.getByLabel(`Unidades de ${PRODUTO}`, { exact: true }).fill('2,5')
        await expect(expedicao.getByText('Informe um número inteiro maior que zero.')).toBeVisible()
        await expect(expedicao.getByRole('button', { name: 'Revisar pedido' })).toBeDisabled()
        await expedicao.getByLabel(`Unidades de ${PRODUTO}`, { exact: true }).fill('3')
        await expect(expedicao.getByText('= 3 unidades')).toBeVisible()
        await semValorNaTela(expedicao, 'formulario')

        await expedicao.getByRole('button', { name: 'Revisar pedido' }).click()
        await expect(expedicao.getByText(`${PRODUTO}: 3 unidades`)).toBeVisible()
        await semValorNaTela(expedicao, 'revisao')
        await expedicao.getByRole('button', { name: 'Confirmar lançamento' }).click()
        await expect(expedicao.getByText(`Pedido lançado para ${CLIENTE}`)).toBeVisible()

        const link = expedicao.getByRole('link', { name: 'Ver o pedido' })
        pedido = new URL(await link.getAttribute('href') ?? '', 'https://x.invalid').searchParams.get('pedido') ?? ''
        expect(pedido, 'o link leva ao pedido criado').toMatch(/^[0-9a-f-]{36}$/)
        await link.click()
        await expect(expedicao.getByRole('region', { name: `Ficha de ${CLIENTE}` }).getByText('Lançado por você')).toBeVisible()
        await semValorNaTela(expedicao, 'ficha do pedido')
      } finally {
        await comPermissao.close()
      }

      const contextoFinanceiro = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const financeiro = await contextoFinanceiro.newPage()
        const acesso = await entrarComo(financeiro, 'financeiroJc')
        const cabecalhos = await cabecalhosDaSessao(financeiro, acesso)
        const linhas = await financeiro.request.get(
          `${acesso.url}/rest/v1/orders?order_group_id=eq.${pedido}&select=product_name,quantity,unit_price,delivery_date,pj_client`,
          { headers: cabecalhos, maxRedirects: 0 })
        expect(linhas.status(), await linhas.text()).toBe(200)
        expect(await linhas.json(), 'o banco gravou o preco da tabela do cliente').toEqual([{
          product_name: PRODUTO, quantity: 3, unit_price: 2.97, delivery_date: entrega, pj_client: CLIENTE,
        }])

        await financeiro.goto(`/pedidos-pj?piloto=1&pedido=${pedido}`)
        await expect(financeiro.getByRole('region', { name: `Ficha de ${CLIENTE}` })
          .getByText(`Lançado pela Expedição · ${EXPEDICAO}`)).toBeVisible()

        const cancelar = await financeiro.request.post(`${acesso.url}/rest/v1/rpc/cancel_pj_order_atomic`, {
          headers: cabecalhos,
          data: { p_request_id: crypto.randomUUID(), p_order_group_id: pedido, p_reason: 'Limpeza do roteiro de teste' },
          maxRedirects: 0,
        })
        expect(cancelar.status(), await cancelar.text()).toBe(200)
        pedido = ''
      } finally {
        await contextoFinanceiro.close()
      }
    } finally {
      await marcarPermissao(browser, false)
    }
    expect(pedido, 'o pedido de teste foi cancelado').toBe('')
  })
