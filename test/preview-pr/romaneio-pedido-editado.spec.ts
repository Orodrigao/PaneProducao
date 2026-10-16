import { expect, test, type APIResponse } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz } from './apoio/entrar'

// Em 08/10/2026 a JC baixou o gorgonzola de 8 para 4 no pedido depois de gera-lo
// pelo Planejamento. Producao, Forno e Geolar mostraram 4; o Romaneio seguia o
// total do Planejamento e mandou separar 8. Agora o pao novo vem do pedido, mesmo
// editado depois; do Planejamento ficam so congelado e sobra, e o cartao do pao
// avisa que o pedido difere do Planejamento. Rascunho salvo no aparelho tambem
// rele o pedido ao ser recuperado e nao fecha se essa leitura falhar.
//
// O Administrador monta o caso num dia livre: Planejamento com 10 Baguetes da JC,
// pedido gerado pelo proprio Planejamento e depois editado para 4, 6 e 5. A
// Expedicao JC confere a tela. No fim o Administrador apaga pedido e Planejamento.

const MARCA = `[TESTE] Romaneio pedido editado ${Date.now().toString(36)}`
const PAO = 'teste-baguete'
const LOJA = '[TESTE] Julio de Castilhos'

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const resultado = new Date(Date.UTC(ano, mes - 1, dia))
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado.toISOString().slice(0, 10)
}

