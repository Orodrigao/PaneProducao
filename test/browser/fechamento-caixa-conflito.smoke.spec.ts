import { expect, test, type Browser, type Page } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

async function probeProtectedClosing(page: Page, request: import('@playwright/test').Request) {
  const url = new URL('/rest/v1/cash_closings?select=stone_amount&limit=1', request.url())
  const headers = await request.allHeaders()
  const probe = await page.request.get(url.toString(), {
    headers: { apikey: headers.apikey, Authorization: headers.authorization },
    maxRedirects: 0,
  })
  const sharedTarget = !process.env.SMOKE_SUPABASE_URL
  test.skip(sharedTarget && probe.status() === 400,
    'A função e as colunas do fechamento protegido ainda não existem neste banco (PR sem merge); a prova desta PR roda no preview isolado dela.')
  expect(probe.ok(), 'Sonda do fechamento: HTTP ' + probe.status()).toBe(true)
}

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

const admin = 'rodrigao+teste@gmail.com'
const vendasJa = 'rodrigao+teste-vendas-ja@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

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
    const request = page.waitForRequest(r => r.url().includes('/rest/v1/cash_closings'))
    await page.goto('/fechamento-caixa')
    // A sonda vem depois da leitura inicial: pular com uma espera de resposta
    // ainda pendente faz o Playwright contar "Test ended" como falha.
    await initial
    await probeProtectedClosing(page, await request)
    await expect(store).toBeEnabled({ timeout: slowPreviewDataTimeoutMs })
    const ja = closingLoaded(page, 'ja')
    await store.selectOption('ja')
    await ja
  } else {
    // Vendas JA cai na propria loja sozinha, sem poder trocar.
    const initial = closingLoaded(page, 'ja')
    const request = page.waitForRequest(r => r.url().includes('/rest/v1/cash_closings'))
    await page.goto('/fechamento-caixa')
    await initial
    await probeProtectedClosing(page, await request)
    await expect(store).toHaveValue('ja')
    await expect(store).toBeDisabled()
  }

  const chosenDay = closingLoaded(page, 'ja', date)
  await page.getByLabel('Data', { exact: true }).fill(date)
  await chosenDay
}

async function openClosingJa(browser: Browser, who: Who, date: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await entrarComSessaoGuardada(page, who === 'admin' ? admin : vendasJa)
  await showClosingJa(page, who, date)
  return { context, page }
}

// Pelo papel e pelo comeco do nome: o rotulo das Observacoes envolve o texto
// da caixa, e a anotacao de "Substituir" cita os campos ("1. Total em
// dinheiro R$ ..."). Busca so por rotulo acharia as Observacoes tambem.
function moneyField(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return page.getByRole('textbox', { name: new RegExp(`^${escaped}`) })
}

function conflictNotice(page: Page) {
  return page.getByRole('region', { name: 'Fechamento já salvo' })
}

// Conta as gravacoes que de fato sairam para o banco: prova que "Cancelar" na
// confirmacao nao grava nada.
function countClosingWrites(page: Page) {
  const writes = { post: 0 }
  page.on('request', request => {
    if (!request.url().includes('/rest/v1/rpc/save_cash_closing')) return
    if (request.method() === 'POST') writes.post += 1
  })
  return writes
}

test('duas pessoas no mesmo caixa: o segundo salvar explica o conflito e nada e gravado por cima sem escolha', async ({ browser }) => {
  // Ate dois logins (quando a conta ainda nao tem sessao guardada), quatro
  // aberturas da tela e a primeira compilacao da rota no `next dev`: o limite
  // padrao de 30s nao cabe.
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
    expect(secondWrites).toEqual({ post: 1 })

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
    expect(secondWrites).toEqual({ post: 2 })

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
