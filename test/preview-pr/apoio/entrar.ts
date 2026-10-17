import { expect, type Page, type Request, type Response } from '@playwright/test'

// UNICO lugar de test/preview-pr que le a senha das contas ficticias. A guarda
// em scripts/preview-pr-guarda.test.mjs reprova qualquer outro arquivo daqui
// que cite a senha, pule teste ou leia o ambiente.
//
// Antes de digitar, tres travas: o link tem o formato de preview deste projeto
// na Vercel, o banco informado e um banco isolado de PR (nunca producao nem o
// compartilhado) e o passo anterior do job ja provou, pelo JavaScript
// publicado, que aquele link fala com aquele banco. Durante toda a sessao a
// pagina so conversa com o preview e com esse banco; o resto e abortado. Depois
// do login, confere que o pedido de login foi mesmo para esse banco.

export const PERFIS = {
  admin: 'rodrigao+teste@gmail.com',
  vendasJa: 'rodrigao+teste-vendas-ja@gmail.com',
  expedicaoJc: 'rodrigao+teste-expedicao-jc@gmail.com',
  financeiroJc: 'rodrigao+teste-financeiro-jc@gmail.com',
  financeiroCatalogoJc: 'rodrigao+teste-financeiro-catalogo-jc@gmail.com',
  romaneioEx: 'rodrigao+teste-romaneio-ex@gmail.com',
  cozinhaJc: 'rodrigao+teste-cozinha-jc@gmail.com',
  geolarJc: 'rodrigao+teste-geolar-jc@gmail.com',
} as const

export type Perfil = keyof typeof PERFIS

export type AcessoAoBanco = {
  /** https://<ref>.supabase.co do banco isolado desta PR. */
  url: string
  /** Chave publica que o proprio app mandou no login. */
  anonKey: string
}

/** Declara a linha da matriz perfil x loja x esperado que o teste prova. */
export function matriz(perfil: string, loja: string, esperado: string, alvo: string) {
  return {
    annotation: [
      { type: 'perfil', description: perfil },
      { type: 'loja', description: loja },
      { type: 'esperado', description: esperado },
      { type: 'alvo', description: alvo },
    ],
  }
}

type Destino = { base: URL; banco: URL }

async function destinoProvado(): Promise<Destino> {
  // Import dinamico: no estatico o Playwright converte o modulo para CommonJS
  // e quebra no import.meta de scripts/change-scope.mjs.
  const { HOST_PREVIEW } = await import('../../../scripts/preview-da-pr.mjs')
  const { validarUrlBancoDaPr } = await import('../../../scripts/preview-pr-pronto.mjs')

  const base = process.env.PREVIEW_PR_BASE_URL ?? ''
  let baseUrl: URL
  try {
    baseUrl = new URL(base)
  } catch {
    throw new Error('PREVIEW_PR_BASE_URL ausente: este roteiro so roda depois do passo que prova o preview da PR.')
  }
  if (baseUrl.protocol !== 'https:' || !HOST_PREVIEW.test(baseUrl.hostname) || baseUrl.pathname !== '/') {
    throw new Error(`Link fora do formato de preview deste projeto: ${base}`)
  }
  const banco = validarUrlBancoDaPr(process.env.PREVIEW_PR_SUPABASE_URL)
  if (!banco.ok) throw new Error(banco.motivo)
  return { base: baseUrl, banco: new URL(banco.url) }
}

const paginasCercadas = new WeakSet<Page>()

