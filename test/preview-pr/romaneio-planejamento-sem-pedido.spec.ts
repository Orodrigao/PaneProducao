import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Em 10/10/2026 o Planejamento ficou em rascunho com paes da JA, o pedido da JA
// nunca foi gerado e o Romaneio mandou separar esses paes mesmo assim. Agora o
// Romaneio so usa o Planejamento da loja cujo pedido ja foi gerado, ou que nao
// tem pao novo a gerar (so congelado e sobra), e avisa a Expedicao quando ha
// pao novo planejado sem pedido.
//
// Dados do seed: hoje, a JC tem so a Ciabatta de congelado e sobra (8 + 2),
// sem pao novo; no proximo dia de producao, a JC tem a Baguete convertida em
// pedido (5 congeladas + 2 sobras + 3 novas). O caso de 10/10 e montado pelo
// Administrador num dia livre e apagado no fim.

const AVISO = 'O Planejamento tem pão para esta loja que não virou pedido.'
const MARCA = `[TESTE] Romaneio sem pedido ${Date.now().toString(36)}`

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const resultado = new Date(Date.UTC(ano, mes - 1, dia))
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado.toISOString().slice(0, 10)
}

/** Proximo dia de producao do seed: sabado pula o domingo. */
function proximoDiaDeProducao(): string {
  const hoje = hojeNaPadaria()
  const [ano, mes, dia] = hoje.split('-').map(Number)
  return somarDias(hoje, new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() === 6 ? 2 : 1)
}

async function chamar(page: Page, acesso: AcessoAoBanco, rpc: string, data: string, loja: string) {
  return page.request.post(`${acesso.url}/rest/v1/rpc/${rpc}`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: { p_production_date: data, p_store: loja },
    maxRedirects: 0,
  })
}

async function abrirNovoRomaneio(page: Page, data: string) {
  await page.goto('/romaneio')
  await page.getByRole('button', { name: 'Novo Romaneio' }).click({ timeout: 60_000 })
  const campo = page.locator('input[type="date"]')
  await expect(campo).toHaveValue(hojeNaPadaria())
  if (data !== hojeNaPadaria()) {
    await campo.fill(data)
    await expect(campo).toHaveValue(data)
  }
}

async function abrirLoja(page: Page, nomeDaLoja: string) {
  await page.getByRole('tab', { name: new RegExp(`^${nomeDaLoja.replace(/[[\]]/g, '\\$&')}`) }).click()
  // A faixa "Nª entrega para ..." so aparece com o rascunho da loja montado,
  // ja com pedido, composicao e aviso carregados.
  await expect(page.locator('.ps-banner.honey', { hasText: `para ${nomeDaLoja}` })).toBeVisible({ timeout: 60_000 })
}

test('Expedicao JC ve a composicao de quem virou pedido ou so tem congelado e sobra, sem aviso',
  matriz('Expedicao', 'JC', 'permitido', 'Romaneio: composicao do Planejamento (tela e Data API)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'expedicaoJc')
    const hoje = hojeNaPadaria()
    const proximo = proximoDiaDeProducao()

    // Hoje: so congelado e sobra, nada a virar pedido.
    const avisoHoje = await chamar(page, acesso, 'get_romaneio_plan_without_order', hoje, 'jc')
    expect(avisoHoje.status(), await avisoHoje.text()).toBe(200)
    expect(await avisoHoje.json(), 'so congelado e sobra nao pede pedido').toBe(false)
    const composicaoHoje = await chamar(page, acesso, 'get_romaneio_production_composition', hoje, 'jc')
    expect(composicaoHoje.status(), await composicaoHoje.text()).toBe(200)
    const ciabatta = (await composicaoHoje.json() as Array<{ bread_id: string; frozen_quantity: number }>)
      .find(linha => linha.bread_id === 'teste-ciabatta')
    expect(ciabatta, 'loja so com congelado e sobra continua no Romaneio').toMatchObject({ frozen_quantity: 8 })

    // Proximo dia: pedido gerado, composicao inteira.
    const composicaoProximo = await chamar(page, acesso, 'get_romaneio_production_composition', proximo, 'jc')
    expect(composicaoProximo.status(), await composicaoProximo.text()).toBe(200)
    const baguete = (await composicaoProximo.json() as Array<{ bread_id: string; planned_quantity: number; frozen_quantity: number }>)
      .find(linha => linha.bread_id === 'teste-baguete')
    expect(baguete, 'pedido gerado: a composicao continua chegando').toMatchObject({ planned_quantity: 10, frozen_quantity: 5 })

    // Tela, hoje.
    await abrirNovoRomaneio(page, hoje)
    await abrirLoja(page, '[TESTE] Julio de Castilhos')
    await expect(page.getByText(/Congelado: 8 un/).first()).toBeVisible()
    await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toHaveCount(0)

    // Tela, proximo dia.
    const campo = page.locator('input[type="date"]')
    await campo.fill(proximo)
    await expect(campo).toHaveValue(proximo)
    await abrirLoja(page, '[TESTE] Julio de Castilhos')
    await expect(page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first().getByText(/Congelado: 5 un/)).toBeVisible()
    await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toHaveCount(0)
  })

