import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

const previewAccounts = {
  admin: 'rodrigao+teste@gmail.com',
  vendasJa: 'rodrigao+teste-vendas-ja@gmail.com',
  romaneioEx: 'rodrigao+teste-romaneio-ex@gmail.com',
  cozinhaJc: 'rodrigao+teste-cozinha-jc@gmail.com',
  geolarJc: 'rodrigao+teste-geolar-jc@gmail.com',
  financeiroJc: 'rodrigao+teste-financeiro-jc@gmail.com',
} as const

// Montar o rascunho do romaneio faz QUATRO rodadas de consultas em sequencia, e
// o proprio aplicativo admite ate DEFAULT_REQUEST_TIMEOUT_MS (15s) por chamada.
// Dar 15s ao conjunto inteiro era dar as quatro o mesmo que o sistema da a uma:
// so passava com tudo rapido, e a primeira execucao depois de reconstruir o
// Banco Preview pega o banco frio. Este e o orcamento do conjunto.
const slowPreviewDataTimeoutMs = 15_000
const romaneioDraftTimeoutMs = 60_000

// Bloco de totais de uma NF-e 4.00 sem acrescimos: so produtos e o total.
function totaisSimples(valor: string): string {
  return `<vProd>${valor}</vProd><vDesc>0.00</vDesc><vST>0.00</vST><vFCPST>0.00</vFCPST><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>${valor}</vNF>`
}

function romaneioCardByObs(page: import('@playwright/test').Page, obs: string) {
  return page.locator('.ps-card', { hasText: obs }).first()
}

async function enterWithPreviewAccount(
  page: import('@playwright/test').Page,
  email: string,
) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

async function expectRouteVisible(page: import('@playwright/test').Page, href: string) {
  await expect(page.locator(`a[href="${href}"]`).first()).toBeAttached()
}

// Por que este laço existe, e por que ele é CONTADO.
//
// O smoke roda contra `next dev`, e no App Router o Strict Mode vem ligado por
// padrão: em desenvolvimento o React monta o componente, desmonta e monta de
// novo, então a carga inicial do Romaneio chega a rodar duas vezes. Essa carga
// termina em setScreen('admin'). Quando a segunda passada chega DEPOIS de o
// teste já ter aberto "Novo Romaneio", ela devolve a tela ao painel admin e
// leva junto a lista de lojas: a aba do destino some do DOM, e nenhuma
// repetição de clique NA ABA a traz de volta.
//
// Esse mecanismo reproduz, em laboratório, os DOIS modos de falha que
// derrubaram a main em 27/08 e 28/08 (a aba que "não existe" por 20s e o
// rascunho que nunca monta). Reproduzir não é provar qual dos dois ocorreu em
// cada execução do CI, mas é o único mecanismo testado que produz as duas
// mensagens exatas.
//
// A tolerância é LIMITADA de propósito. A remontagem do modo de
// desenvolvimento explica UMA volta ao painel; mais do que isso é a tela
// voltando sozinha de verdade, e isso é defeito, não ruído. Passado o limite,
// o laço para de reentrar e deixa a espera falhar com os contadores na
// mensagem, para o próximo a investigar ler o que aconteceu em vez de adivinhar
// (ver lessons.md 2026-08-21: repetição que não conta nada vira máscara).
const entradasNaTelaDeCriacao = 2
const recargasDeRascunho = 1

