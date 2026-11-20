import { expect, test, type Page } from '@playwright/test'
import { cabecalhosDaSessao, entrarComo, matriz, type AcessoAoBanco } from './apoio/entrar'

type Nota = { xml: string; chave: string; numero: string; fornecedor: string }

function digitoVerificador(primeiros: string): string {
  let soma = 0
  for (let i = 42; i >= 0; i--) soma += Number(primeiros[i]) * (2 + (42 - i) % 8)
  const resto = soma % 11
  return String(resto < 2 ? 0 : 11 - resto)
}
function nota(stamp: string, sequencia: number, destinatario = '55800425000177', ambiente = '1'): Nota {
  const cnpj = '95' + stamp.slice(-12).padStart(12, '0')
  const numero = String(Number(stamp.slice(-8)) * 10 + sequencia)
  const primeiros = '432611' + cnpj + '55001' + numero.padStart(9, '0') + '1' + '98100001'
  const dv = digitoVerificador(primeiros)
  const chave = primeiros + dv
  const fornecedor = '[TESTE] Caixa recebidas ' + stamp
  const vencimento = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 30 * 86_400_000))
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe' + chave + '" versao="4.00">' +
    '<ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>' + numero + '</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>' + dv + '</cDV><tpAmb>' + ambiente + '</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide>' +
    '<emit><CNPJ>' + cnpj + '</CNPJ><xNome>' + fornecedor + '</xNome></emit>' +
    '<dest><CNPJ>' + destinatario + '</CNPJ><xNome>[TESTE] Destinatário da caixa</xNome></dest>' +
    '<det nItem="1"><prod><cProd>CAIXA-' + stamp + '</cProd><xProd>[TESTE] EMBALAGEM DA CAIXA</xProd><NCM>21069030</NCM><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>' +
    '<total><ICMSTot><vProd>10.00</vProd><vDesc>0.00</vDesc><vST>0.00</vST><vFCPST>0.00</vFCPST><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vII>0.00</vII><vICMSDeson>0.00</vICMSDeson><vNF>10.00</vNF></ICMSTot></total>' +
    '<pag><detPag><tPag>15</tPag><vPag>10.00</vPag></detPag></pag><cobr><dup><nDup>001</nDup><dVenc>' + vencimento + '</dVenc><vDup>10.00</vDup></dup></cobr>' +
    '</infNFe></NFe><protNFe><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'
  return { xml, chave, numero, fornecedor }
}

async function cancelarSeAberta(page: Page, acesso: AcessoAoBanco, chave: string) {
  const headers = await cabecalhosDaSessao(page, acesso)
  const resposta = await page.request.get(acesso.url + '/rest/v1/payable_purchases?select=id,status&nfe_key=eq.' + chave, { headers, maxRedirects: 0 })
  expect(resposta.ok(), await resposta.text()).toBe(true)
  for (const compra of await resposta.json() as { id: string; status: string }[]) {
    if (compra.status !== 'aberta') continue
    const cancelada = await page.request.post(acesso.url + '/rest/v1/rpc/cancel_manual_payable', {
      headers, data: { p_purchase_id: compra.id, p_reason: 'Limpeza do roteiro da caixa de notas recebidas' }, maxRedirects: 0,
    })
    expect(cancelada.ok(), await cancelada.text()).toBe(true)
  }
}