test('Romaneio nao usa pao novo da JA que ficou so no Planejamento e avisa (caso de 10/10)',
  matriz('Administrador', 'JA', 'permitido', 'Romaneio: aviso e sem numeros do rascunho (tela e Data API)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'admin')
    const cabecalhos = await cabecalhosDaSessao(page, acesso)
    // Dia distante, fora do seed e dos outros roteiros (um planejamento por data).
    const dia = somarDias(hojeNaPadaria(), 45)

    const livre = await page.request.get(`${acesso.url}/rest/v1/production_plans?production_date=eq.${dia}&select=id`, {
      headers: cabecalhos, maxRedirects: 0,
    })
    expect(livre.status(), await livre.text()).toBe(200)
    expect(await livre.json(), `o dia ${dia} precisa estar sem planejamento`).toEqual([])

    const plano = await page.request.post(`${acesso.url}/rest/v1/production_plans`, {
      headers: { ...cabecalhos, Prefer: 'return=representation' },
      data: { production_date: dia, status: 'rascunho', created_by_name: MARCA },
      maxRedirects: 0,
    })
    expect(plano.status(), await plano.text()).toBe(201)
    const [{ id: planoId }] = await plano.json() as Array<{ id: string }>

    try {
      const item = await page.request.post(`${acesso.url}/rest/v1/production_plan_items`, {
        headers: cabecalhos,
        data: {
          plan_id: planoId, store: 'ja', bread_id: 'teste-baguete',
          planned_quantity: 4, frozen_quantity: 0, leftover_proposed_quantity: 0, is_extra: false,
        },
        maxRedirects: 0,
      })
      expect(item.status(), await item.text()).toBe(201)

      const aviso = await chamar(page, acesso, 'get_romaneio_plan_without_order', dia, 'ja')
      expect(aviso.status(), await aviso.text()).toBe(200)
      expect(await aviso.json(), 'pao novo da JA sem pedido gera aviso').toBe(true)
      const composicao = await chamar(page, acesso, 'get_romaneio_production_composition', dia, 'ja')
      expect(composicao.status(), await composicao.text()).toBe(200)
      expect(await composicao.json(), 'pao novo sem pedido nao vira numero no Romaneio').toEqual([])

      await abrirNovoRomaneio(page, dia)
      await abrirLoja(page, '[TESTE] Jardim America')
      await expect(page.locator('.ps-banner.crust', { hasText: AVISO })).toBeVisible()
      await expect(page.getByText(/de 4 \(faltam/), 'os 4 paes do rascunho nao viram meta de separacao').toHaveCount(0)
    } finally {
      const apagar = await page.request.delete(`${acesso.url}/rest/v1/production_plans?id=eq.${planoId}`, {
        headers: { ...cabecalhos, Prefer: 'return=representation' },
        maxRedirects: 0,
      })
      expect(apagar.status(), await apagar.text()).toBe(200)
      expect(await apagar.json(), 'o planejamento desta execucao foi apagado').toHaveLength(1)
    }
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