async function selectRomaneioDestination(
  page: import('@playwright/test').Page,
  destinationName: string,
) {
  const novoRomaneio = page.getByRole('button', { name: 'Novo Romaneio' })
  // A aba ganha um marcador ("•") assim que o rascunho traz quantidade, e a
  // reposição pendente da EX já nasce preenchida. getByRole({ name }) compara o
  // nome INTEIRO (operador "=" de matchesAttributePart, só ignorando a caixa),
  // então prender o localizador ao nome cru o faria parar de casar no meio do
  // caminho. Declarar as DUAS formas legítimas casa com os dois estados e só
  // com eles: filtrar por trecho casaria também com uma loja cujo nome
  // contivesse este.
  const semMarcador = { name: destinationName, exact: true } as const
  const comMarcador = { name: `${destinationName} •`, exact: true } as const
  const abaDoDestino = page
    .getByRole('tab', semMarcador)
    .or(page.getByRole('tab', comMarcador))
  const abaEscolhida = page
    .getByRole('tab', { ...semMarcador, selected: true })
    .or(page.getByRole('tab', { ...comMarcador, selected: true }))
  const rascunho = page.locator('.ps-banner.honey', { hasText: `para ${destinationName}` })
  const falhaDeCarga = page.getByRole('button', { name: 'Tentar de novo' })

  // Entrar antes de a tela terminar de carregar custaria uma volta inteira do
  // laço à toa. O painel do administrador faz duas rodadas de consultas em
  // sequência (loadBase e depois loadAdminPainel), por isso 30s e não 15s.
  await expect(
    novoRomaneio,
    'O painel do Romaneio não terminou de carregar.',
  ).toBeVisible({ timeout: 2 * slowPreviewDataTimeoutMs })

  let entradas = 0
  let recargas = 0

  await expect(async () => {
    // Nada de .catch() largo aqui: isVisible() já devolve false quando o
    // elemento não existe, e ERRA quando o localizador ficou ambíguo. Engolir
    // esse erro esconderia exatamente o defeito que queremos ver.
    if (await novoRomaneio.isVisible()) {
      if (entradas >= entradasNaTelaDeCriacao) {
        // Passou do que a remontagem do modo de desenvolvimento explica. Parar
        // de reentrar aqui e deixar o erro subir com os contadores: insistir
        // faria o teste passar por cima de uma tela que volta sozinha de
        // verdade, que e defeito, e a mensagem final seria um clique sem alvo.
        throw new Error(
          `A tela do Romaneio voltou ao painel admin ${entradas} vezes. `
            + 'A remontagem do modo de desenvolvimento explica uma; mais que isso '
            + 'e a tela se resetando sozinha, e isso e defeito, nao lentidao.',
        )
      }
      entradas++
      await novoRomaneio.click({ timeout: 5_000 })
    }
    // A tela distingue "carregando" de "falhou" desde a PR 253: se ela avisou
    // que falhou, usamos o botão que ela mesma oferece, uma vez.
    if (await falhaDeCarga.isVisible()) {
      if (recargas < recargasDeRascunho) {
        recargas++
        await falhaDeCarga.click({ timeout: 5_000 })
      }
    } else if ((await abaEscolhida.count()) === 0) {
      // count() e isVisible() respondem na hora; getAttribute() ESPERA pelo
      // elemento e travaria o laço inteiro quando a tela tivesse sido resetada.
      await abaDoDestino.click({ timeout: 5_000 })
    }
    await expect(
      rascunho,
      `O rascunho de ${destinationName} não terminou de montar `
        + `(entradas na tela de criação: ${entradas}, recargas pedidas: ${recargas}).`,
    ).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  }).toPass({ timeout: romaneioDraftTimeoutMs })
}

async function expectRouteHidden(page: import('@playwright/test').Page, href: string) {
  await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0)
}

test('quem nao entrou volta à tela protegida depois do login', async ({ page }) => {
  await page.goto('/sobras')

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsobras$/)
  await expect(page.getByRole('heading', { name: 'Pane & Salute' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
})

test('link de uma parcela preserva a compra e a parcela até o login', async ({ page }) => {
  await page.goto('/contas-pagar?purchase=compra-teste&installment=parcela-teste')

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fcontas-pagar%3Fpurchase%3Dcompra-teste%26installment%3Dparcela-teste$/)
})

test('administrador encontra JC e JA ao registrar Sobras', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/sobras')

  await expect(page.getByRole('heading', { name: /O que registrar/ })).toBeVisible()
  await page.getByText('Registrar Sobras', { exact: true }).click()

  const storeSelector = page.locator('.ps-card', { hasText: 'Loja:' }).locator('select.ps-select')
  await expect(storeSelector).toBeVisible()
  await expect(storeSelector.locator('option')).toHaveText([
    'JC — Júlio de Castilhos',
    'JA — Jardim América',
  ])
})

test('Cozinha JC entra na tela concedida para a propria funcao', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.cozinhaJc)

  await expect(page).toHaveURL(/\/producao-cozinha$/)
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible()
  await expect(
    page.getByRole('banner').getByText('Cozinha JC Teste', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Sem acesso ao lançamento', { exact: true })).toHaveCount(0)
})

test('Geolar recebe o cenario de sobras e fica bloqueada ate conferir', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.geolarJc)

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Confira as sobras antes da produção' })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })

  await page.getByRole('button', { name: 'Conferir sobras e reaproveitamento' }).click()
  await expect(page).toHaveURL(/\/sobras\/pendencias\?date=/)
  await expect(page.getByText('Conferir reaproveitamento', { exact: true })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  const reuseCard = page.locator('.ps-reuse-card', { hasText: '[TESTE] Baguete' }).first()
  await expect(reuseCard).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(reuseCard.getByRole('button', { name: 'Recusar reaproveitamento' })).toBeVisible()
  // Este smoke test é somente de leitura: confirmar aqui consome o cenário compartilhado do Preview.
})