async function cercarRede(page: Page, destino: Destino): Promise<void> {
  if (paginasCercadas.has(page)) return
  paginasCercadas.add(page)
  const permitidos = new Set([destino.base.host, destino.banco.host])
  // Quando o teste termina com pedidos ainda em voo (a tela do Romaneio
  // dispara varios ao abrir), completar ou abortar esses pedidos estoura
  // "Test ended" e derrubava o teste ja concluido (canario PR 470). Com a
  // pagina fechada nao ha para onde o pedido ir; SO esse erro e descartado.
  // O mesmo vale para o recarregamento da pagina com pedido em voo: o
  // navegador cancela o pedido e a resposta buscada e descartada ("Fetch
  // response has been disposed", PR 486); o pedido ja morreu do lado do
  // navegador, nada passa.
  // Qualquer outro sobe e reprova o teste, em vez de virar falha de rede
  // calada numa chamada que o roteiro talvez nao confira.
  const semPagina = (erro: unknown) => {
    if (erro instanceof Error && /Test ended|has been closed|Fetch response has been disposed/.test(erro.message)) return
    throw erro
  }
  await page.route('**/*', async (route) => {
    const alvo = new URL(route.request().url())
    if (alvo.protocol !== 'https:' || !permitidos.has(alvo.host)) {
      await route.abort('blockedbyclient').catch(semPagina)
      return
    }
    if (alvo.host !== destino.banco.host) {
      await route.continue().catch(semPagina)
      return
    }
    // O pedido de login leva a senha ao banco. `continue` seguiria um
    // redirecionamento sem passar de novo por esta cerca, e devolver o 3xx ao
    // navegador tambem nao garante que o pedido seguinte volte a ela (o
    // Playwright so chama a rota no primeiro endereco da cadeia; 307/308
    // reenviam o corpo). A API do Supabase nao redireciona; se redirecionar,
    // o pedido morre aqui. Falha no caminho tambem aborta: nunca deixa passar.
    let resposta
    try {
      resposta = await route.fetch({ maxRedirects: 0 })
    } catch (erro) {
      await route.abort('failed').catch(semPagina)
      semPagina(erro)
      return
    }
    if (resposta.status() >= 300 && resposta.status() < 400) {
      await route.abort('blockedbyclient').catch(semPagina)
      return
    }
    await route.fulfill({ response: resposta }).catch(semPagina)
  })
}

/** Uma linha so, sem a senha nem texto com cara de JWT, com no maximo `limite` caracteres. */
function curto(texto: string, senha: string, limite = 80): string {
  const linha = texto
    .split(senha).join('***')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[jwt]')
    .replace(/\s+/g, ' ')
    .trim()
  return linha.length > limite ? `${linha.slice(0, limite)}...` : linha
}

/**
 * O evento `response` chega com os cabecalhos; o corpo pode nunca terminar. Sem
 * prazo, a espera pelo corpo esconderia o diagnostico atras do limite do teste.
 */
async function lerCorpoComPrazo(resposta: Response, prazoMs = 3_000): Promise<string | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const esgotou = new Promise<null>((resolver) => {
    relogio = setTimeout(() => resolver(null), prazoMs)
  })
  try {
    return await Promise.race([resposta.text(), esgotou])
  } finally {
    clearTimeout(relogio)
  }
}

/**
 * O que o Supabase Auth devolveu ao pedido de login. O corpo de um login que
 * deu certo carrega o token da sessao: so se le a recusa (status >= 400), e dela
 * sai apenas codigo e mensagem curtos. Corpo que nao e JSON fica so com o status.
 */
async function resumirRespostaDoAuth(resposta: Response, senha: string): Promise<string> {
  const resumo = `HTTP ${resposta.status()}`
  if (resposta.status() < 400) return resumo
  try {
    const texto = await lerCorpoComPrazo(resposta)
    if (texto === null) return `${resumo} (corpo indisponivel no prazo)`
    const corpo: unknown = JSON.parse(texto)
    if (corpo === null || typeof corpo !== 'object') return resumo
    const campos = corpo as Record<string, unknown>
    const primeiro = (...chaves: string[]) => {
      for (const chave of chaves) {
        const valor = campos[chave]
        if (typeof valor === 'string' && valor !== '') return curto(valor, senha)
      }
      return ''
    }
    // O codigo do Auth e um identificador curto (invalid_credentials); qualquer
    // outra coisa nesse campo nao e impressa.
    const bruto = primeiro('error_code', 'error', 'code')
    const codigo = /^[\w.-]{1,80}$/.test(bruto) ? bruto : ''
    const mensagem = primeiro('msg', 'error_description', 'message')
    return [resumo, codigo, mensagem && `"${mensagem}"`].filter(Boolean).join(' ')
  } catch {
    return resumo
  }
}

/**
 * Mensagem da falha quando o login nao sai de /login: o que o Auth respondeu
 * (ou "sem resposta") e o texto que a tela mostrou. A tela diz "E-mail ou senha
 * invalidos." para qualquer erro do Auth, entao so o status separa senha
 * recusada de limite de tentativas ou queda do servico.
 */
