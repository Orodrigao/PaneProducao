import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

// Em 27/10/2026 o cadastro rapido de cinco itens de uma NF-e de revenda foi
// recusado porque os produtos ja existiam com o mesmo nome. O banco explicou
// ("Ja existe um item ativo com esse nome..."), mas a tela so dizia "Nao foi
// possivel criar o item.": o PostgREST devolve a recusa como objeto simples, e
// a tela so lia mensagem de Error. Estes roteiros provam, com o banco de teste
// de verdade, que a recusa aparece com o texto do banco e leva ao cadastro que
// ja existe, nas duas telas que cadastram item: a importacao e os pendentes.

const contas = {
  financeiroJc: 'rodrigao+teste-financeiro-jc@gmail.com',
  vendasJa: 'rodrigao+teste-vendas-ja@gmail.com',
} as const

// Insumo ativo do seed (supabase/seed.sql), na lista de insumos e revenda que o
// Contas a pagar carrega. A NF-e traz exatamente o mesmo nome.
const produtoExistente = { id: '10000000-0000-4000-8000-000000000021', nome: '[TESTE] Manjericão', rotulo: '[TESTE] Manjericão · kg' }
const recusaDoBanco = 'Já existe um item ativo com esse nome. Selecione o cadastro existente na NF-e.'
const dadosDoBancoTimeoutMs = 15_000

function totaisSimples(valor: string): string {
  return `<vProd>${valor}</vProd><vDesc>0.00</vDesc><vST>0.00</vST><vFCPST>0.00</vFCPST><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>${valor}</vNF>`
}

// Chave, CNPJ, numero e fornecedor unicos por rodada: a nota do segundo
// roteiro e confirmada, o banco recusa chave repetida, e a conta desta rodada
// nao pode ser confundida com a de uma rodada anterior que ficou no banco.
function nfeComItemDeNomeExistente(): { xml: string; chave: string; numero: string; fornecedor: string } {
  const stamp = Date.now().toString()
  const chave = `38${stamp}`.padEnd(44, '4')
  const numero = stamp.slice(-9)
  const fornecedor = `[TESTE] Fornecedor nome repetido ${stamp.slice(-6)}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}" versao="4.00">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-10-27T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>96${stamp.slice(-12)}</CNPJ><xNome>${fornecedor}</xNome></emit>
    <det nItem="1"><prod><cProd>TESTE-REPETIDO</cProd><xProd>${produtoExistente.nome}</xProd><NCM>07099990</NCM><qCom>1.0000</qCom><uCom>KG</uCom><vUnCom>12.00</vUnCom><vProd>12.00</vProd></prod></det>
    <total><ICMSTot>${totaisSimples('12.00')}</ICMSTot></total>
    <pag><detPag><tPag>15</tPag><vPag>12.00</vPag></detPag></pag>
    <cobr><dup><nDup>001</nDup><dVenc>2026-11-27</dVenc><vDup>12.00</vDup></dup></cobr>
  </infNFe>
</NFe>`
  return { xml, chave, numero, fornecedor }
}