test('Financeiro recebe um lote, confere e lança pela caixa, com persistência após recarregar',
  matriz('Financeiro JC', 'JC', 'permitido', 'Caixa de notas recebidas'), async ({ page }) => {
    test.setTimeout(115_000)
    const acesso = await entrarComo(page, 'financeiroJc')
    const stamp = Date.now().toString()
    const a = nota(stamp, 1)
    const fora = nota(stamp, 2, '95000000000270')
    const homologacao = nota(stamp, 3, '55800425000177', '2')
    try {
      await page.goto('/contas-pagar')
      await expect(page.locator('[data-caixa-notas="liberada"]')).toBeVisible({ timeout: 20_000 })
      const caixa = page.getByRole('region', { name: 'Notas recebidas', exact: true })
      await expect(caixa).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Carregando contas...', { exact: true })).toHaveCount(0)
      let liberarEnvio = () => {}
      const envioLiberado = new Promise<void>(resolve => { liberarEnvio = resolve })
      await page.route('**/rest/v1/rpc/receive_nfe_inbox_xml', async route => {
        await envioLiberado
        await route.fallback()
      }, { times: 1 })
      try {
        await caixa.getByLabel('Escolher XML das notas recebidas').setInputFiles([
          { name: 'a.xml', mimeType: 'application/xml', buffer: Buffer.from(a.xml) },
          { name: 'copia-a.xml', mimeType: 'application/xml', buffer: Buffer.from(a.xml) },
          { name: 'fora.xml', mimeType: 'application/xml', buffer: Buffer.from(fora.xml) },
          { name: 'homologacao.xml', mimeType: 'application/xml', buffer: Buffer.from(homologacao.xml) },
        ])
        await expect(page.getByRole('button', { name: 'Nova compra manual', exact: true })).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Importar XML da NF-e', exact: true })).toBeDisabled()
        await expect(page.getByText('Aguarde terminar o envio das notas.', { exact: true })).toBeVisible()
        await expect(caixa.getByRole('button', { name: 'Enviar XML das notas', exact: true })).toBeDisabled()
      } finally { liberarEnvio() }
      const resumo = caixa.getByRole('status').filter({ hasText: 'a.xml' })
      await expect(resumo).toContainText('1 entrou, 1 já estava na caixa, 2 recusadas', { timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Nova compra manual', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Importar XML da NF-e', exact: true })).toBeEnabled()
      await expect(resumo.locator('li').filter({ hasText: /^a.xml:/ })).toContainText('Entrou')
      await expect(resumo.locator('li').filter({ hasText: 'copia-a.xml:' })).toContainText('Já estava na caixa')
      const recusada = resumo.locator('li').filter({ hasText: 'fora.xml:' })
      await expect(recusada).toContainText('Recusada')
      await expect(recusada).toContainText('95.000.000/0002-70')
      await expect(recusada).toContainText('Só entram notas da RGF')
      await expect(resumo.locator('li').filter({ hasText: 'homologacao.xml:' })).toContainText('Recusada')
      await expect(resumo.locator('li').filter({ hasText: 'homologacao.xml:' })).toContainText('Nota de teste (homologação)')
      const linha = caixa.getByTestId('nfe-inbox-row').filter({ hasText: 'Nota ' + a.numero + ' ·' })
      await expect(linha).toHaveCount(1)
      await expect(linha).toContainText('Esperando conferência')
      await expect(linha).toContainText('RGF')
      await resumo.getByRole('button', { name: 'Fechar resumo', exact: true }).click()
      await linha.getByRole('button', { name: 'Conferir', exact: true }).click()
      await expect(page.getByText('Itens da NF-e ·', { exact: false })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Fornecedor do XML:', { exact: false })).toContainText(a.fornecedor)
      await expect(page.getByText('NF ' + a.numero, { exact: false }).first()).toBeVisible()
      // Durante a conferência só o campo da importação existente permanece montado.
      await expect(page.locator('input[type="file"]')).toHaveCount(1)
      await page.getByRole('button', { name: 'Cadastrar fornecedor com dados da NF-e' }).click()
      await expect(page.locator('input[placeholder="Nome do fornecedor"]')).toHaveValue(a.fornecedor)
      await page.getByRole('button', { name: 'Cadastrar e usar fornecedor' }).click()
      await expect(page.locator('select.ps-select').first()).not.toHaveValue('')
      await page.getByRole('button', { name: 'Lançar como revenda sem cadastro' }).click()
      await page.getByRole('button', { name: 'Confirmar NF-e', exact: true }).click()
      await expect(caixa).toBeVisible({ timeout: 20_000 })
      await caixa.locator('summary').filter({ hasText: 'Concluídas' }).click()
      await expect(linha).toContainText('Lançada', { timeout: 20_000 })
      await page.reload()
      await expect(caixa).toBeVisible({ timeout: 20_000 })
      await caixa.locator('summary').filter({ hasText: 'Concluídas' }).click()
      await expect(linha).toContainText('Lançada', { timeout: 20_000 })
      await expect(caixa.getByTestId('nfe-inbox-row').filter({ hasText: 'Nota ' + fora.numero + ' ·' })).toHaveCount(0)
      await expect(caixa.getByTestId('nfe-inbox-row').filter({ hasText: 'Nota ' + homologacao.numero + ' ·' })).toHaveCount(0)
      // Uma recarga mantém as linhas e o bloco aberto enquanto o banco responde.
      let liberarLista = () => {}
      const listaLiberada = new Promise<void>(resolve => { liberarLista = resolve })
      await page.route('**/rest/v1/rpc/list_nfe_inbox', async route => {
        await listaLiberada
        await route.fallback()
      }, { times: 1 })
      try {
        await page.getByRole('button', { name: 'Atualizar contas', exact: true }).click()
        await expect(caixa.getByText('Atualizando…', { exact: true })).toBeVisible()
        await expect(caixa.getByText('Carregando a caixa de notas…', { exact: true })).toHaveCount(0)
        await expect(linha).toBeVisible()
        await expect(caixa.locator('details')).toHaveAttribute('open', '')
      } finally { liberarLista() }
      await expect(caixa.getByText('Atualizando…', { exact: true })).toHaveCount(0)
      await expect(linha).toBeVisible()
      // Persistência e ausência das recusadas também pela leitura do próprio usuário.
      const resposta = await page.request.get(acesso.url + '/rest/v1/payable_nfe_inbox?select=nfe_key&nfe_key=in.(' + [a.chave, fora.chave, homologacao.chave].join(',') + ')', {
        headers: await cabecalhosDaSessao(page, acesso), maxRedirects: 0,
      })
      expect(resposta.ok(), await resposta.text()).toBe(true)
      expect(await resposta.json()).toEqual([{ nfe_key: a.chave }])
      await cancelarSeAberta(page, acesso, a.chave)
      await page.getByRole('button', { name: 'Atualizar contas', exact: true }).click()
      await expect(linha).toContainText('Conta cancelada no ERP', { timeout: 20_000 })
      await expect(linha.getByRole('button', { name: 'Conferir', exact: true })).toHaveCount(0)
    } finally {
      await cancelarSeAberta(page, acesso, a.chave)
    }
  })

