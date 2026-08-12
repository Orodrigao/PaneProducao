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

const slowPreviewDataTimeoutMs = 15_000

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

// A aba do destino aparece antes de o Romaneio terminar de carregar os dados do
// dia. Quando a carga termina, a lista de abas e redesenhada e o clique cai num
// elemento que ja saiu da tela ("element was detached from the DOM"). Clicar ate
// a aba ficar selecionada absorve esse redesenho sem esconder falha real: se a
// aba nunca selecionar, o teste falha no tempo limite.
//
// Os cards de produto tem o mesmo problema em outra forma: eles so montam quando
// a carga do destino termina, e cada consulta dessa carga desiste sozinha em 15s
// (DEFAULT_REQUEST_TIMEOUT_MS). Se uma consulta falha ou estoura o tempo, a tela
// mostra "Erro" e fica vazia — so um novo clique na aba dispara nova carga, o
// mesmo gesto de uma pessoa. Por isso o clique se repete ate o card-evidencia
// aparecer, com teto proprio: se o card nunca montar, o teste falha do mesmo jeito.
const romaneioCardRetryTimeoutMs = 30_000

async function selectRomaneioDestination(
  page: import('@playwright/test').Page,
  name: RegExp,
  dataReadyCard?: import('@playwright/test').Locator,
) {
  const tab = page.getByRole('tab', { name })
  await expect(tab).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(async () => {
    await tab.click({ timeout: 5_000 })
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 })
    if (dataReadyCard) await expect(dataReadyCard).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: dataReadyCard ? romaneioCardRetryTimeoutMs : slowPreviewDataTimeoutMs })
}

async function expectRouteHidden(page: import('@playwright/test').Page, href: string) {
  await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0)
}

test('quem nao entrou e levado ao login ao abrir uma tela protegida', async ({ page }) => {
  await page.goto('/sobras')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Pane & Salute' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
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

test('Romaneio EX mostra reposicao pendente sem alterar quantidade do card', async ({ page }) => {
  await enterWithPreviewAccount(page, previewAccounts.admin)
  await page.goto('/romaneio')

  await page.getByRole('button', { name: 'Novo Romaneio' }).click()
  const bagueteCard = page.locator('.ps-card', { hasText: '[TESTE] Baguete' }).first()
  await selectRomaneioDestination(page, /\[TESTE\] Exposicao/, bagueteCard)

  await expect(bagueteCard.getByText('Reposição pendente: +2 un')).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })
  await expect(bagueteCard.locator('input.ps-qty')).toHaveValue('')

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
