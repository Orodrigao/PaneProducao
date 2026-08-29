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

  const uniqueCnpj = `99${Date.now().toString().slice(-12)}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35260807999999999999550010000000011000000010" versao="4.00">
    <ide><nNF>999991</nNF><serie>1</serie><dhEmi>2026-08-07T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${uniqueCnpj}</CNPJ><xNome>[TESTE] Fornecedor direto XML</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-XML</cProd><xProd>[TESTE] Item XML</xProd><NCM>17019900</NCM><qCom>1.0000</qCom><uCom>KG</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>
    <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
    <pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag>
  </infNFe>
</NFe>`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'fornecedor-inline.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  })
  await expect(page.getByText('Fornecedor do XML:', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
  await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue('[TESTE] Fornecedor direto XML')
  await expect(page.locator('input[placeholder="CNPJ ou CPF"]')).toHaveValue(uniqueCnpj)
  await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
  await expect(page.locator('select.ps-select').first()).not.toHaveValue('')
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
    <total><ICMSTot><vNF>180.00</vNF></ICMSTot></total>
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
    <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
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