test('Vendas JA entra no Romaneio e ve somente as rotas aprovadas', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByText('Romaneios', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('banner').getByText('Vendas JA Teste', { exact: true }),
  ).toBeVisible()

  for (const route of [
    '/romaneio',
    '/fechamento-caixa',
    '/sobras',
    '/encomendas',
    '/estoque-congelado',
  ]) {
    await expectRouteVisible(page, route)
  }

  for (const route of [
    '/producao-cozinha',
    '/compras',
    '/pedidos-pj',
    '/relatorios',
    '/admin/usuarios',
    '/contas-pagar',
    '/financeiro',
  ]) {
    await expectRouteHidden(page, route)
  }

  await expect(page.getByRole('button', { name: 'Novo Romaneio' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Conferir chegada/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Aprovar diverg/ })).toHaveCount(0)
  const exTrip = romaneioCardByObs(page, '[TESTE] viagem EX visivel para a entregadora')
  await expect(exTrip).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(exTrip.getByRole('button', { name: /Marcar Enviado/ })).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/romaneio$/)
})

test('Romaneio EX sugere reposicao pendente da mesma data', async ({ page }) => {
  // O recipiente tem de caber o que as esperas de dentro declaram, senão o
  // orçamento delas é ficção: eram 60s com login, painel e rascunho somando
  // mais que isso lá dentro, então o rascunho nunca chegava a gastar o próprio
  // limite e a falha saía como "Test timeout of 60000ms exceeded" (medido na
  // main em 28/08). Conta operacional: 15s de login + 30s de carga inicial
  // (duas rodadas de consultas) + 60s de rascunho + 15s de margem = 120s.
  // Não é a soma dos máximos teóricos do aplicativo, que seria bem maior:
  // supabaseRestFetch admite 15s em getSession E mais 15s no fetch por
  // chamada. É o teto operacional que não reprova entrega legítima.
  test.setTimeout(120_000)

  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/romaneio')

  // O helper entra pelo "Novo Romaneio" e reentra se a tela for resetada.
  await selectRomaneioDestination(page, '[TESTE] Exposicao')

  // Daqui em diante o rascunho JÁ está montado: card ausente é dado ausente,
  // nunca lentidão. A EX pediu 8 baguetes e as viagens anteriores já levaram
  // 18, então a única coisa que mantém o produto na tela é a reposição aberta
  // do seed (src/lib/romaneioDraft.test.ts fixa essa conta).
  const bagueteCard = page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first()
  await expect(
    bagueteCard,
    'O cenário de reposição da EX não está aberto no Banco Preview: os dados fictícios foram consumidos ou são de outro dia. Rode de novo o workflow "Banco Preview" desta PR antes de investigar o código.',
  ).toBeVisible({ timeout: 5_000 })

  await expect(bagueteCard.getByText('Reposição pendente: +2 un')).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(bagueteCard.locator('input.ps-qty')).toHaveValue('2')

  await bagueteCard.locator('input.ps-qty').fill('3')
  await expect(
    bagueteCard.getByText('Enviando 1 un acima do pedido + pendência'),
  ).toBeVisible()
})

test('Romaneio EX abre conferencia pendente da propria loja', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.romaneioEx)

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(
    page.getByRole('banner').getByText('Romaneio EX Teste', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo Romaneio' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Marcar Enviado/ })).toHaveCount(0)

  const exPendingTrip = romaneioCardByObs(page, '[TESTE] viagem EX pendente de conferencia')
  await expect(exPendingTrip).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(exPendingTrip.getByText('Enviado', { exact: true })).toBeVisible()
  await exPendingTrip.getByRole('button', { name: /Conferir chegada/ }).click()

  await expect(page.getByText('[TESTE] Baguete', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Salvar Confer/ })).toBeVisible()
})

test('Vendas JA nao entra na Producao da Cozinha', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)
  await page.goto('/producao-cozinha')

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toHaveCount(0)
})

