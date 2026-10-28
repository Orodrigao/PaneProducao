import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Decisao do Rodrigo em 28/10/2026, com a Elis afastada: o Administrador ativo
// passa na jornada PJ sem concessao marcada, como ja passa no Contas a
// receber. O admin ficticio do seed nasce com todas as permissoes, entao o
// roteiro desmarca pela tela de usuarios as quatro que a jornada pedia (Pedidos
// PJ, Contas a receber, Lancar cobranca e Revisar e liberar) e confere: a ficha
// da jornada abre com a revisao financeira, o pedido da jornada e lido direto,
// a aba Pendencias da lista antiga conta em vez de mostrar o traco, e conferir
// continua recusado (e da Expedicao JC). Financeiro sem Contas a receber e
// Vendas seguem bloqueados. No fim as quatro voltam marcadas.

const ADMIN = 'Rodrigo Teste'
const PEDIDO_DA_JORNADA = '96000000-0000-4000-8000-000000000201'
const CLIENTE_DA_JORNADA = '[TESTE] Piloto PJ - prazo 7 dias'
// Ancoradas no rotulo: o nome da caixa e o rotulo seguido da descricao.
const CONCESSOES = [
  /^Pedidos PJ/,
  /^Contas a receber/,
  /^Lançar cobrança/,
  /^Revisar e liberar pedido PJ/,
]

// Fecha o navegador sem erro solto de pedido ainda em voo na cerca de rede.
async function fechar(contexto: BrowserContext): Promise<void> {
  for (const pagina of contexto.pages()) await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  await contexto.close()
}

async function marcarConcessoes(browser: Browser, marcadas: boolean): Promise<void> {
  const contexto = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const admin = await contexto.newPage()
    await entrarComo(admin, 'admin')
    await admin.goto('/admin/usuarios')
    await admin.getByRole('region', { name: 'Usuários cadastrados' })
      .getByRole('button', { name: new RegExp(ADMIN) }).click()
    for (const nome of CONCESSOES) {
      const caixa = admin.getByRole('checkbox', { name: nome })
      await expect(caixa).toBeVisible()
      if ((await caixa.isChecked()) !== marcadas) await caixa.click()
    }
    await admin.getByRole('button', { name: 'Salvar permissões' }).click()
    await expect(admin.getByText(`Permissões de ${ADMIN} salvas com sucesso.`)).toBeVisible()
  } finally {
    await fechar(contexto)
  }
}

async function rpc(page: Page, acesso: AcessoAoBanco, nome: string, corpo: Record<string, unknown>) {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  return page.request.post(`${acesso.url}/rest/v1/rpc/${nome}`, { headers: cabecalhos, data: corpo, maxRedirects: 0 })
}

// Perfil sem a tela de Pedidos PJ e desviado pelo guarda de rotas e nunca ve a
// ficha; a recusa do banco e conferida a parte, pela Data API.
async function semJornadaNaTela(page: Page, perfil: string): Promise<void> {
  await page.goto(`/pedidos-pj?piloto=1&pedido=${PEDIDO_DA_JORNADA}`)
  await expect(page, `${perfil} e desviado da tela de Pedidos PJ`).not.toHaveURL(/\/pedidos-pj/, { timeout: 20_000 })
  await expect(page.getByRole('region', { name: `Ficha de ${CLIENTE_DA_JORNADA}` }),
    `${perfil} nao ve a ficha da jornada`).toHaveCount(0)
}