async function explicarLoginPreso(
  page: Page,
  perfil: Perfil,
  senha: string,
  pedido: Request,
  respostas: Response[],
): Promise<string> {
  // So a resposta DESTE pedido de login conta: outro pedido ao mesmo endereco
  // (renovacao de sessao, por exemplo) nao pode ser atribuido ao login.
  const resposta = respostas.find((candidata) => candidata.request() === pedido)
  let auth: string
  if (resposta) {
    auth = await resumirRespostaDoAuth(resposta, senha)
  } else {
    const falha = pedido.failure()?.errorText
    auth = falha ? `sem resposta (${curto(falha, senha)})` : 'sem resposta ate o fim da espera'
  }
  let tela = 'nao foi possivel ler o campo de mensagem (pagina fechada ou campo ausente)'
  try {
    const texto = curto(await page.locator('.ps-login-err').first().innerText({ timeout: 2_000 }), senha, 120)
    tela = texto ? `"${texto}"` : 'nenhuma mensagem'
  } catch {
    // fica a frase acima
  }
  return `O login de "${perfil}" nao saiu de /login. Supabase Auth: ${auth}. A tela mostrou: ${tela}`
}

/**
 * Entra no preview desta PR com a conta ficticia do perfil. Falha, nunca pula,
 * quando falta senha, link provado ou banco provado.
 */
export async function entrarComo(page: Page, perfil: Perfil): Promise<AcessoAoBanco> {
  const destino = await destinoProvado()
  const senha = process.env.SUPABASE_TEST_USER_PASSWORD
  if (!senha) throw new Error('SUPABASE_TEST_USER_PASSWORD ausente: o login do roteiro nao pode ser dispensado.')

  await cercarRede(page, destino)
  const pedidosAoSupabase: Request[] = []
  const anotar = (pedido: Request) => {
    if (new URL(pedido.url()).hostname.endsWith('.supabase.co')) pedidosAoSupabase.push(pedido)
  }
  const respostasDoLogin: Response[] = []
  const guardarResposta = (resposta: Response) => {
    if (resposta.url().startsWith(`${destino.banco.origin}/auth/v1/token`)) respostasDoLogin.push(resposta)
  }
  page.on('request', anotar)
  page.on('response', guardarResposta)

  try {
    await page.goto(new URL('/login', destino.base).toString())
    expect(new URL(page.url()).host, 'a pagina de login precisa ser do preview provado').toBe(destino.base.host)

    const login = page.waitForRequest(
      (pedido) => pedido.url().startsWith(`${destino.banco.origin}/auth/v1/token`),
      { timeout: 15_000 },
    )
    await page.getByPlaceholder('nome@paneesalute.com.br').fill(PERFIS[perfil])
    await page.locator('input[type="password"]').fill(senha)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const pedidoDeLogin = await login
    try {
      await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
    } catch (erro) {
      const original = erro instanceof Error ? erro.message : String(erro)
      // O diagnostico nunca esconde o erro original: se ele mesmo falhar, a
      // falha original sobe do mesmo jeito. A senha sai da mensagem inteira.
      let diagnostico = `O login de "${perfil}" nao saiu de /login. Nao foi possivel resumir a resposta do Auth.`
      try {
        diagnostico = await explicarLoginPreso(page, perfil, senha, pedidoDeLogin, respostasDoLogin)
      } catch {
        // fica a frase acima
      }
      throw new Error(`${diagnostico}\n${original}`.split(senha).join('***'))
    }

    const origens = [...new Set(pedidosAoSupabase.map((pedido) => new URL(pedido.url()).origin))]
    expect(origens, 'todo pedido ao Supabase precisa ir ao banco desta PR').toEqual([destino.banco.origin])
    const anonKey = pedidoDeLogin.headers().apikey ?? ''
    expect(anonKey, 'o login precisa levar a chave publica do app').not.toBe('')
    return { url: destino.banco.origin, anonKey }
  } finally {
    page.off('request', anotar)
    page.off('response', guardarResposta)
  }
}

/** Cabecalhos da Data API com o token da sessao aberta no navegador. */
export async function cabecalhosDaSessao(page: Page, acesso: AcessoAoBanco): Promise<Record<string, string>> {
  const token = await page.evaluate(() => {
    for (let indice = 0; indice < localStorage.length; indice += 1) {
      const chave = localStorage.key(indice) ?? ''
      if (chave.startsWith('sb-') && chave.endsWith('-auth-token')) {
        const sessao = JSON.parse(localStorage.getItem(chave) ?? '{}') as { access_token?: string }
        return sessao.access_token ?? ''
      }
    }
    return ''
  })
  expect(token, 'a sessao do navegador precisa ter um token para falar com a Data API').not.toBe('')
  return { apikey: acesso.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/** O dia de hoje na padaria (America/Sao_Paulo), no formato do banco. */
export function hojeNaPadaria(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
