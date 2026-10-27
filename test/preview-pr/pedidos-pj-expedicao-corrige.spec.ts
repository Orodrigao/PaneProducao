import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Fase 2 da Expedicao lancando Pedido PJ: quem lancou corrige e cancela o
// proprio pedido enquanto a conferencia nao comecou. O Administrador marca a
// permissao pela tela de usuarios; a Expedicao lanca dois pedidos de 3
// Baguetes para o Bistro, corrige o primeiro para 5 com outra entrega e
// cancela o segundo com motivo, sem ver valor. O Financeiro ve quem corrigiu,
// o preco da tabela (2,97) e o cancelamento com quem cancelou; ele, Vendas e
// a Expedicao sem a permissao sao recusados pelo banco. No fim o Financeiro
// cancela o pedido que sobrou e o Administrador desmarca a permissao.

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

// Fecha o navegador sem erro solto: um pedido da pagina ainda em voo na cerca
// de rede de entrar.ts falharia depois do fim do teste ("Request context
// disposed") e derrubaria o roteiro seguinte. A cerca ja cumpriu o papel dela
// no login; aqui so deixa de esperar o que estiver em voo.
async function fechar(contexto: BrowserContext): Promise<void> {
  for (const pagina of contexto.pages()) await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  await contexto.close()
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
    await fechar(contexto)
  }
}

async function semValorNaTela(page: Page, momento: string): Promise<void> {
  await expect(page.locator('body'), `${momento}: a Expedicao nao ve valor`).not.toContainText(/R\$|\d+,\d{2}\s*\/\s*(un|kg)/)
}

async function rpc(page: Page, acesso: AcessoAoBanco, nome: string, corpo: Record<string, unknown>) {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  return page.request.post(`${acesso.url}/rest/v1/rpc/${nome}`, { headers: cabecalhos, data: corpo, maxRedirects: 0 })
}

// Lanca pelo banco, como a tela da fase 1 faz: o lancamento pela tela ja e
// provado em pedidos-pj-expedicao-lanca.spec.ts.
async function lancar(page: Page, acesso: AcessoAoBanco, entrega: string): Promise<string> {
  const catalogo = await rpc(page, acesso, 'list_pj_launch_catalog', {})
  expect(catalogo.status(), await catalogo.text()).toBe(200)
  const corpo = await catalogo.json() as {
    customers: Array<{ id: string; name: string }>
    items: Array<{ customer_id: string; product_source: string; product_id: string; product_name: string
      pricing_unit: string; pack_size: number; pack_rule_size: number | null }>
  }
  const cliente = corpo.customers.find(row => row.name === CLIENTE)
  expect(cliente, 'o cliente do roteiro esta no catalogo').toBeTruthy()
  const item = corpo.items.find(row => row.customer_id === cliente!.id && row.product_name === PRODUTO)
  expect(item, 'a baguete esta na tabela do cliente').toMatchObject({ pricing_unit: 'un', pack_size: 1, pack_rule_size: null })
  const pedido = crypto.randomUUID()
  const resposta = await rpc(page, acesso, 'create_pj_order_by_expedition', {
    p_request_id: crypto.randomUUID(), p_order_group_id: pedido, p_customer_id: cliente!.id,
    p_delivery_date: entrega, p_obs: '',
    p_lines: [{ product_source: item!.product_source, product_id: item!.product_id, packs: 3, quantity: 3, unit: 'un' }],
  })
  expect(resposta.status(), await resposta.text()).toBe(200)
  return pedido
}