// Mesmo alvo da tela: no CI e no dev local, o PaneERP Preview do .env.example.
function previewApi(): { url: string; anonKey: string } {
  const env = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')
  const read = (name: string) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? ''
  return { url: read('NEXT_PUBLIC_SUPABASE_URL'), anonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY') }
}

// Com o token da sessao aberta, a Data API decide pela RLS o que a conta pode.
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

// Limpeza que roda mesmo se o roteiro falhar depois de confirmar a nota: a
// conta ficticia aberta e cancelada pela mesma funcao do botao da tela.
async function cancelarSeAberta(page: Page, chave: string) {
  const headers = await cabecalhosDaSessao(page)
  const { url } = previewApi()
  const resposta = await page.request.get(`${url}/rest/v1/payable_purchases?select=id,status&nfe_key=eq.${chave}`, { headers })
  if (!resposta.ok()) return
  for (const conta of (await resposta.json()) as { id: string; status: string }[]) {
    if (conta.status !== 'aberta') continue
    await page.request.post(`${url}/rest/v1/rpc/cancel_manual_payable`, {
      headers,
      data: { p_purchase_id: conta.id, p_reason: 'Limpeza do teste de navegador do nome repetido' },
    })
  }
}

async function abrirImportacao(page: Page, xml: string) {
  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'nome-repetido.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) })
  await expect(page.getByText('Fornecedor do XML:', { exact: false })).toBeVisible()
}

// O cadastro rapido so chega ao banco com categoria da lista; a recusa por
// nome vem depois dessa conferencia (create_payable_catalog_product).
async function escolherCategoriaInsumos(formulario: import('@playwright/test').Locator) {
  const categoria = formulario.locator('select.ps-select')
  await expect(categoria.locator('option', { hasText: 'Insumos' })).toHaveCount(1, { timeout: dadosDoBancoTimeoutMs })
  await categoria.selectOption({ label: 'Insumos' })
}

test('Financeiro JC ve a recusa do banco e a busca pronta quando o item da NF-e ja tem cadastro', async ({ page }) => {
  await entrarComSessaoGuardada(page, contas.financeiroJc)
  await abrirImportacao(page, nfeComItemDeNomeExistente().xml)

  await page.getByRole('button', { name: 'Cadastrar item novo' }).click()
  const formulario = page.locator('.ps-banner', { hasText: 'Nome do novo item-base' })
  await expect(formulario.locator('input[placeholder="Ex.: Creme de confeiteiro insumo"]')).toHaveValue(produtoExistente.nome)
  await escolherCategoriaInsumos(formulario)
  await formulario.getByRole('button', { name: 'Criar e vincular' }).click()

  // A explicacao fica fixa na escolha 1, e nao num aviso que some.
  await expect(page.getByRole('alert').filter({ hasText: recusaDoBanco })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
  await expect(page.getByText('Não foi possível criar o item.')).toHaveCount(0)
  await expect(page.getByLabel(`Procurar item-base para ${produtoExistente.nome}`)).toHaveValue(produtoExistente.nome)

  // A saida e o cadastro que ja existe: escolhido, o item fica vinculado.
  await page.getByRole('button', { name: produtoExistente.rotulo }).click()
  const cartao = page.locator('.ps-card').filter({ hasText: `1. ${produtoExistente.nome}` }).first()
  await expect(cartao.getByText('vinculado agora', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: recusaDoBanco })).toHaveCount(0)
})

test('Financeiro JC ve a recusa do banco e o cadastro existente escolhido nos itens pendentes', async ({ page }) => {
  await entrarComSessaoGuardada(page, contas.financeiroJc)
  const { xml, chave, numero, fornecedor } = nfeComItemDeNomeExistente()
  await abrirImportacao(page, xml)
  await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
  await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue(fornecedor)
  await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
  await expect(page.locator('select.ps-select').first()).not.toHaveValue('')

  try {
    await recusaNosPendentes(page, numero, fornecedor)
  } finally {
    await cancelarSeAberta(page, chave)
  }
})

async function recusaNosPendentes(page: Page, numero: string, fornecedor: string) {
  // A nota entra com o item pendente; e la que o cadastro rapido e repetido.
  await page.getByRole('button', { name: 'Confirmar NF-e' }).click()
  await expect(page.locator('.toast', { hasText: 'Há itens aguardando classificação' })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })

  const conta = page.locator('.ps-card', { hasText: `NF-e ${numero}` }).filter({ hasText: fornecedor }).first()
  await expect(conta).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
  await conta.click()
  await conta.getByRole('button', { name: 'Classificar itens pendentes' }).click()
  const fechar = page.getByRole('button', { name: 'Fechar classificação' })
  const pendentes = page.locator('.ps-banner').filter({ has: fechar })
  await expect(pendentes).toBeVisible({ timeout: dadosDoBancoTimeoutMs })

  await pendentes.getByRole('button', { name: 'Cadastrar item novo' }).click()
  const formulario = pendentes.locator('.ps-banner', { hasText: 'Cadastro rápido do produto' })
  await expect(formulario.locator('input.ps-input').first()).toHaveValue(produtoExistente.nome)
  await escolherCategoriaInsumos(formulario)
  await formulario.getByRole('button', { name: 'Criar e selecionar' }).click()

  await expect(pendentes.getByRole('alert').filter({ hasText: recusaDoBanco })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
  await expect(page.getByText('Não foi possível criar o item.')).toHaveCount(0)
  // Esta tela nao tem busca: a escolha 1 ja abre no cadastro de mesmo nome.
  await expect(pendentes.locator('select.ps-select').first()).toHaveValue(produtoExistente.id)

  // Sem vincular: o vinculo trocaria o custo do insumo do seed. A conta
  // ficticia e cancelada pela tela; se algo falhar antes, o finally cancela.
  await fechar.click()
  page.once('dialog', dialog => dialog.accept('Fim do teste de navegador do nome repetido'))
  await conta.getByRole('button', { name: 'Cancelar lançamento' }).click()
  await expect(page.locator('.toast', { hasText: 'Conta cancelada' })).toBeVisible({ timeout: dadosDoBancoTimeoutMs })
}

test('Vendas JA continua sem entrar no Contas a pagar', async ({ page }) => {
  await entrarComSessaoGuardada(page, contas.vendasJa)
  await page.goto('/contas-pagar')

  await expect(page).toHaveURL(/\/romaneio$/)
  await expect(page.getByRole('button', { name: 'Importar XML da NF-e' })).toHaveCount(0)
})
