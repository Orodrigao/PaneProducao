import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

// Compras fase 3B: na entrada da NF-e, o custo de cada cadastro e comparado com
// o da ultima compra do mesmo cadastro. A prova usa o banco de teste de verdade:
// a nota A entra com tomate a R$ 5,00/kg e manjericao a R$ 10,00/kg; a nota B,
// do mesmo fornecedor e emitida depois, traz o tomate a R$ 6,00/kg (+20%) e o
// manjericao no mesmo preco. Na B, so o tomate acusa alta; depois de
// confirmada, a alta aparece no quadro do Contas a pagar.
//
// Confirmar as notas troca o custo dos dois insumos do seed (o cancelamento
// nao desfaz custo, desde a fase 3A). O efeito fica igual a cada rodada:
// tomate R$ 6,00/kg e manjericao R$ 10,00/kg, e nenhum outro roteiro confere
// o custo desses dois cadastros.

const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const tomate = { nome: '[TESTE] Tomate cereja', rotulo: '[TESTE] Tomate cereja · kg' }
const manjericao = { nome: '[TESTE] Manjericão', rotulo: '[TESTE] Manjericão · kg' }
const dadosDoBancoTimeoutMs = 15_000

function totaisSimples(valor: string): string {
  return `<vProd>${valor}</vProd><vDesc>0.00</vDesc><vST>0.00</vST><vFCPST>0.00</vFCPST><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>${valor}</vNF>`
}

/** Data e hora de Brasilia no formato do dhEmi, para o instante dado. */
function dhEmiBrasilia(instante: number): string {
  return `${new Date(instante - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`
}

/** Vencimento 30 dias depois da emissao: a importacao recusa vencimento antes da emissao. */
function vencimento(instante: number): string {
  return new Date(instante - 3 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10)
}

interface NotaFicticia { xml: string; chave: string; numero: string }

// Chave, numero e fornecedor unicos por rodada: o banco recusa chave repetida,
// e a memoria do fornecedor de uma rodada anterior nao pode decidir esta. A
// nota B nasce um segundo depois da A, e as duas depois de qualquer sobra de
// rodada anterior que tenha ficado sem cancelar.
function notasDaRodada(): { a: NotaFicticia; b: NotaFicticia; fornecedor: string; cnpj: string } {
  const stamp = Date.now().toString()
  const fornecedor = `[TESTE] Fornecedor alta de custo ${stamp.slice(-6)}`
  const cnpj = `95${stamp.slice(-12)}`
  const agora = Date.now()
  const nota = (sufixo: string, instante: number, precoTomate: string, totalTomate: string, total: string): NotaFicticia => {
    const chave = `39${stamp}${sufixo}`.padEnd(44, '7')
    const numero = `${stamp.slice(-8)}${sufixo}`
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}" versao="4.00">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>${dhEmiBrasilia(instante)}</dhEmi></ide>
    <emit><CNPJ>${cnpj}</CNPJ><xNome>${fornecedor}</xNome></emit>
    <det nItem="1"><prod><cProd>ALTA-TOMATE</cProd><xProd>TOMATE CEREJA ALTA DE CUSTO</xProd><NCM>07020000</NCM><qCom>10.0000</qCom><uCom>KG</uCom><vUnCom>${precoTomate}</vUnCom><vProd>${totalTomate}</vProd></prod></det>
    <det nItem="2"><prod><cProd>ALTA-MANJERICAO</cProd><xProd>MANJERICAO ALTA DE CUSTO</xProd><NCM>07099990</NCM><qCom>2.0000</qCom><uCom>KG</uCom><vUnCom>10.00</vUnCom><vProd>20.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples(total)}</ICMSTot></total>
    <pag><detPag><tPag>15</tPag><vPag>${total}</vPag></detPag></pag>
    <cobr><dup><nDup>001</nDup><dVenc>${vencimento(instante)}</dVenc><vDup>${total}</vDup></dup></cobr>
  </infNFe>