test('Financeiro Catálogo abre a página, mas não usa nem lê a caixa de notas',
  matriz('Financeiro Catalogo JC', 'JC', 'bloqueado', 'Caixa de notas recebidas'), async ({ page }) => {
    test.setTimeout(115_000)
    const acesso = await entrarComo(page, 'financeiroCatalogoJc')
    await page.goto('/contas-pagar')
    await expect(page.locator('[data-caixa-notas="bloqueada"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Financeiro da JC', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Carregando contas...', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Notas recebidas', exact: true })).toHaveCount(0)
    const headers = await cabecalhosDaSessao(page, acesso)
    for (const [rpc, data] of [
      ['list_nfe_inbox', {}], ['receive_nfe_inbox_xml', { p_xml_content: nota(Date.now().toString(), 4).xml }],
    ] as const) {
      const resposta = await page.request.post(acesso.url + '/rest/v1/rpc/' + rpc, { headers, data, maxRedirects: 0 })
      expect(resposta.status(), await resposta.text()).toBe(403)
      expect(await resposta.json()).toMatchObject({ code: '42501' })
    }
    const tabela = await page.request.get(acesso.url + '/rest/v1/payable_nfe_inbox?select=id', { headers, maxRedirects: 0 })
    expect(tabela.ok(), await tabela.text()).toBe(true)
    expect(await tabela.json()).toEqual([])
  })