async function linhasDoPedido(page: Page, acesso: AcessoAoBanco): Promise<unknown[]> {
  const cabecalhos = await cabecalhosDaSessao(page, acesso)
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/orders?order_group_id=eq.${PEDIDO_DA_JORNADA}&select=id`,
    { headers: cabecalhos, maxRedirects: 0 })
  expect(resposta.status(), await resposta.text()).toBe(200)
  return await resposta.json() as unknown[]
}

test('Administrador ativo sem concessao marcada revisa a jornada PJ; outros perfis seguem bloqueados',
  matriz('Administrador sem concessao marcada', 'todas', 've a jornada, a revisao financeira e as Pendencias; nao confere; Financeiro sem Contas a receber e Vendas bloqueados',
    'Pedidos PJ: jornada e aba Pendencias'),
  async ({ browser }) => {
    test.setTimeout(240_000)
    // Rodada anterior interrompida pode ter deixado as concessoes desmarcadas.
    await marcarConcessoes(browser, true)
    try {
      await marcarConcessoes(browser, false)

      const contextoAdmin = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const admin = await contextoAdmin.newPage()
        const acesso = await entrarComo(admin, 'admin')
        const cabecalhos = await cabecalhosDaSessao(admin, acesso)
        const eu = await admin.request.get(`${acesso.url}/auth/v1/user`, { headers: cabecalhos, maxRedirects: 0 })
        expect(eu.status(), await eu.text()).toBe(200)
        const { id } = await eu.json() as { id: string }
        const concessoes = await admin.request.get(
          `${acesso.url}/rest/v1/app_user_permissions?user_id=eq.${id}&permission_key=in.(pedidos_pj.acessar,contas_receber.acessar,contas_receber.lancar,pedidos_pj.liberar)&select=permission_key`,
          { headers: cabecalhos, maxRedirects: 0 })
        expect(concessoes.status(), await concessoes.text()).toBe(200)
        expect(await concessoes.json(), 'o admin esta mesmo sem as quatro concessoes').toEqual([])

        await admin.goto(`/pedidos-pj?piloto=1&pedido=${PEDIDO_DA_JORNADA}`)
        const ficha = admin.getByRole('region', { name: `Ficha de ${CLIENTE_DA_JORNADA}` })
        await expect(ficha.getByRole('heading', { name: 'Revisão financeira' }),
          'a jornada abre com a revisao financeira para o admin').toBeVisible({ timeout: 20_000 })
        expect((await linhasDoPedido(admin, acesso)).length, 'o admin le o pedido da jornada direto').toBeGreaterThan(0)

        const conferir = await rpc(admin, acesso, 'transition_pj_flow_pilot', {
          p_request_id: crypto.randomUUID(), p_order_group_id: PEDIDO_DA_JORNADA, p_expected_version: 0,
          p_action: 'check', p_items: [], p_nf_confirmed: false,
        })
        expect(conferir.status(), 'conferir continua so com a Expedicao JC').toBe(403)

        await admin.goto('/pedidos-pj?legado=1')
        await expect(admin.getByRole('button', { name: /^Pendências/ }),
          'a aba Pendencias conta em vez de mostrar o travessao').toHaveText(/Pendências\s*\d+/, { timeout: 20_000 })
      } finally {
        await fechar(contextoAdmin)
      }

      const contextoFinanceiro = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const financeiro = await contextoFinanceiro.newPage()
        const acesso = await entrarComo(financeiro, 'financeiroCatalogoJc')
        await semJornadaNaTela(financeiro, 'Financeiro sem Contas a receber')
        const jornada = await rpc(financeiro, acesso, 'read_pj_flow_pilot', {})
        expect(jornada.status(), 'Financeiro sem Contas a receber nao le a jornada').toBe(403)
        expect(await linhasDoPedido(financeiro, acesso), 'nem o pedido direto na tabela').toEqual([])
      } finally {
        await fechar(contextoFinanceiro)
      }

      const contextoVendas = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const vendas = await contextoVendas.newPage()
        const acesso = await entrarComo(vendas, 'vendasJa')
        await semJornadaNaTela(vendas, 'Vendas JA')
        const jornada = await rpc(vendas, acesso, 'read_pj_flow_pilot', {})
        expect(jornada.status(), 'Vendas JA nao le a jornada').toBe(403)
      } finally {
        await fechar(contextoVendas)
      }
    } finally {
      await marcarConcessoes(browser, true)
    }
  })