async function semFalha(nome: string, pedido: Promise<APIResponse>, falhas: string[]): Promise<void> {
  try {
    const resposta = await pedido
    if (!resposta.ok()) falhas.push(`${nome}: ${resposta.status()} ${await resposta.text()}`)
  } catch (erro) {
    falhas.push(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
}

test('Expedicao JC separa o pedido editado depois do Planejamento e ve o aviso',
  matriz('Expedicao', 'JC', 'permitido', 'Romaneio: meta segue o pedido editado depois da conversao (tela)'),
  async ({ page, browser }) => {
    test.setTimeout(240_000)
    // Dia distante, fora do seed e dos outros roteiros (um planejamento por data).
    const dia = somarDias(hojeNaPadaria(), 47)

    const contextoAdmin = await browser.newContext({ serviceWorkers: 'block' })
    try {
      const admin = await contextoAdmin.newPage()
      const acesso = await entrarComo(admin, 'admin')
      const cabecalhos = await cabecalhosDaSessao(admin, acesso)
      const rest = `${acesso.url}/rest/v1`
      const pedidoDoPao = `${rest}/orders?store=eq.jc&order_date=eq.${dia}&bread_id=eq.${PAO}`
      const planosDoDia = `${rest}/production_plans?production_date=eq.${dia}`

      const livre = await admin.request.get(`${planosDoDia}&select=id`, { headers: cabecalhos, maxRedirects: 0 })
      expect(livre.status(), await livre.text()).toBe(200)
      expect(await livre.json(), `o dia ${dia} precisa estar sem planejamento`).toEqual([])
      const semPedido = await admin.request.get(`${pedidoDoPao}&select=id`, { headers: cabecalhos, maxRedirects: 0 })
      expect(semPedido.status(), await semPedido.text()).toBe(200)
      expect(await semPedido.json(), `o dia ${dia} precisa estar sem pedido de Baguete da JC`).toEqual([])

      const editarPedido = async (quantidade: number) => {
        const editar = await admin.request.patch(pedidoDoPao, {
          headers: { ...cabecalhos, Prefer: 'return=representation' },
          data: { quantity: quantidade },
          maxRedirects: 0,
        })
        expect(editar.status(), await editar.text()).toBe(200)
        expect(await editar.json(), 'o pedido editado e uma linha').toHaveLength(1)
      }

      // Tudo que grava fica dentro do try: a limpeza apaga pelo dia, livre no inicio.
      try {
        const plano = await admin.request.post(`${rest}/production_plans`, {
          headers: { ...cabecalhos, Prefer: 'return=representation' },
          data: { production_date: dia, status: 'rascunho', created_by_name: MARCA },
          maxRedirects: 0,
        })
        expect(plano.status(), await plano.text()).toBe(201)
        const [{ id: planoId }] = await plano.json() as Array<{ id: string }>
        const item = await admin.request.post(`${rest}/production_plan_items`, {
          headers: cabecalhos,
          data: {
            plan_id: planoId, store: 'jc', bread_id: PAO,
            planned_quantity: 10, frozen_quantity: 0, leftover_proposed_quantity: 0, is_extra: false,
          },
          maxRedirects: 0,
        })
        expect(item.status(), await item.text()).toBe(201)

        const gerar = await admin.request.post(`${rest}/rpc/import_production_plan_order`, {
          headers: cabecalhos,
          data: { p_plan_id: planoId, p_store: 'jc', p_actor_name: MARCA },
          maxRedirects: 0,
        })
        expect(gerar.status(), await gerar.text()).toBe(200)
        const gerado = await admin.request.get(`${pedidoDoPao}&select=quantity`, { headers: cabecalhos, maxRedirects: 0 })
        expect(gerado.status(), await gerado.text()).toBe(200)
        expect((await gerado.json() as Array<{ quantity: number }>).map(linha => Number(linha.quantity)),
          'o Planejamento gerou o pedido de 10 baguetes').toEqual([10])

        // Edicao depois da conversao, como a do gorgonzola em 08/10.
        await editarPedido(4)

        await entrarComo(page, 'expedicaoJc')
        await page.goto('/romaneio')
        await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
        const campo = page.locator('input[type="date"]')
        await expect(campo).toHaveValue(hojeNaPadaria())
        await campo.fill(dia)
        await expect(campo).toHaveValue(dia)
        await page.getByRole('tab', { name: /^\[TESTE\] Julio de Castilhos/ }).click()
        // A faixa "Nª entrega para ..." so aparece com o rascunho da loja montado,
        // ja com pedido e composicao carregados.
        const faixa = page.locator('.ps-banner.honey', { hasText: `para ${LOJA}` })
        await expect(faixa).toBeVisible({ timeout: 60_000 })

        const cartao = page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first()
        await expect(cartao.getByText('0 de 4 (faltam 4)'), 'a meta e o pedido editado').toBeVisible()
        await expect(cartao.getByText(/Pão novo: 4 un/)).toBeVisible()
        await expect(cartao.getByRole('note'))
          .toHaveText('Pedido diferente do Planejamento: pão novo planejado 10 un.')
        await expect(cartao.getByText(/de 10 \(faltam/), 'o total do Planejamento nao vira meta').toHaveCount(0)

        // Rascunho salvo com 1 separada; o pedido muda de novo para 6. Ao
        // recuperar, vale o pedido atual e fica o que foi digitado.
        await cartao.getByRole('button', { name: 'Aumentar' }).click()
        await expect(cartao.getByText('1 de 4 (faltam 3)')).toBeVisible()
        await page.getByRole('button', { name: 'Salvar rascunho' }).click()
        await editarPedido(6)

        await page.goto('/romaneio')
        await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
        await expect(campo).toHaveValue(dia)
        await expect(faixa).toBeVisible({ timeout: 60_000 })
        await expect(cartao.getByText('1 de 6 (faltam 5)'), 'rascunho recuperado segue o pedido atual')
          .toBeVisible({ timeout: 60_000 })
        await expect(cartao.getByText(/Pão novo: 6 un/)).toBeVisible()
        await expect(cartao.getByRole('note'))
          .toHaveText('Pedido diferente do Planejamento: pão novo planejado 10 un.')

        // Pedido muda para 5 e a leitura do pedido falha ao recuperar o rascunho:
        // aviso fixo, o romaneio nao fecha com a meta antiga e "Tentar de novo"
        // traz o pedido atual sem perder o que foi digitado.
        await editarPedido(5)
        const pedidosDaLoja = (endereco: URL) => endereco.pathname.endsWith('/rest/v1/orders')
        await page.route(pedidosDaLoja, rota => rota.abort('failed'))
        await page.goto('/romaneio')
        await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
        const semAtualizar = page.locator('.ps-banner.crust', { hasText: 'Não foi possível atualizar o pedido desta loja.' })
        await expect(semAtualizar).toBeVisible({ timeout: 60_000 })
        // O aparelho guardou o rascunho de quando o pedido era 4.
        await expect(cartao.getByText('1 de 4 (faltam 3)'), 'sem atualizar, a meta antiga fica marcada pelo aviso').toBeVisible()
        await page.getByRole('button', { name: 'Fechar', exact: true }).click()
        await expect(page.getByText('Atualize o pedido desta loja antes de fechar o romaneio')).toBeVisible()
        const romaneiosDoDia = await admin.request.get(`${rest}/romaneios?record_date=eq.${dia}&select=id`, {
          headers: cabecalhos, maxRedirects: 0,
        })
        expect(romaneiosDoDia.status(), await romaneiosDoDia.text()).toBe(200)
        expect(await romaneiosDoDia.json(), 'o romaneio nao fecha sem atualizar o pedido').toEqual([])

        await page.unroute(pedidosDaLoja)
        await semAtualizar.getByRole('button', { name: 'Tentar de novo' }).click()
        await expect(semAtualizar).toHaveCount(0, { timeout: 60_000 })
        await expect(cartao.getByText('1 de 5 (faltam 4)'), 'depois de atualizar vale o pedido atual').toBeVisible()
      } finally {
        // Limpezas independentes: falhar uma nao impede a outra.
        const falhas: string[] = []
        await semFalha('apagar pedido', admin.request.delete(pedidoDoPao, { headers: cabecalhos, maxRedirects: 0 }), falhas)
        await semFalha('apagar planejamento', admin.request.delete(planosDoDia, { headers: cabecalhos, maxRedirects: 0 }), falhas)
        for (const [nome, endereco] of [['pedido', `${pedidoDoPao}&select=id`], ['planejamento', `${planosDoDia}&select=id`]]) {
          try {
            const sobra = await admin.request.get(endereco, { headers: cabecalhos, maxRedirects: 0 })
            if (sobra.status() !== 200 || (await sobra.json() as unknown[]).length > 0) falhas.push(`${nome} continua no dia ${dia}`)
          } catch (erro) {
            falhas.push(`conferir ${nome}: ${erro instanceof Error ? erro.message : String(erro)}`)
          }
        }
        expect(falhas, 'a limpeza desta execucao precisa terminar').toEqual([])
      }
    } finally {
      await contextoAdmin.close()
    }
  })