test('Financeiro JC registra compra manual paga a vista sem baixar estoque', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')

  await expect(page.getByRole('banner').getByText('Contas a pagar', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Nova compra manual' }).click()
  await page.locator('select').first().selectOption('40000000-0000-4000-8000-000000000001')

  const itemNameInputs = page.locator('input[placeholder^="Ex.:"]')
  await expect(itemNameInputs.first()).toBeVisible()
  await itemNameInputs.first().fill('Manjericão')
  await page.locator('input[type="number"]').nth(0).fill('2')
  await page.locator('input[type="number"]').nth(1).fill('50')
  await page.getByRole('button', { name: 'Adicionar item' }).click()

  await itemNameInputs.nth(1).fill('Tomate cereja')
  await page.locator('input[type="number"]').nth(2).fill('3')
  await page.locator('input[type="number"]').nth(3).fill('50')
  await page.getByLabel('Categoria').selectOption('cmv_materia_prima')
  await page.getByRole('button', { name: 'Registrar conta' }).click()

  const purchaseCard = page.locator('.ps-card', { hasText: 'R$ 250,00' }).first()
  await expect(purchaseCard).toContainText('[TESTE] Fornecedor CEASA JC', { timeout: slowPreviewDataTimeoutMs })
  await expect(purchaseCard.getByText('Paga', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('R$ 250,00', { exact: true })).toBeVisible()
})

test('Financeiro JC visualiza os itens da NF-e sem alterar a conta', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')

  const purchaseCard = page.locator('.ps-card', { hasText: 'NF-e 999001' }).first()
  await expect(purchaseCard).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await purchaseCard.getByRole('button').first().click()
  await purchaseCard.getByRole('button', { name: 'Ver itens da NF-e' }).click()

  await expect(purchaseCard.getByText('[TESTE] Farinha de trigo', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('[TESTE] Manteiga sem sal', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('2 kg · R$ 14,95 cada', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('3 un · R$ 20,00 cada', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('R$ 29,90', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByText('R$ 60,00', { exact: true })).toBeVisible()
  await expect(purchaseCard.getByRole('button', { name: 'Baixar' })).toHaveCount(2)
})

test('Financeiro JC cadastra fornecedor direto da importacao XML', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()

  // A chave precisa ser unica por rodada: o banco recusa NF-e repetida e o
  // Banco Preview guarda o que as rodadas anteriores confirmaram.
  const uniqueCnpj = `99${Date.now().toString().slice(-12)}`
  const uniqueKey = `35${Date.now()}`.padEnd(44, '0')
  // O bloco de totais completo e o que toda NF-e 4.00 autorizada traz; desde a
  // fase 1 das compras por XML, arquivo sem ele e recusado com explicacao.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${uniqueKey}" versao="4.00">
    <ide><nNF>999991</nNF><serie>1</serie><dhEmi>2026-08-07T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${uniqueCnpj}</CNPJ><xNome>[TESTE] Fornecedor direto XML</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-XML</cProd><xProd>[TESTE] Item XML</xProd><NCM>17019900</NCM><qCom>1.0000</qCom><uCom>KG</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples('10.00')}</ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag>
  </infNFe>
</NFe>`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'fornecedor-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  })
  await expect(page.getByText('Fornecedor do XML:', { exact: false })).toBeVisible()
  // A composição da nota é lida do XML pelo navegador: nota simples fecha e
  // nenhum aviso de acréscimo aparece.
  await expect(page.getByText('fecha até o centavo', { exact: true })).toBeVisible()
  await expect(page.getByText('ainda não entram pelo XML')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
  await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue('[TESTE] Fornecedor direto XML')
  await expect(page.locator('input[placeholder="CNPJ ou CPF"]')).toHaveValue(uniqueCnpj)
  await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
  await expect(page.locator('select.ps-select').first()).not.toHaveValue('')

  // Nota simples continua entrando no banco como antes da fase 1: a nova trava
  // da composicao nao segura o que create_xml_payable aceita.
  const confirmar = page.getByRole('button', { name: 'Confirmar NF-e' })
  await expect(confirmar).toBeEnabled()
  await confirmar.click()
  await expect(page.locator('.toast', { hasText: 'Conta importada' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(page.locator('.ps-card', { hasText: '[TESTE] Fornecedor direto XML' }).first()).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
})

test('Financeiro JC ve a composicao da NF-e com imposto por fora e a confirmacao explica o bloqueio', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()

  // Mesmo padrao da fixture st-ipi-outras-despesas: ST e IPI no bloco de
  // impostos do item, outras despesas em prod, tudo somado no total. Antes, a
  // pessoa classificava a nota inteira e o banco recusava no fim sem dizer o
  // que fazer.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35260807999999999999550010000000093000000093" versao="4.00">
    <ide><nNF>999994</nNF><serie>1</serie><dhEmi>2026-08-07T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>99000000000193</CNPJ><xNome>[TESTE] Fornecedor com ST</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-ST</cProd><xProd>[TESTE] Refrigerante lata</xProd><NCM>22021000</NCM><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>30.00</vUnCom><vProd>30.00</vProd><vOutro>0.50</vOutro><indTot>1</indTot></prod><imposto><ICMS><ICMS10><vICMSST>1.50</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>1.00</vIPI></IPITrib></IPI></imposto></det>
    <det nItem="2"><prod><cProd>TESTE-ST2</cProd><xProd>[TESTE] Farinha saco</xProd><NCM>11010010</NCM><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>90.00</vUnCom><vProd>90.00</vProd><vOutro>1.00</vOutro><indTot>1</indTot></prod><imposto><ICMS><ICMS10><vICMSST>1.50</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>1.00</vIPI></IPITrib></IPI></imposto></det>
    <total><ICMSTot><vProd>120.00</vProd><vDesc>0.00</vDesc><vST>3.00</vST><vFCPST>0.00</vFCPST><vIPI>2.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>1.50</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>126.50</vNF></ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>126.50</vPag></detPag></pag>
  </infNFe>
</NFe>`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'st-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  })

  await expect(page.getByText('fecha até o centavo', { exact: true })).toBeVisible()
  await expect(page.getByText('produtos R$ 120,00 · acréscimos R$ 6,50 · total R$ 126,50')).toBeVisible()
  await page.getByText('Ver a conta da nota').click()
  await expect(page.getByText('ICMS substituição tributária', { exact: true })).toBeVisible()
  await expect(page.getByText('IPI', { exact: true })).toBeVisible()
  await expect(page.getByText('Outras despesas', { exact: true })).toBeVisible()
  await expect(page.getByText('R$ 6,50 de acréscimos ainda não entram pelo XML')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar NF-e' })).toBeDisabled()

  // O XML minimo que os smokes usavam antes da fase 1 (so vNF no bloco de
  // totais) nao e uma NF-e autorizada: passa a ser recusado dizendo o que falta,
  // em vez de deixar a pessoa classificar tudo e descobrir na recusa do banco.
  const xmlIncompleto = xml
    .replace(/<total><ICMSTot>[\s\S]*?<\/ICMSTot><\/total>/, '<total><ICMSTot><vNF>126.50</vNF></ICMSTot></total>')
    .replace('000000093000000093', '000000094000000094')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'incompleto-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xmlIncompleto),
  })
  await expect(page.getByText('caso sem regra', { exact: true })).toBeVisible()
  await expect(page.getByText('O bloco de totais da nota não informa vProd, vDesc, vST')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar NF-e' })).toBeDisabled()
})

test('Vendas JA nao entra no livro financeiro', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)
  await page.goto('/financeiro')

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByText('livro de entradas e saídas')).toHaveCount(0)
})

test('Financeiro JC lanca uma saida avulsa e estorna sem apagar o original', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/financeiro')

  await expect(page.getByText('livro de entradas e saídas')).toBeVisible()

  // O Banco Preview nao e limpo entre execucoes: cada rodada precisa de textos
  // proprios, senao a rodada seguinte encontra varios lancamentos iguais e nao
  // sabe qual conferir. O carimbo vale para a descricao E para o motivo.
  const carimbo = Date.now()
  const descricao = `[TESTE] diaria ${carimbo}`
  const motivo = `[TESTE] estorno ${carimbo}`

  await page.getByRole('button', { name: 'Novo lançamento' }).click()
  await page.locator('#finance-category').selectOption('mao_obra_diarias')
  await page.locator('#finance-amount').fill('150,00')
  await page.locator('#finance-store').selectOption('jc')
  await page.locator('#finance-account').selectOption('caixa_fisico_jc')
  await page.locator('#finance-description').fill(descricao)
  await page.getByRole('button', { name: 'Salvar lançamento' }).click()

  // Toda conferencia olha somente os cartoes desta rodada; o livro guarda o
  // que as rodadas anteriores lancaram.
  const cartoes = page.locator('article', { hasText: descricao })
  await expect(cartoes).toHaveCount(1, { timeout: slowPreviewDataTimeoutMs })
  await expect(cartoes.first()).toContainText('− R$ 150,00')

  // O estorno pergunta o motivo por window.prompt; sem resposta ele nao acontece.
  page.once('dialog', dialog => void dialog.accept(motivo))
  await cartoes.first().getByRole('button', { name: 'Estornar' }).click()

  // O original continua no livro, marcado, e o contra-lancamento aparece ao
  // lado — devolvendo o dinheiro, com o sinal invertido.
  await expect(cartoes).toHaveCount(2, { timeout: slowPreviewDataTimeoutMs })
  await expect(cartoes.first()).toContainText('Estorno de:')
  await expect(cartoes.first()).toContainText('+ R$ 150,00')
  await expect(cartoes.last()).toContainText(`Estornado · motivo: ${motivo}`)
  await expect(cartoes.last().getByRole('button', { name: 'Estornar' })).toHaveCount(0)
})

