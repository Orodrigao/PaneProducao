import { expect, test, type Browser, type Page } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

// Login espelhado dos outros specs de propósito: importar de um spec vizinho
// acoplaria duas frentes que precisam poder mudar sozinhas.
const admin = 'rodrigao+teste@gmail.com'
const vendasJa = 'rodrigao+teste-vendas-ja@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

async function enterWithPreviewAccount(page: Page, email: string) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

// O Banco Preview e compartilhado e o caixa nao tem como apagar fechamento.
// Cada execucao usa um dia sorteado entre 1990 e 2019: passado (fechamento e
// coisa concluida), longe dos dias semeados em 2026 e sem colidir com outra
// execucao. O fechamento ficticio some no proximo reset do Preview.
function disposableClosingDate(): string {
  const start = Date.UTC(1990, 0, 1)
  const days = Math.floor(Math.random() * 365 * 30)
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10)
}

type Who = 'admin' | 'vendasJa'

// Espera a leitura completa da tela (fechamento do dia e historico) daquela
// loja e, se informada, daquela data. A tela recarrega a cada troca de loja ou
// data e a leitura que chega zera o formulario: preencher antes dela e perder
// o que foi digitado.
function closingLoaded(page: Page, store: string, date?: string) {
  const isClosingRead = (url: string, method: string) =>
    method === 'GET' && url.includes('/rest/v1/cash_closings') && url.includes(`store=eq.${store}`)
  return Promise.all([
    page.waitForResponse(response => isClosingRead(response.url(), response.request().method())
      && response.url().includes(date ? `closing_date=eq.${date}` : 'closing_date=eq.')),
    page.waitForResponse(response => isClosingRead(response.url(), response.request().method())
      && response.url().includes('order=closing_date.desc')),
  ])
}

async function showClosingJa(page: Page, who: Who, date: string) {
  const store = page.getByLabel('Loja')
  if (who === 'admin') {
    const initial = closingLoaded(page, 'jc')
    await page.goto('/fechamento-caixa')
    await initial
    await expect(store).toBeEnabled({ timeout: slowPreviewDataTimeoutMs })
    const ja = closingLoaded(page, 'ja')
    await store.selectOption('ja')
    await ja
  } else {
    // Vendas JA cai na propria loja sozinha, sem poder trocar.
    const initial = closingLoaded(page, 'ja')
    await page.goto('/fechamento-caixa')
    await initial
    await expect(store).toHaveValue('ja')
    await expect(store).toBeDisabled()
  }

  const chosenDay = closingLoaded(page, 'ja', date)
  await page.getByLabel('Data').fill(date)
  await chosenDay
}

async function openClosingJa(browser: Browser, who: Who, date: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await enterWithPreviewAccount(page, who === 'admin' ? admin : vendasJa)
  await showClosingJa(page, who, date)
  return { context, page }
}

function moneyField(page: Page, label: string) {
  return page.getByLabel(label)
}

function conflictNotice(page: Page) {
  return page.getByRole('region', { name: 'Fechamento já salvo' })
}

// Conta as gravacoes que de fato sairam para o banco: prova que "Cancelar" na
// confirmacao nao grava nada.
function countClosingWrites(page: Page) {
  const writes = { patch: 0, post: 0 }
  page.on('request', request => {
    if (!request.url().includes('/rest/v1/cash_closings')) return
    if (request.method() === 'PATCH') writes.patch += 1
    if (request.method() === 'POST') writes.post += 1
  })
  return writes
}

