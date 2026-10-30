import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

// Revenda sem cadastro, fase 2 (28/10/2026). O Financeiro JC importa uma NF-e
// de mercadoria de revenda, lanca o primeiro item como "revenda sem cadastro",
// salva para conferir depois e retoma (o rascunho guardava so "uso ou despesa"
// antes desta fase), confirma, ve o destino de cada item, lanca o segundo item
// pelos pendentes e confere que a proxima nota do mesmo fornecedor sugere a
// revenda e ainda pede a conferencia. O terceiro item e classificado como o
// site anterior faz, so com dois parametros, e vira uso ou despesa. Vendas JA e
// Expedicao JC sao barrados na funcao com o token da propria sessao.
// Conta unica por rodada (chave, CNPJ, numero e codigos com o carimbo da
// hora); a conta aberta e cancelada no fim, mesmo se o roteiro falhar.

type NotaDeRevenda = { xml: string; chave: string; numero: string; fornecedor: string }

const destinoRevenda = 'Destino: revenda sem cadastro (sem produto, fora do custo e da contagem)'
const destinoUsoDespesa = 'Destino: uso ou despesa (sem produto, fora do custo e da contagem)'

function totaisSimples(valor: string): string {
  return `<vProd>${valor}</vProd><vDesc>0.00</vDesc><vST>0.00</vST><vFCPST>0.00</vFCPST><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>${valor}</vNF>`
}

function vencimento(): string {
  const data = new Date(Date.now() + 30 * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(data)
}

// Mesmo fornecedor e mesmos codigos nas duas notas da rodada; a segunda so
// troca chave e numero, para a memoria do fornecedor reconhecer os itens.
function notaDeRevenda(stamp: string, sufixo: string): NotaDeRevenda {
  const chave = `39${stamp}${sufixo}`.padEnd(44, '7')
  const numero = `${sufixo}${stamp.slice(-8)}`
  const fornecedor = `[TESTE] Fornecedor revenda ${stamp.slice(-6)}`
  const item = (n: number, codigo: string, nome: string, quantidade: string, preco: string, total: string) =>
    `<det nItem="${n}"><prod><cProd>${codigo}-${stamp.slice(-6)}</cProd><xProd>${nome}</xProd><NCM>21069030</NCM><qCom>${quantidade}</qCom><uCom>UN</uCom><vUnCom>${preco}</vUnCom><vProd>${total}</vProd></prod></det>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}" versao="4.00">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-10-28T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>95${stamp.slice(-12)}</CNPJ><xNome>${fornecedor}</xNome></emit>
    ${item(1, 'REV-WHEY', '[TESTE] WHEY REVENDA 900G', '2.0000', '45.00', '90.00')}
    ${item(2, 'REV-BCAA', '[TESTE] BCAA REVENDA 120 CAPS', '1.0000', '30.00', '30.00')}
    ${item(3, 'USO-SACO', '[TESTE] SACO PARA ENTREGA', '1.0000', '10.00', '10.00')}
    <total><ICMSTot>${totaisSimples('130.00')}</ICMSTot></total>
    <pag><detPag><tPag>15</tPag><vPag>130.00</vPag></detPag></pag>
    <cobr><dup><nDup>001</nDup><dVenc>${vencimento()}</dVenc><vDup>130.00</vDup></dup></cobr>
  </infNFe>
</NFe>`
  return { xml, chave, numero, fornecedor }
}

// Com `jaLancada`, espera a conta dela na lista antes de abrir o arquivo: as
// contas e os fornecedores chegam do banco juntos, e o fornecedor da nota so e
// escolhido sozinho (pelo CNPJ) se a lista ja tiver chegado.
async function abrirImportacao(page: Page, nota: NotaDeRevenda, jaLancada?: NotaDeRevenda) {
  await page.goto('/contas-pagar')
  if (jaLancada) await expect(conta(page, jaLancada)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'revenda.xml', mimeType: 'application/xml', buffer: Buffer.from(nota.xml) })
  await expect(page.getByText('Itens da NF-e ·', { exact: false })).toBeVisible({ timeout: 20_000 })
}

function conta(page: Page, nota: NotaDeRevenda) {
  return page.locator('.ps-card', { hasText: `NF-e ${nota.numero}` }).filter({ hasText: nota.fornecedor }).first()
}

async function abrirItensDaNota(page: Page, nota: NotaDeRevenda) {
  const cartao = conta(page, nota)
  await expect(cartao).toBeVisible({ timeout: 20_000 })
  await cartao.click()
  await cartao.getByRole('button', { name: 'Ver itens da NF-e' }).click()
  const itens = page.locator('.ps-banner', { hasText: 'Itens da NF-e' })
  await expect(itens.getByText('[TESTE] SACO PARA ENTREGA')).toBeVisible({ timeout: 20_000 })
  return { cartao, itens }
}