test('Financeiro JC reconhece o insumo e confere a embalagem antes de importar', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()

  // Caixa de 2 kg comprada em CX, insumo cobrado em kg: e o formato que fez
  // farinha de saco de 25 kg virar R$ 74,00 o quilo em producao.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35260807999999999999550010000000091000000091" versao="4.00">
    <ide><nNF>999992</nNF><serie>1</serie><dhEmi>2026-08-07T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>99000000000191</CNPJ><xNome>[TESTE] Fornecedor conversao</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-CONV</cProd><xProd>MANJERICAO DESIDRATADO CAIXA 2KG TESTE</xProd><NCM>17019900</NCM><qCom>3.0000</qCom><uCom>CX</uCom><vUnCom>60.00</vUnCom><vProd>180.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples('180.00')}</ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>180.00</vPag></detPag></pag>
  </infNFe>
</NFe>`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'conversao-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  })

  const cartao = page.locator('.ps-card').filter({ hasText: 'MANJERICAO DESIDRATADO CAIXA 2KG TESTE' }).first()
  await expect(cartao.getByText('item novo', { exact: true })).toBeVisible()

  // A busca ja abre na primeira palavra util da descricao da NF-e.
  const busca = page.getByLabel('Procurar item-base para MANJERICAO DESIDRATADO CAIXA 2KG TESTE')
  await expect(busca).toHaveValue('MANJERICAO')

  await page.getByRole('button', { name: '[TESTE] Manjericão · kg' }).click()
  await expect(cartao.getByText('confira a embalagem', { exact: true })).toBeVisible()

  // O tamanho estava escrito na propria nota; o sistema le e propoe.
  await expect(page.getByText('A nota diz "2KG"')).toBeVisible()
  await page.getByRole('button', { name: 'Usar 2 kg' }).click()

  await expect(cartao.getByText('confira a embalagem', { exact: true })).toHaveCount(0)
  await expect(cartao.getByText('vinculado agora', { exact: true })).toBeVisible()
})

test('Financeiro JC cadastra item novo mesmo quando a busca acha parente', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()

  // "MANJERICAO" acha o insumo semeado, mas nao e ele que serve aqui: esconder
  // o cadastro quando ha QUALQUER resultado deixava a pessoa sem saida.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35260807999999999999550010000000092000000092" versao="4.00">
    <ide><nNF>999993</nNF><serie>1</serie><dhEmi>2026-08-07T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>99000000000192</CNPJ><xNome>[TESTE] Fornecedor parente</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-PAR</cProd><xProd>MANJERICAO FRESCO MACO TESTE</xProd><NCM>17019900</NCM><qCom>2.0000</qCom><uCom>UN</uCom><vUnCom>5.00</vUnCom><vProd>10.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples('10.00')}</ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag>
  </infNFe>
</NFe>`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'parente-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  })

  await expect(page.getByRole('button', { name: '[TESTE] Manjericão · kg' })).toBeVisible()
  await expect(page.getByText('Nenhum desses serve?')).toBeVisible()
  await page.getByRole('button', { name: 'Cadastrar item novo' }).click()

  // O nome ja vem da NF-e, e a opcao de marcar deixa trocar por um nome generico.
  const nome = page.locator('input[placeholder="Ex.: Creme de confeiteiro insumo"]')
  await expect(page.getByText('Usar o mesmo nome da NF-e')).toBeVisible()
  await expect(nome).toHaveValue('MANJERICAO FRESCO MACO TESTE')
  await page.getByText('Usar o mesmo nome da NF-e').click()
  await expect(nome).toBeEnabled()
})