test('duas pessoas no mesmo caixa: o segundo salvar explica o conflito e nada e gravado por cima sem escolha', async ({ browser }) => {
  // Dois logins, quatro aberturas da tela e a primeira compilacao da rota no
  // `next dev`: o limite padrao de 30s nao cabe.
  test.setTimeout(120_000)

  const date = disposableClosingDate()
  const first = await openClosingJa(browser, 'admin', date)
  const second = await openClosingJa(browser, 'vendasJa', date)
  const secondWrites = countClosingWrites(second.page)

  try {
    // As duas telas abriram antes de qualquer gravacao: as duas acham que o
    // fechamento e novo, como no caso real da JC em 08/10/2026.
    for (const { page } of [first, second]) {
      await expect(page.getByRole('button', { name: 'Salvar fechamento' })).toBeEnabled({
        timeout: slowPreviewDataTimeoutMs,
      })
      await expect(page.getByText('Editando fechamento ja salvo')).toHaveCount(0)
    }

    await moneyField(first.page, '1. Total em dinheiro').fill('100')
    await moneyField(first.page, '3. Banrisul credito/debito').fill('50')
    await first.page.getByRole('button', { name: 'Salvar fechamento' }).click()
    await expect(first.page.getByRole('button', { name: 'Atualizar fechamento' })).toBeEnabled({
      timeout: slowPreviewDataTimeoutMs,
    })

    // Segunda pessoa, com a tela antiga, tenta criar o mesmo fechamento.
    await moneyField(second.page, '1. Total em dinheiro').fill('200')
    await moneyField(second.page, '3. Banrisul credito/debito').fill('80')
    await second.page.getByRole('button', { name: 'Salvar fechamento' }).click()

    const secondNotice = conflictNotice(second.page)
    await expect(secondNotice).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
    await expect(secondNotice).toContainText('salvou este fechamento')
    await expect(secondNotice).toContainText('Os números da sua tela ainda não foram gravados.')
    await expect(secondNotice).toContainText('150,00')
    await expect(secondNotice).toContainText('280,00')
    // Campo a campo: so o que diverge aparece.
    await expect(secondNotice).toContainText('1. Total em dinheiro')
    await expect(secondNotice).toContainText('3. Banrisul credito/debito')
    await expect(secondNotice).not.toContainText('5. SiTef')
    await expect(second.page.getByText('duplicate key')).toHaveCount(0)
    await expect(moneyField(second.page, '1. Total em dinheiro')).toHaveValue('200')
    expect(secondWrites).toEqual({ patch: 0, post: 1 })

    // Desistir na confirmacao nao grava nada.
    const replaceButton = secondNotice.getByRole('button', { name: 'Substituir pelos meus números' })
    second.page.once('dialog', dialog => dialog.dismiss())
    await replaceButton.click()
    await expect(replaceButton).toBeEnabled()
    await expect(secondNotice).toBeVisible()

    // Confirmar substitui, de proposito.
    second.page.once('dialog', dialog => dialog.accept())
    await replaceButton.click()
    await expect(secondNotice).toHaveCount(0, { timeout: slowPreviewDataTimeoutMs })
    await expect(second.page.getByRole('button', { name: 'Atualizar fechamento' })).toBeEnabled({
      timeout: slowPreviewDataTimeoutMs,
    })
    expect(secondWrites).toEqual({ patch: 1, post: 1 })

    // Relido do banco: os numeros da segunda pessoa, com o que foi substituido
    // anotado nas observacoes.
    await showClosingJa(second.page, 'vendasJa', date)
    await expect(moneyField(second.page, '1. Total em dinheiro')).toHaveValue('200,00', {
      timeout: slowPreviewDataTimeoutMs,
    })
    await expect(moneyField(second.page, '3. Banrisul credito/debito')).toHaveValue('80,00')
    // O que estava gravado (total e cada campo que mudou) fica anotado.
    await expect(second.page.getByLabel('Observacoes')).toHaveValue(
      /Substituiu o fechamento que .+ salvou em .+: total do dia R\$\s150,00; 1\. Total em dinheiro R\$\s100,00; 3\. Banrisul credito\/debito R\$\s50,00\./,
    )

    // A primeira pessoa ainda esta com a versao dela na tela. Atualizar agora
    // apagaria a substituicao em silencio: a tela precisa recusar e explicar.
    await moneyField(first.page, '3. Banrisul credito/debito').fill('60')
    await first.page.getByRole('button', { name: 'Atualizar fechamento' }).click()

    const firstNotice = conflictNotice(first.page)
    await expect(firstNotice).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
    await expect(firstNotice).toContainText('280,00')
    await expect(firstNotice).toContainText('160,00')

    first.page.once('dialog', dialog => dialog.accept())
    await firstNotice.getByRole('button', { name: 'Ficar com o salvo' }).click()
    await expect(firstNotice).toHaveCount(0, { timeout: slowPreviewDataTimeoutMs })
    await expect(moneyField(first.page, '1. Total em dinheiro')).toHaveValue('200,00', {
      timeout: slowPreviewDataTimeoutMs,
    })
    await expect(moneyField(first.page, '3. Banrisul credito/debito')).toHaveValue('80,00')

    // Relido do banco: continua o que a segunda pessoa escolheu gravar.
    await showClosingJa(first.page, 'admin', date)
    await expect(moneyField(first.page, '3. Banrisul credito/debito')).toHaveValue('80,00', {
      timeout: slowPreviewDataTimeoutMs,
    })
  } finally {
    await first.context.close()
    await second.context.close()
  }
})