async function lerItens(page: Page, acesso: AcessoAoBanco, chave: string) {
  const headers = await cabecalhosDaSessao(page, acesso)
  const contas = await page.request.get(`${acesso.url}/rest/v1/payable_purchases?select=id&nfe_key=eq.${chave}`, { headers, maxRedirects: 0 })
  expect(contas.ok(), await contas.text()).toBe(true)
  const [compra] = (await contas.json()) as { id: string }[]
  const resposta = await page.request.get(
    `${acesso.url}/rest/v1/payable_purchase_items?select=id,source_description,mapping_status,non_catalog_kind,product_id&purchase_id=eq.${compra.id}&order=source_line_number`,
    { headers, maxRedirects: 0 },
  )
  expect(resposta.ok(), await resposta.text()).toBe(true)
  return (await resposta.json()) as { id: string; source_description: string; mapping_status: string; non_catalog_kind: string | null; product_id: string | null }[]
}

// Limpeza que roda mesmo se o roteiro falhar: a conta ficticia aberta e
// cancelada pela mesma funcao do botao da tela.
async function cancelarSeAberta(page: Page, acesso: AcessoAoBanco, chave: string) {
  const headers = await cabecalhosDaSessao(page, acesso)
  const resposta = await page.request.get(`${acesso.url}/rest/v1/payable_purchases?select=id,status&nfe_key=eq.${chave}`, { headers, maxRedirects: 0 })
  if (!resposta.ok()) return
  for (const linha of (await resposta.json()) as { id: string; status: string }[]) {
    if (linha.status !== 'aberta') continue
    await page.request.post(`${acesso.url}/rest/v1/rpc/cancel_manual_payable`, {
      headers,
      data: { p_purchase_id: linha.id, p_reason: 'Limpeza do teste de navegador da revenda sem cadastro' },
      maxRedirects: 0,
    })
  }
}