</NFe>`
    return { xml, chave, numero }
  }
  return {
    a: nota('1', agora - 2_000, '5.00', '50.00', '70.00'),
    b: nota('2', agora - 1_000, '6.00', '60.00', '80.00'),
    fornecedor,
    cnpj,
  }
}

// Mesmo alvo da tela: no CI e no dev local, o PaneERP Preview do .env.example.
function previewApi(): { url: string; anonKey: string } {
  const env = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')
  const read = (name: string) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? ''
  return { url: read('NEXT_PUBLIC_SUPABASE_URL'), anonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY') }
}

async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const { origins } = await page.context().storageState()
  let token = ''
  for (const { localStorage } of origins) {
    const item = localStorage.find(({ name }) => name.startsWith('sb-') && name.endsWith('-auth-token'))
    if (item) token = (JSON.parse(item.value) as { access_token?: string }).access_token ?? ''
  }
  expect(token, 'a sessao do navegador precisa ter um token para falar com a Data API').not.toBe('')
  return { apikey: previewApi().anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// Limpeza que roda mesmo se o roteiro falhar: as contas ficticias abertas sao
// canceladas pela mesma funcao do botao da tela, e conta cancelada sai da
// comparacao de custo da rodada seguinte. Devolve o que nao conseguiu limpar,
// relido depois do cancelamento, para o roteiro nao passar deixando conta aberta.
async function cancelarSeAbertas(page: Page, chaves: string[]): Promise<string[]> {
  const sobras: string[] = []
  let headers: Record<string, string>
  try {
    headers = await cabecalhosDaSessao(page)
  } catch (erro) {
    return chaves.map(chave => `${chave}: sem sessao para limpar (${erro instanceof Error ? erro.message : String(erro)})`)
  }
  const { url } = previewApi()
  const contasDa = async (chave: string) => {
    const resposta = await page.request.get(`${url}/rest/v1/payable_purchases?select=id,status&nfe_key=eq.${chave}`, { headers })
    if (!resposta.ok()) throw new Error(`leitura da NF ${chave} respondeu ${resposta.status()}`)
    return (await resposta.json()) as { id: string; status: string }[]
  }
  for (const chave of chaves) {
    try {
      for (const conta of await contasDa(chave)) {
        if (conta.status !== 'aberta') continue
        const cancelamento = await page.request.post(`${url}/rest/v1/rpc/cancel_manual_payable`, {
          headers,
          data: { p_purchase_id: conta.id, p_reason: 'Limpeza do teste de navegador da alta de custo' },
        })
        if (!cancelamento.ok()) sobras.push(`${chave}: cancelamento respondeu ${cancelamento.status()}`)
      }
      if ((await contasDa(chave)).some(conta => conta.status === 'aberta')) sobras.push(`${chave}: continua aberta`)
    } catch (erro) {
      sobras.push(`${chave}: ${erro instanceof Error ? erro.message : String(erro)}`)
    }
  }
  return sobras
}

async function lerNota(page: Page, nota: NotaFicticia) {
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: `alta-de-custo-${nota.numero}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nota.xml) })
  await expect(page.getByText(`NF ${nota.numero}`, { exact: false })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
}

// O cartao da importacao inteira tambem contem o item; o do item e o mais
// interno, o ultimo na ordem do documento. Sem isso, "o manjericao nao acusa
// alta" passaria a olhar o cartao de fora, que contem a alta do tomate.
function cartaoDoItem(page: Page, linha: string) {
  return page.locator('.ps-card').filter({ has: page.getByText(linha, { exact: true }) }).last()
}

async function vincular(page: Page, descricao: string, busca: string, rotulo: string) {
  const campo = page.getByLabel(`Procurar item-base para ${descricao}`)
  await expect(campo).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
  await campo.fill(busca)
  await page.getByRole('button', { name: rotulo }).first().click()
}