test('Expedicao JC corrige e cancela o Pedido PJ que lancou, antes da conferencia',
  matriz('Expedicao', 'JC', 'autora corrige e cancela; Financeiro, Vendas e Expedicao sem permissao bloqueados',
    'Pedidos PJ: correcao e cancelamento pela Expedicao'),
  async ({ browser }) => {
    test.setTimeout(300_000)
    const entrega = somarDias(hojeNaPadaria(), 41)
    const novaEntrega = somarDias(hojeNaPadaria(), 43)
    let sobra = ''
    let cancelado = ''
    // Pedido lancado e ainda ativo; o finally cancela o que sobrar.
    const pendentes: string[] = []

    // Rodada anterior interrompida pode ter deixado a permissao marcada.
    await marcarPermissao(browser, false)
    try {
      await marcarPermissao(browser, true)

      const comPermissao = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const expedicao = await comPermissao.newPage()
        const acesso = await entrarComo(expedicao, 'expedicaoJc')
        sobra = await lancar(expedicao, acesso, entrega)
        pendentes.push(sobra)
        cancelado = await lancar(expedicao, acesso, entrega)
        pendentes.push(cancelado)

        // Corrigir pela tela, partindo da ficha da jornada.
        await expedicao.goto(`/pedidos-pj?piloto=1&pedido=${sobra}`)
        const ficha = expedicao.getByRole('region', { name: `Ficha de ${CLIENTE}` })
        await expect(ficha.getByText(/^Você lançou pela Expedição · /)).toBeVisible()
        await ficha.getByRole('link', { name: 'Corrigir pedido' }).click()
        await expect(expedicao.getByRole('heading', { name: 'Corrigir pedido PJ' })).toBeVisible()
        await expect(expedicao.getByLabel('Cliente', { exact: true })).toBeDisabled()
        const unidades = expedicao.getByLabel(`Unidades de ${PRODUTO}`, { exact: true })
        await expect(unidades, 'a quantidade lancada volta ao formulario').toHaveValue('3')
        await unidades.fill('5')
        await expedicao.getByLabel('Entrega ou coleta', { exact: true }).fill(novaEntrega)
        await semValorNaTela(expedicao, 'formulario de correcao')
        await expedicao.getByRole('button', { name: 'Revisar pedido' }).click()
        await expect(expedicao.getByText(`${PRODUTO}: 5 unidades`)).toBeVisible()
        await semValorNaTela(expedicao, 'revisao da correcao')
        await expedicao.getByRole('button', { name: 'Confirmar correção' }).click()
        await expect(expedicao.getByText(`Pedido de ${CLIENTE} corrigido`)).toBeVisible()

        // Reler: a ficha mostra a correcao gravada.
        await expedicao.getByRole('link', { name: 'Ver o pedido' }).click()
        await expect(ficha.getByText(/^Você corrigiu pela Expedição · /)).toBeVisible()
        await expect(ficha.getByText('Pedido: 5 un')).toBeVisible()
        await semValorNaTela(expedicao, 'ficha corrigida')

        // Cancelar pela tela, com motivo.
        await expedicao.goto(`/pedidos-pj?piloto=1&pedido=${cancelado}`)
        await ficha.getByRole('button', { name: 'Cancelar pedido' }).click()
        const confirmar = ficha.getByRole('button', { name: 'Confirmar cancelamento' })
        await expect(confirmar, 'sem motivo o cancelamento nao sai').toBeDisabled()
        await expect(ficha.getByText('Informe o motivo do cancelamento, com pelo menos 3 letras.')).toBeVisible()
        await ficha.getByLabel('Motivo do cancelamento', { exact: true }).fill('Cliente desistiu (roteiro de teste)')
        await confirmar.click()
        await expect(expedicao.getByText('Pedido cancelado pela Expedição e retirado da jornada.')).toBeVisible()
        pendentes.splice(pendentes.indexOf(cancelado), 1)
        const jornada = await rpc(expedicao, acesso, 'read_pj_flow_pilot', {})
        expect(jornada.status(), await jornada.text()).toBe(200)
        const ids = (await jornada.json() as Array<{ id: string }>).map(row => row.id)
        expect(ids, 'o corrigido segue na jornada').toContain(sobra)
        expect(ids, 'o cancelado sai da jornada').not.toContain(cancelado)
      } finally {
        await fechar(comPermissao)
      }

      const contextoFinanceiro = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const financeiro = await contextoFinanceiro.newPage()
        const acesso = await entrarComo(financeiro, 'financeiroJc')
        const cabecalhos = await cabecalhosDaSessao(financeiro, acesso)
        const linhas = await financeiro.request.get(
          `${acesso.url}/rest/v1/orders?order_group_id=in.(${sobra},${cancelado})&select=order_group_id,quantity,unit_price,delivery_date,cancelled_at,cancelled_by,cancel_reason&order=order_group_id`,
          { headers: cabecalhos, maxRedirects: 0 })
        expect(linhas.status(), await linhas.text()).toBe(200)
        const gravado = await linhas.json() as Array<Record<string, unknown>>
        expect(gravado.find(row => row.order_group_id === sobra), 'a correcao gravou 5 pelo preco da tabela').toMatchObject({
          quantity: 5, unit_price: 2.97, delivery_date: novaEntrega, cancelled_at: null,
        })
        expect(gravado.find(row => row.order_group_id === cancelado), 'o cancelamento guarda quem cancelou e o motivo').toMatchObject({
          cancelled_by: EXPEDICAO, cancel_reason: 'Cliente desistiu (roteiro de teste)',
        })

        await financeiro.goto(`/pedidos-pj?piloto=1&pedido=${sobra}`)
        const ficha = financeiro.getByRole('region', { name: `Ficha de ${CLIENTE}` })
        await expect(ficha.getByText(`${EXPEDICAO} corrigiu pela Expedição`, { exact: false })).toBeVisible()
        await expect(ficha.getByRole('link', { name: 'Corrigir pedido' }), 'o Financeiro nao ganha o botao da Expedicao')
          .toHaveCount(0)

        const corrigir = await rpc(financeiro, acesso, 'replace_pj_order_by_expedition', {
          p_request_id: crypto.randomUUID(), p_order_group_id: sobra, p_delivery_date: novaEntrega, p_obs: '',
          p_lines: [{ product_source: 'bread', product_id: 'teste-baguete', packs: 1, quantity: 1, unit: 'un' }],
          p_expected_rows: [],
        })
        expect(corrigir.status(), 'o Financeiro nao usa a correcao da Expedicao').toBe(403)
      } finally {
        await fechar(contextoFinanceiro)
      }

      const contextoVendas = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const vendas = await contextoVendas.newPage()
        const acesso = await entrarComo(vendas, 'vendasJa')
        const ler = await rpc(vendas, acesso, 'read_pj_expedition_order', { p_order_group_id: sobra })
        expect(ler.status(), 'Vendas JA nao le o pedido da Expedicao').toBe(403)
      } finally {
        await fechar(contextoVendas)
      }

      // Permissao retirada: a autora perde os botoes e o banco recusa.
      await marcarPermissao(browser, false)
      const semPermissao = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const expedicao = await semPermissao.newPage()
        const acesso = await entrarComo(expedicao, 'expedicaoJc')
        await expedicao.goto(`/pedidos-pj?piloto=1&pedido=${sobra}`)
        const ficha = expedicao.getByRole('region', { name: `Ficha de ${CLIENTE}` })
        await expect(ficha.getByText(/^Você corrigiu pela Expedição · /)).toBeVisible()
        await expect(ficha.getByRole('link', { name: 'Corrigir pedido' })).toHaveCount(0)
        const cancelar = await rpc(expedicao, acesso, 'cancel_pj_order_by_expedition', {
          p_request_id: crypto.randomUUID(), p_order_group_id: sobra, p_reason: 'Sem permissao nao cancela',
        })
        expect(cancelar.status(), 'sem a permissao o banco recusa o cancelamento').toBe(403)
      } finally {
        await fechar(semPermissao)
      }
    } finally {
      // A limpeza dos pedidos roda mesmo se desmarcar a permissao falhar.
      try {
        await marcarPermissao(browser, false)
      } finally {
        if (pendentes.length > 0) await cancelarPendentes(browser, pendentes)
      }
    }
  })

// Pedido que o roteiro deixou ativo sai pelo contrato oficial do Financeiro.
// O que a Expedicao ja cancelou antes da falha volta como "ja estava cancelado".
// Tenta todos e so reprova no fim, para uma falha nao deixar os outros ativos.
async function cancelarPendentes(browser: Browser, pedidos: readonly string[]): Promise<void> {
  const falhas: string[] = []
  const limpeza = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const financeiro = await limpeza.newPage()
    const acesso = await entrarComo(financeiro, 'financeiroJc')
    for (const pedido of pedidos) {
      try {
        const resposta = await rpc(financeiro, acesso, 'cancel_pj_order_atomic', {
          p_request_id: crypto.randomUUID(), p_order_group_id: pedido, p_reason: 'Limpeza do roteiro de teste',
        })
        const texto = await resposta.text()
        if (resposta.status() !== 200 && !/ja estava cancelado/.test(texto)) falhas.push(`${pedido}: ${texto}`)
      } catch (erro) {
        falhas.push(`${pedido}: ${erro instanceof Error ? erro.message : String(erro)}`)
      }
    }
  } finally {
    await fechar(limpeza)
  }
  expect(falhas, 'todos os pedidos de teste foram cancelados').toEqual([])
}