test('Financeiro JC lanca revenda sem cadastro na importacao, no rascunho e nos pendentes; a proxima nota sugere a revenda',
  matriz('Financeiro JC', 'JC', 'permitido', 'Revenda sem cadastro (importacao, rascunho, pendentes e memoria)'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const acesso = await entrarComo(page, 'financeiroJc')
    const stamp = Date.now().toString()
    const nota = notaDeRevenda(stamp, '1')
    const proxima = notaDeRevenda(stamp, '2')

    try {
      await abrirImportacao(page, nota)
      // Fornecedor novo da rodada: a tela pede o cadastro.
      await expect(page.getByText('Fornecedor do XML:', { exact: false })).toBeVisible()
      await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
      await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue(nota.fornecedor)
      await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
      await expect(page.locator('select.ps-select').first()).not.toHaveValue('')

      // A quarta escolha aparece ao lado das outras tres, com o custo escondido.
      const lancarRevenda = page.getByRole('button', { name: 'Lançar como revenda sem cadastro' })
      await expect(lancarRevenda).toHaveCount(3)
      await expect(page.getByText('Mercadoria para revender sem criar produto: entra no financeiro como mercadoria, sem custo de receita e fora da contagem. Mostra quanto se gastou, mas não controla estoque nem margem; para isso, use a escolha 2. Fica memorizada para este fornecedor.', { exact: true }).first()).toBeVisible()
      await lancarRevenda.first().click()
      await expect(lancarRevenda).toHaveCount(2)
      await expect(page.getByText('Revenda sem cadastro: entra no financeiro como mercadoria', { exact: true })).toHaveCount(1)

      // Salvar para depois e retomar: o rascunho guarda o tipo.
      await page.getByRole('button', { name: 'Salvar para conferir depois' }).click()
      await expect(page.locator('.toast', { hasText: 'Importação salva para conferir depois' })).toBeVisible({ timeout: 20_000 })
      const rascunho = page.locator('[data-testid="xml-import-draft"]', { hasText: `NF ${nota.numero}` })
      await expect(rascunho).toHaveCount(1, { timeout: 20_000 })
      await rascunho.getByRole('button', { name: 'Continuar conferência' }).click()
      await expect(page.getByText('Importação retomada', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Revenda sem cadastro: entra no financeiro como mercadoria', { exact: true })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Lançar como revenda sem cadastro' })).toHaveCount(2)
      await page.getByRole('button', { name: 'Conferi esta classificação' }).click()

      // Os outros dois itens entram pendentes.
      await page.getByRole('button', { name: 'Confirmar NF-e' }).click()
      await expect(page.locator('.toast', { hasText: 'Há itens aguardando classificação' })).toBeVisible({ timeout: 20_000 })

      const { cartao, itens } = await abrirItensDaNota(page, nota)
      await expect(itens.getByText(destinoRevenda)).toHaveCount(1)
      await expect(itens.getByText('Destino: aguardando classificação')).toHaveCount(2)

      // Pendente lancado como revenda sem cadastro, com a confirmacao da tela.
      await cartao.getByRole('button', { name: 'Classificar itens pendentes' }).click()
      const fechar = page.getByRole('button', { name: 'Fechar classificação' })
      const pendentes = page.locator('.ps-banner').filter({ has: fechar })
      await expect(pendentes).toBeVisible({ timeout: 20_000 })
      const cartaoBcaa = pendentes.locator('.ps-card', { hasText: '[TESTE] BCAA REVENDA 120 CAPS' }).first()
      let pergunta = ''
      page.once('dialog', confirmacao => { pergunta = confirmacao.message(); void confirmacao.accept() })
      await cartaoBcaa.getByRole('button', { name: 'Lançar como revenda sem cadastro' }).click()
      await expect(page.locator('.toast', { hasText: 'Item registrado como revenda sem cadastro' })).toBeVisible({ timeout: 20_000 })
      expect(pergunta).toContain('Confirmar como revenda sem cadastro?')

      // O site anterior a esta fase chama a classificacao com dois parametros:
      // continua funcionando e grava uso ou despesa.
      const saco = (await lerItens(page, acesso, nota.chave)).find(linha => linha.source_description === '[TESTE] SACO PARA ENTREGA')
      expect(saco?.mapping_status).toBe('pendente')
      const antiga = await page.request.post(`${acesso.url}/rest/v1/rpc/classify_payable_item_without_product`, {
        headers: await cabecalhosDaSessao(page, acesso),
        data: { p_item_id: saco?.id, p_remember_decision: false },
        maxRedirects: 0,
      })
      // Funcao sem retorno: o PostgREST responde 204 (ou 200 nas versoes antigas).
      expect([200, 204], await antiga.text()).toContain(antiga.status())

      // Persistencia: relida a pagina, cada item mostra o destino gravado.
      await page.reload()
      const relida = await abrirItensDaNota(page, nota)
      await expect(relida.itens.getByText(destinoRevenda)).toHaveCount(2)
      await expect(relida.itens.getByText(destinoUsoDespesa)).toHaveCount(1)
      await expect(relida.itens.getByText('Destino: aguardando classificação')).toHaveCount(0)
      expect((await lerItens(page, acesso, nota.chave)).map(linha => [linha.mapping_status, linha.non_catalog_kind, linha.product_id])).toEqual([
        ['nao_aplicavel', 'revenda', null],
        ['nao_aplicavel', 'revenda', null],
        ['nao_aplicavel', 'uso_despesa', null],
      ])

      // A proxima nota do fornecedor sugere a revenda e ainda pede conferencia.
      await abrirImportacao(page, proxima, nota)
      await expect(page.locator('select.ps-select').first()).not.toHaveValue('')
      await expect(page.getByText('Fornecedor do XML:', { exact: false })).toHaveCount(0)
      await expect(page.getByText('revenda sem cadastro reconhecida', { exact: true })).toHaveCount(2, { timeout: 20_000 })
      await expect(page.getByText('Revenda sem cadastro: entra no financeiro como mercadoria', { exact: true })).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'Conferi esta classificação' })).toHaveCount(2)
      await expect(page.getByText(/classificação\(ões\) lembrada\(s\) do fornecedor precisam ser conferidas/)).toBeVisible()
    } finally {
      await cancelarSeAberta(page, acesso, nota.chave)
      await cancelarSeAberta(page, acesso, proxima.chave)
    }
  })

for (const [perfil, nome, loja] of [
  ['vendasJa', 'Vendas JA', 'JA'],
  ['expedicaoJc', 'Expedicao JC', 'JC'],
] as const) {
  test(`${nome} e barrado de lancar revenda sem cadastro e de ler a revenda do consumo na Data API`,
    matriz(nome, loja, 'bloqueado', 'classify_payable_item_without_product e inventory_consumption_resale_items (Data API)'),
    async ({ page }) => {
      const acesso = await entrarComo(page, perfil)
      const headers = await cabecalhosDaSessao(page, acesso)
      const classificar = await page.request.post(`${acesso.url}/rest/v1/rpc/classify_payable_item_without_product`, {
        headers,
        data: { p_item_id: '97800000-0000-4000-8000-0000000000ff', p_remember_decision: true, p_non_catalog_kind: 'revenda' },
        maxRedirects: 0,
      })
      const corpoClassificar = await classificar.text()
      expect(classificar.status(), corpoClassificar).toBe(403)
      expect(JSON.parse(corpoClassificar)).toMatchObject({ code: '42501' })

      const revenda = await page.request.post(`${acesso.url}/rest/v1/rpc/inventory_consumption_resale_items`, {
        headers,
        data: { p_store: 'jc', p_end_count_id: null },
        maxRedirects: 0,
      })
      const corpoRevenda = await revenda.text()
      expect(revenda.status(), corpoRevenda).toBe(403)
      expect(JSON.parse(corpoRevenda)).toMatchObject({ code: '42501' })
    })
}