async function confirmarNota(page: Page) {
  await page.getByRole('button', { name: 'Confirmar NF-e' }).click()
  await expect(page.locator('.toast', { hasText: 'NF-e importada.' })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
}

test('Financeiro JC ve a alta de custo do item que subiu e nao ve no item que ficou igual', async ({ page }) => {
  test.setTimeout(180_000)
  await entrarComSessaoGuardada(page, financeiroJc)
  const { a, b, fornecedor } = notasDaRodada()

  let falha: unknown = null
  try {
    // Nota A: fornecedor novo, os dois itens ligados aos insumos do seed.
    await lerNota(page, a)
    await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
    await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue(fornecedor)
    await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
    await expect(page.locator('select.ps-select').first()).not.toHaveValue('')
    await vincular(page, 'TOMATE CEREJA ALTA DE CUSTO', 'Tomate cereja', tomate.rotulo)
    await vincular(page, 'MANJERICAO ALTA DE CUSTO', 'Manjericão', manjericao.rotulo)
    await confirmarNota(page)

    // Nota B: o fornecedor vem pelo CNPJ e os itens pela memoria da nota A.
    await lerNota(page, b)
    const itemTomate = cartaoDoItem(page, '1. TOMATE CEREJA ALTA DE CUSTO')
    const itemManjericao = cartaoDoItem(page, '2. MANJERICAO ALTA DE CUSTO')
    await expect(itemTomate.getByText('reconhecido', { exact: true })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })

    await expect(itemTomate.getByRole('alert').filter({ hasText: 'Custo subiu 20% desde a última compra' })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
    await expect(itemTomate).toContainText(`R$ 5,00 por kg na NF ${a.numero}`)
    await expect(itemTomate).toContainText('Nesta nota: R$ 6,00 por kg')

    await expect(itemManjericao).toContainText(`0% sobre a última compra: R$ 10,00 por kg na NF ${a.numero}`, { timeout: dadosDoBancoTimeoutMs })
    await expect(itemManjericao.getByText('Custo subiu', { exact: false })).toHaveCount(0)
    await expect(itemManjericao.getByText('última compra: confira', { exact: false })).toHaveCount(0)

    const resumo = page.getByRole('status').filter({ hasText: '1 cadastro desta nota subiu de custo' })
    await expect(resumo).toContainText(`${tomate.nome} +20%`)
    await expect(resumo).not.toContainText(manjericao.nome)

    // Confirmada a B, a alta fica no quadro do Contas a pagar.
    const conferir = page.getByRole('button', { name: 'Conferi este vínculo nesta NF-e' })
    await expect(conferir).toHaveCount(2)
    while (await conferir.count() > 0) await conferir.first().click()
    await confirmarNota(page)
    await page.goto('/contas-pagar')
    const quadro = page.locator('.ps-card').filter({ hasText: 'Altas e variações grandes de custo, notas dos últimos 30 dias' }).first()
    const linhaDoQuadro = quadro.locator('li').filter({ hasText: `NF ${b.numero}` })
    await expect(linhaDoQuadro).toContainText(tomate.nome, { timeout: dadosDoBancoTimeoutMs })
    await expect(linhaDoQuadro).toContainText('+20%')
    await expect(linhaDoQuadro).toContainText('R$ 5,00 por kg → R$ 6,00 por kg')
    await expect(quadro.locator('li').filter({ hasText: `NF ${b.numero}` }).filter({ hasText: manjericao.nome })).toHaveCount(0)
  } catch (erro) {
    falha = erro
  }
  const sobras = await cancelarSeAbertas(page, [a.chave, b.chave])
  if (falha) {
    // A falha do roteiro vem primeiro, mas a sobra no banco de teste nao some:
    // fica anotada no relatorio do Playwright.
    if (sobras.length > 0) test.info().annotations.push({ type: 'limpeza incompleta', description: sobras.join('; ') })
    throw falha
  }
  expect(sobras, 'contas ficticias da rodada que ficaram abertas no banco de teste').toEqual([])
})
