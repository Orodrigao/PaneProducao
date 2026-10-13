import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 10/10/2026 o Planejamento ficou em rascunho com paes da JA, o pedido da JA
// nunca foi gerado e o Romaneio mandou separar esses paes mesmo assim. Agora o
// Romaneio so usa o Planejamento da loja cujo pedido ja foi gerado, e avisa a
// Expedicao quando ha planejamento sem pedido.
//
// Dados do seed: hoje, a JC tem Ciabatta planejada (8 congeladas + 2 sobras)
// sem pedido gerado; no proximo dia de producao, a JC tem a Baguete planejada
// e convertida em pedido (5 congeladas + 2 sobras + 3 novas). Nada aqui grava.

const AVISO = 'O Planejamento tem pão para esta loja que ainda não virou pedido.'

/** Proximo dia de producao do seed: sabado pula o domingo. */
function proximoDiaDeProducao(): string {
  const [ano, mes, dia] = hojeNaPadaria().split('-').map(Number)
  const hoje = new Date(Date.UTC(ano, mes - 1, dia))
  hoje.setUTCDate(hoje.getUTCDate() + (hoje.getUTCDay() === 6 ? 2 : 1))
  return hoje.toISOString().slice(0, 10)
}

async function chamar(page: Page, acesso: AcessoAoBanco, rpc: string, data: string, loja: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/${rpc}`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_production_date: data, p_store: loja },
    maxRedirects: 0,
  })
}

async function abrirLoja(page: Page, nomeDaLoja: string) {
  await page.getByRole('tab', { name: new RegExp(`^${nomeDaLoja.replace(/[[\]]/g, '\\$&')}`) }).click()
  // A faixa "Nª entrega para ..." so aparece com o rascunho da loja montado,
  // ja com pedido, composicao e aviso carregados.
  await expect(page.locator('.ps-banner.honey', { hasText: `para ${nomeDaLoja}` })).toBeVisible({ timeout: 60_000 })
}

test('Expedicao JC ve o aviso do Planejamento sem pedido e a composicao so de quem virou pedido',
  matriz('Expedicao', 'JC/JA', 'permitido', 'Romaneio: Planejamento so com pedido gerado (tela e Data API)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'expedicaoJc')
    const hoje = hojeNaPadaria()
    const proximo = proximoDiaDeProducao()

    // Data API com o token da propria sessao.
    const avisoJcHoje = await chamar(page, acesso, 'get_romaneio_plan_without_order', hoje, 'jc')
    expect(avisoJcHoje.status(), await avisoJcHoje.text()).toBe(200)
    expect(await avisoJcHoje.json(), 'JC tem Ciabatta planejada sem pedido hoje').toBe(true)

    const composicaoJcHoje = await chamar(page, acesso, 'get_romaneio_production_composition', hoje, 'jc')
    expect(composicaoJcHoje.status(), await composicaoJcHoje.text()).toBe(200)
    const linhasHoje = await composicaoJcHoje.json() as Array<{ bread_id: string }>
    expect(linhasHoje.map(linha => linha.bread_id), 'planejamento sem pedido nao vira numero').not.toContain('teste-ciabatta')

    const avisoJaHoje = await chamar(page, acesso, 'get_romaneio_plan_without_order', hoje, 'ja')
    expect(avisoJaHoje.status(), await avisoJaHoje.text()).toBe(200)
    expect(await avisoJaHoje.json(), 'JA nao tem planejamento sem pedido hoje').toBe(false)

    const composicaoJcProximo = await chamar(page, acesso, 'get_romaneio_production_composition', proximo, 'jc')
    expect(composicaoJcProximo.status(), await composicaoJcProximo.text()).toBe(200)
    const baguete = (await composicaoJcProximo.json() as Array<{ bread_id: string; planned_quantity: number; frozen_quantity: number }>)
      .find(linha => linha.bread_id === 'teste-baguete')
    expect(baguete, 'pedido gerado: a composicao continua chegando').toMatchObject({ planned_quantity: 10, frozen_quantity: 5 })

    // Tela: hoje, a JC mostra o aviso e nao os numeros do rascunho.
    await page.goto('/romaneio')
    await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
    const data = page.locator('input[type="date"]')
    await expect(data).toHaveValue(hoje)
    await abrirLoja(page, '[TESTE] Julio de Castilhos')
    await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toBeVisible()
    await expect(page.getByText('Transformar em Pedido', { exact: false })).toBeVisible()
    await expect(page.getByText(/Congelado: 8 (un|kg)/), 'a Ciabatta do rascunho nao aparece com a composicao').toHaveCount(0)

    // A JA nao tem planejamento sem pedido: sem aviso.
    await abrirLoja(page, '[TESTE] Jardim America')
    await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toHaveCount(0)

    // Proximo dia: a JC ja virou pedido, a composicao aparece e nao ha aviso.
    await data.fill(proximo)
    await expect(data).toHaveValue(proximo)
    await abrirLoja(page, '[TESTE] Julio de Castilhos')
    const cartaoBaguete = page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first()
    await expect(cartaoBaguete.getByText(/Congelado: 5 un/)).toBeVisible()
    await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toHaveCount(0)
  })

test('Romaneio EX e barrado no Planejamento da JC',
  matriz('Romaneio EX', 'JC', 'bloqueado', 'get_romaneio_plan_without_order e composicao da JC (Data API)'),
  async ({ page }) => {
    const acesso = await entrarComo(page, 'romaneioEx')
    for (const rpc of ['get_romaneio_plan_without_order', 'get_romaneio_production_composition']) {
      const resposta = await chamar(page, acesso, rpc, hojeNaPadaria(), 'jc')
      const corpo = await resposta.text()
      expect(resposta.status(), `${rpc}: ${corpo}`).toBe(403)
      expect(JSON.parse(corpo), rpc).toMatchObject({ code: '42501' })
    }
  })