// --- Fase 2 das compras por XML: importacao pendente de conferencia ---------
//
// O rascunho vive numa tabela nova (payable_import_drafts). O smoke do CI roda
// contra o PaneERP Preview compartilhado, que espelha a main: enquanto a PR nao
// for integrada, a tabela nao existe la e estes cenarios pulam com o motivo
// explicito, em vez de fingir aprovacao. A prova real da PR e feita no preview
// isolado dela, que tem o banco com a migration. Depois do merge, o banco
// compartilhado ganha a tabela e os cenarios passam a rodar de verdade aqui.

function previewApi(): { url: string; anonKey: string } {
  // Rodando contra o preview isolado de uma PR (banco proprio), o alvo vem do
  // ambiente; no CI e no dev local vale o PaneERP Preview do .env.example.
  if (process.env.SMOKE_SUPABASE_URL && process.env.SMOKE_SUPABASE_ANON_KEY) {
    return { url: process.env.SMOKE_SUPABASE_URL, anonKey: process.env.SMOKE_SUPABASE_ANON_KEY }
  }
  const env = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')
  const read = (name: string) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? ''
  return { url: read('NEXT_PUBLIC_SUPABASE_URL'), anonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY') }
}

// O token da sessao aberta no navegador: e com ele que a Data API decide, pela
// RLS e pelos grants, o que a pessoa logada pode ler e escrever.
async function sessionAccessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? ''
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }
        return parsed.access_token ?? ''
      }
    }
    return ''
  })
}

