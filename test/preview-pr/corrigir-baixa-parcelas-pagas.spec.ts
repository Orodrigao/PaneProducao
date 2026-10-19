import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, hojeNaPadaria, matriz, type AcessoAoBanco } from './apoio/entrar'

// Contas a pagar: trocar a categoria de uma conta relanca no livro TODAS as
// parcelas ja pagas, cada uma no banco de onde saiu. O Financeiro JC monta pela
// Data API uma conta ficticia de tres boletos (parcela 1 paga com juros pela
// Caixa, parcela 2 pelo Sicredi), corrige pela tela a baixa da parcela 2 trocando
// a categoria (descarta uma vez, confirma), confere no livro, reabre a parcela 1
// (o banco vem do livro, nao da ultima baixa) e baixa a parcela 3 trocando a
// categoria de novo. Vendas JA e Expedicao JC sao barrados na baixa com
// classificacao pela Data API. A conta criada leva uma marca unica da rodada e
// fica no banco desta PR, que some quando a PR fecha.

const TELA = '/contas-pagar'
const FORNECEDOR = '40000000-0000-4000-8000-000000000003' // [TESTE] Moinho, do seed
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function diasAntes(dia: string, dias: number): string {
  const data = new Date(`${dia}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() - dias)
  return data.toISOString().slice(0, 10)
}

function mesPorExtenso(dia: string): string {
  return `${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`
}

async function rpc(page: Page, acesso: AcessoAoBanco, nome: string, corpo: Record<string, unknown>) {
  const resposta = await page.request.post(`${acesso.url}/rest/v1/rpc/${nome}`, {
    headers: await cabecalhosDaSessao(page, acesso),
    data: corpo,
    // O token da sessao nao segue redirecionamento para outro destino.
    maxRedirects: 0,
  })
  return resposta
}

async function rpcOk(page: Page, acesso: AcessoAoBanco, nome: string, corpo: Record<string, unknown>) {
  const resposta = await rpc(page, acesso, nome, corpo)
  const texto = await resposta.text()
  expect(resposta.ok(), `${nome}: ${texto}`).toBe(true)
  return texto ? JSON.parse(texto) as unknown : null
}

async function ler<T>(page: Page, acesso: AcessoAoBanco, caminho: string): Promise<T> {
  const resposta = await page.request.get(`${acesso.url}/rest/v1/${caminho}`, {
    headers: await cabecalhosDaSessao(page, acesso),
    maxRedirects: 0,
  })
  const texto = await resposta.text()
  expect(resposta.ok(), `${caminho}: ${texto}`).toBe(true)
  return JSON.parse(texto) as T
}

type Linha = { amount: number | string; account_id: string | null; category_id: string }

/** O que esta ativo no livro para a parcela: categoria -> valor, e os bancos. */
async function livroDaParcela(page: Page, acesso: AcessoAoBanco, parcela: string) {
  const [linhas, categorias, contas] = await Promise.all([
    ler<Linha[]>(page, acesso, `finance_entries?select=amount,account_id,category_id&source=eq.contas_pagar&source_ref=eq.${parcela}&entry_type=eq.lancamento&reversed_at=is.null`),
    ler<{ id: string; key: string }[]>(page, acesso, 'finance_categories?select=id,key'),
    ler<{ id: string; key: string }[]>(page, acesso, 'finance_accounts?select=id,key'),
  ])
  const chaveDaCategoria = new Map(categorias.map(categoria => [categoria.id, categoria.key]))
  const chaveDaConta = new Map(contas.map(conta => [conta.id, conta.key]))
  const porCategoria: Record<string, number> = {}
  for (const linha of linhas) {
    const chave = chaveDaCategoria.get(linha.category_id) ?? linha.category_id
    porCategoria[chave] = Math.round(((porCategoria[chave] ?? 0) + Number(linha.amount)) * 100) / 100
  }
  const bancos = [...new Set(linhas.map(linha => (linha.account_id ? chaveDaConta.get(linha.account_id) : null) ?? 'nao informada'))]
  return { porCategoria, bancos }
}

async function abrirConta(page: Page, marca: string) {
  await page.goto(TELA)
  const busca = page.getByLabel('Buscar contas a pagar')
  await expect(busca).toBeVisible({ timeout: 20_000 })
  await busca.fill(marca)
  const cabecalho = page.getByRole('button', { name: /\[TESTE\] Moinho/ }).first()
  await expect(cabecalho).toBeVisible({ timeout: 20_000 })
  if ((await cabecalho.getAttribute('aria-expanded')) !== 'true') await cabecalho.click()
  await expect(page.getByText(marca)).toBeVisible()
}

function linhaDaParcela(page: Page, texto: RegExp) {
  return page.locator('.ps-list-row').filter({ hasText: texto })
}

test('Financeiro JC troca a categoria ao corrigir e ao baixar: todas as parcelas pagas seguem, cada uma no seu banco',
  matriz('Financeiro JC', 'JC', 'permitido', 'Corrigir baixa e baixar trocando a categoria (tela)'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const acesso = await entrarComo(page, 'financeiroJc')

    const hoje = hojeNaPadaria()
    const compra = diasAntes(hoje, 40)
    const marca = `[TESTE] relanca parcelas ${Date.now()}`

    const conta = await rpcOk(page, acesso, 'create_manual_payable', {
      p_request_id: crypto.randomUUID(),
      p_supplier_id: FORNECEDOR,
      p_purchase_date: compra,
      p_document_type: 'sem_nota',
      p_payment_method: 'boleto',
      p_notes: marca,
      p_paid: false,
      p_items: [{ product_id: null, item_name: '[TESTE] Farinha em tres boletos', unit: 'kg', quantity: 3, unit_price: 1000 }],
      p_installments: [
        { installment_number: 1, due_date: diasAntes(hoje, 30), amount: 1000 },
        { installment_number: 2, due_date: diasAntes(hoje, 20), amount: 1000 },
        { installment_number: 3, due_date: diasAntes(hoje, 10), amount: 1000 },
      ],
    }) as string
    const parcelas = await ler<{ id: string; installment_number: number }[]>(page, acesso,
      `payable_installments?select=id,installment_number&purchase_id=eq.${conta}&order=installment_number`)
    const [p1, p2, p3] = parcelas.map(parcela => parcela.id)
    const materiaPrima = [{ category_key: 'cmv_materia_prima', amount: 3000 }]

    // Como a tela antiga fazia: classificar e baixar, uma parcela por vez.
    await rpcOk(page, acesso, 'set_payable_finance_classification', { p_purchase_id: conta, p_account_key: 'banco_caixa_jc', p_categories: materiaPrima })
    await rpcOk(page, acesso, 'record_payable_installment_payment', { p_installment_id: p1, p_paid_date: diasAntes(hoje, 28), p_paid_amount: 1030, p_paid_method: 'boleto', p_current_due_date: null })
    await rpcOk(page, acesso, 'set_payable_finance_classification', { p_purchase_id: conta, p_account_key: 'banco_sicredi_jc', p_categories: materiaPrima })
    await rpcOk(page, acesso, 'record_payable_installment_payment', { p_installment_id: p2, p_paid_date: diasAntes(hoje, 18), p_paid_amount: 1000, p_paid_method: 'boleto', p_current_due_date: null })

    // Corrigir a baixa da parcela 2 trocando a categoria para embalagem.
    await abrirConta(page, marca)
    await linhaDaParcela(page, /Parcela 2 · paga em/).getByRole('button', { name: 'Corrigir baixa' }).click()
    let dialogo = page.getByRole('dialog', { name: 'Corrigir baixa' })
    await expect(dialogo).toBeVisible({ timeout: 20_000 })
    await expect(dialogo.locator('#payable-finance-account')).toHaveValue('banco_sicredi_jc')
    await expect(dialogo.getByRole('note')).toHaveCount(0)
    await dialogo.getByLabel('Categoria', { exact: true }).selectOption('cmv_embalagem')
    const aviso = `A categoria vale para a conta inteira: a parcela 1, já paga, também será estornada e relançada na categoria nova, no DRE de ${mesPorExtenso(compra)}. O banco de onde ela saiu não muda.`
    await expect(dialogo.getByRole('note')).toHaveText(aviso)

    // Descartar a confirmacao nao grava nada.
    let mensagem = ''
    page.once('dialog', confirmacao => { mensagem = confirmacao.message(); void confirmacao.dismiss() })
    await dialogo.getByRole('button', { name: 'Confirmar' }).click()
    await expect.poll(() => mensagem).toContain(aviso)
    expect((await livroDaParcela(page, acesso, p1)).porCategoria).toEqual({ cmv_materia_prima: 1000, financeiras: 30 })

    page.once('dialog', confirmacao => void confirmacao.accept())
    await dialogo.getByRole('button', { name: 'Confirmar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Baixa corrigida e registrada no histórico. Parcela 1 relançada na categoria nova.' }))
      .toBeVisible({ timeout: 20_000 })

    const livro1 = await livroDaParcela(page, acesso, p1)
    expect(livro1.porCategoria, 'a parcela 1, ja paga, vai para a categoria nova e o juro fica em Financeiras').toEqual({ cmv_embalagem: 1000, financeiras: 30 })
    expect(livro1.bancos, 'a parcela 1 continua no banco de onde saiu').toEqual(['banco_caixa_jc'])
    const livro2 = await livroDaParcela(page, acesso, p2)
    expect(livro2.porCategoria).toEqual({ cmv_embalagem: 1000 })
    expect(livro2.bancos).toEqual(['banco_sicredi_jc'])

    // Depois de recarregar, a parcela 1 abre com o banco dela, que esta no
    // livro, e nao com o da ultima baixa da conta.
    await page.reload()
    await abrirConta(page, marca)
    await linhaDaParcela(page, /Parcela 1 · paga em/).getByRole('button', { name: 'Corrigir baixa' }).click()
    dialogo = page.getByRole('dialog', { name: 'Corrigir baixa' })
    await expect(dialogo).toBeVisible({ timeout: 20_000 })
    await expect(dialogo.locator('#payable-finance-account')).toHaveValue('banco_caixa_jc')
    await expect(dialogo.getByLabel('Categoria', { exact: true })).toHaveValue('cmv_embalagem')
    await expect(dialogo.getByRole('note')).toHaveCount(0)
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo).toHaveCount(0)

    // Baixar a parcela 3 trocando a categoria: as duas pagas seguem.
    await linhaDaParcela(page, /Parcela 3 ·/).getByRole('button', { name: 'Baixar' }).click()
    dialogo = page.getByRole('dialog', { name: 'Baixar boleto' })
    await expect(dialogo).toBeVisible({ timeout: 20_000 })
    await dialogo.getByLabel('Categoria', { exact: true }).selectOption('cmv_revenda')
    await expect(dialogo.getByRole('note')).toContainText('as parcelas 1 e 2, já pagas, também serão estornadas e relançadas na categoria nova')
    page.once('dialog', confirmacao => void confirmacao.accept())
    await dialogo.getByRole('button', { name: 'Confirmar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Boleto baixado. Parcelas 1 e 2 relançadas na categoria nova.' }))
      .toBeVisible({ timeout: 20_000 })

    const final1 = await livroDaParcela(page, acesso, p1)
    const final2 = await livroDaParcela(page, acesso, p2)
    const final3 = await livroDaParcela(page, acesso, p3)
    expect(final1.porCategoria).toEqual({ cmv_revenda: 1000, financeiras: 30 })
    expect(final2.porCategoria).toEqual({ cmv_revenda: 1000 })
    expect(final3.porCategoria).toEqual({ cmv_revenda: 1000 })
    expect([final1.bancos, final2.bancos, final3.bancos], 'cada parcela no banco de onde saiu')
      .toEqual([['banco_caixa_jc'], ['banco_sicredi_jc'], ['banco_sicredi_jc']])

    await page.reload()
    await abrirConta(page, marca)
    await expect(linhaDaParcela(page, /Parcela 3 · paga em/)).toBeVisible()
  })

for (const [perfil, nome, loja] of [
  ['vendasJa', 'Vendas JA', 'JA'],
  ['expedicaoJc', 'Expedicao JC', 'JC'],
] as const) {
  test(`${nome} e barrado de baixar conta com classificacao na Data API`,
    matriz(nome, loja, 'bloqueado', 'record_payable_payment_and_classification (Data API)'),
    async ({ page }) => {
      const acesso = await entrarComo(page, perfil)
      const resposta = await rpc(page, acesso, 'record_payable_payment_and_classification', {
        p_installment_id: crypto.randomUUID(),
        p_paid_date: hojeNaPadaria(),
        p_paid_amount: 1000,
        p_paid_method: 'boleto',
        p_current_due_date: null,
        p_account_key: 'banco_caixa_jc',
        p_categories: [{ category_key: 'cmv_revenda', amount: 3000 }],
      })
      const corpo = await resposta.text()
      expect(resposta.status(), corpo).toBe(403)
      expect(JSON.parse(corpo)).toMatchObject({ code: '42501' })
    })
}