async function dataApiHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const api = previewApi()
  const token = await sessionAccessToken(page)
  expect(token, 'a sessao do navegador precisa ter um token para falar com a Data API').not.toBe('')
  return { apikey: api.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function skipWithoutImportDraftsTable(page: import('@playwright/test').Page, headers: Record<string, string>) {
  const probe = await page.request.get(`${previewApi().url}/rest/v1/payable_import_drafts?select=id&limit=1`, { headers })
  test.skip(probe.status() === 404, 'A tabela de rascunhos de importacao ainda nao existe neste banco (PR sem merge); a prova desta PR e feita no preview isolado dela.')
  expect(probe.ok(), `a Data API respondeu ${probe.status()} ao consultar rascunhos`).toBe(true)
}

function nfeXmlDeUmItem(uniqueKey: string, uniqueCnpj: string, numero: string, fornecedor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${uniqueKey}" versao="4.00">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${uniqueCnpj}</CNPJ><xNome>${fornecedor}</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-RASCUNHO</cProd><xProd>[TESTE] Detergente 5L</xProd><NCM>34022000</NCM><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples('10.00')}</ICMSTot></total>
    <pag><detPag><tPag>15</tPag><vPag>10.00</vPag></detPag></pag>
    <cobr><dup><nDup>001</nDup><dVenc>2026-10-10</dVenc><vDup>10.00</vDup></dup></cobr>
  </infNFe>
</NFe>`
}

async function importarXmlComFornecedorNovo(page: import('@playwright/test').Page, xml: string, nomeArquivo: string, fornecedor: string) {
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: nomeArquivo, mimeType: 'application/xml', buffer: Buffer.from(xml) })
  await expect(page.getByText('Fornecedor do XML:', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
  await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue(fornecedor)
  await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
  await expect(page.locator('select.ps-select').first()).not.toHaveValue('')
}

test('Financeiro JC salva a NF-e para conferir depois, retoma com a decisao guardada e descarta sem criar conta', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  const headers = await dataApiHeaders(page)
  await skipWithoutImportDraftsTable(page, headers)

  const stamp = Date.now().toString()
  const uniqueCnpj = `98${stamp.slice(-12)}`
  const uniqueKey = `36${stamp}`.padEnd(44, '1')
  const numero = '999992'
  const fornecedor = '[TESTE] Fornecedor rascunho'
  await importarXmlComFornecedorNovo(page, nfeXmlDeUmItem(uniqueKey, uniqueCnpj, numero, fornecedor), 'rascunho.xml', fornecedor)

  // A decisao cara: o item vira uso/despesa. E isso que a retomada precisa preservar.
  await page.getByRole('button', { name: 'Marcar como uso ou despesa' }).click()
  await expect(page.getByText('Uso ou despesa — não entra em receita')).toBeVisible()
  await page.getByRole('button', { name: 'Salvar para conferir depois' }).click()
  await expect(page.locator('.toast', { hasText: 'Importação salva para conferir depois' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })

  const draftCard = page.locator('[data-testid="xml-import-draft"]', { hasText: `NF ${numero}` })
  await expect(draftCard).toHaveCount(1, { timeout: slowPreviewDataTimeoutMs })
  // Nada virou dinheiro: nem na lista de lancamentos, nem no banco.
  await expect(page.locator('.ps-card', { hasText: `NF-e ${numero}` })).toHaveCount(0)
  const contas = await page.request.get(`${previewApi().url}/rest/v1/payable_purchases?select=id&nfe_key=eq.${uniqueKey}`, { headers })
  expect(await contas.json()).toEqual([])

  // Sair e voltar: a retomada rele o XML e reaplica a decisao.
  await page.reload()
  await draftCard.getByRole('button', { name: 'Continuar conferência' }).click()
  await expect(page.getByText('Importação retomada')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(page.getByText('Uso ou despesa — não entra em receita')).toBeVisible()
  await expect(page.locator('select.ps-select').first()).not.toHaveValue('')

  // Reenvio: salvar de novo atualiza o mesmo rascunho em vez de criar outro.
  await page.getByRole('button', { name: 'Salvar para conferir depois' }).click()
  await expect(page.locator('.toast', { hasText: 'Importação salva para conferir depois' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(draftCard).toHaveCount(1, { timeout: slowPreviewDataTimeoutMs })

  // Escrita direta pela Data API e negada mesmo para quem pode importar.
  const direto = await page.request.post(`${previewApi().url}/rest/v1/payable_import_drafts`, {
    headers: { ...headers, Prefer: 'return=minimal' },
    data: { nfe_key: `37${stamp}`.padEnd(44, '2'), supplier_name: 'Direto', nfe_issued_at: '2026-09-10', total_value: 10, xml_content: '<NFe/>' },
  })
  expect([401, 403], `insercao direta respondeu ${direto.status()}`).toContain(direto.status())

  // Descartar pede confirmacao e nao deixa nada no financeiro.
  page.once('dialog', dialog => void dialog.accept())
  await draftCard.getByRole('button', { name: 'Descartar' }).click()
  await expect(page.locator('.toast', { hasText: 'Importação pendente descartada' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(draftCard).toHaveCount(0)
  await expect(page.locator('.ps-card', { hasText: `NF-e ${numero}` })).toHaveCount(0)
})

test('Financeiro JC confirma a NF-e retomada e o rascunho vira conta uma unica vez', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.financeiroJc)
  const headers = await dataApiHeaders(page)
  await skipWithoutImportDraftsTable(page, headers)

  const stamp = Date.now().toString()
  const uniqueCnpj = `97${stamp.slice(-12)}`
  const uniqueKey = `38${stamp}`.padEnd(44, '3')
  const numero = '999993'
  const fornecedor = '[TESTE] Fornecedor confirma rascunho'
  await importarXmlComFornecedorNovo(page, nfeXmlDeUmItem(uniqueKey, uniqueCnpj, numero, fornecedor), 'rascunho-confirma.xml', fornecedor)
  await page.getByRole('button', { name: 'Marcar como uso ou despesa' }).click()
  await page.getByRole('button', { name: 'Salvar para conferir depois' }).click()
  await expect(page.locator('.toast', { hasText: 'Importação salva para conferir depois' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })

  const draftCard = page.locator('[data-testid="xml-import-draft"]', { hasText: `NF ${numero}` })
  await expect(draftCard).toHaveCount(1, { timeout: slowPreviewDataTimeoutMs })
  await draftCard.getByRole('button', { name: 'Continuar conferência' }).click()
  await expect(page.getByText('Importação retomada')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })

  const confirmar = page.getByRole('button', { name: 'Confirmar NF-e' })
  await expect(confirmar).toBeEnabled()
  await confirmar.click()
  await expect(page.locator('.toast', { hasText: 'importad' })).toBeVisible({ timeout: slowPreviewDataTimeoutMs })

  // A conta existe uma vez, e o rascunho saiu da lista de pendentes.
  await expect(page.locator('.ps-card', { hasText: `NF-e ${numero}` }).first()).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(draftCard).toHaveCount(0)
  const contas = await page.request.get(`${previewApi().url}/rest/v1/payable_purchases?select=id&nfe_key=eq.${uniqueKey}`, { headers })
  expect(((await contas.json()) as unknown[]).length).toBe(1)
  const pendentes = await page.request.get(`${previewApi().url}/rest/v1/payable_import_drafts?select=id,status&nfe_key=eq.${uniqueKey}`, { headers })
  expect(await pendentes.json()).toEqual([expect.objectContaining({ status: 'confirmada' })])
})

test('Vendas JA nao enxerga nem salva importacao pendente, nem pela Data API', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.vendasJa)
  const headers = await dataApiHeaders(page)
  await skipWithoutImportDraftsTable(page, headers)

  // A tela nem abre: o perfil e devolvido a rota dele.
  await page.goto('/contas-pagar')
  await expect(page).toHaveURL(/\/romaneio$/)

  // Leitura fora do escopo: a RLS devolve lista vazia, nunca os rascunhos da JC.
  const leitura = await page.request.get(`${previewApi().url}/rest/v1/payable_import_drafts?select=id`, { headers })
  expect(leitura.status()).toBe(200)
  expect(await leitura.json()).toEqual([])

  // Mutacao fora do escopo: a RPC recusa no banco, nao so na tela.
  const salvar = await page.request.post(`${previewApi().url}/rest/v1/rpc/save_xml_import_draft`, {
    headers,
    data: {
      p_access_key: `39${Date.now()}`.padEnd(44, '4'), p_supplier_id: null, p_supplier_name: 'Vendas', p_nfe_number: '1',
      p_nfe_series: '1', p_issue_date: '2026-09-10', p_total_value: 10, p_xml_content: '<NFe/>', p_item_decisions: [], p_installments: [],
    },
  })
  expect([401, 403]).toContain(salvar.status())
  expect(JSON.stringify(await salvar.json())).toContain('Sem permissão para importar XML.')
})
