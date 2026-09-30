import { expect, type Page, type Request } from '@playwright/test'

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
  await page.route('**/*', async (route) => {
    const alvo = new URL(route.request().url())
    if ((alvo.protocol === 'https:' || alvo.protocol === 'wss:') && permitidos.has(alvo.host)) {
      await route.continue()
      return
    }
    await route.abort('blockedbyclient')
  })
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
  page.on('request', anotar)

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
    await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })

    const origens = [...new Set(pedidosAoSupabase.map((pedido) => new URL(pedido.url()).origin))]
    expect(origens, 'todo pedido ao Supabase precisa ir ao banco desta PR').toEqual([destino.banco.origin])
    const anonKey = pedidoDeLogin.headers().apikey ?? ''
    expect(anonKey, 'o login precisa levar a chave publica do app').not.toBe('')
    return { url: destino.banco.origin, anonKey }
  } finally {
    page.off('request', anotar)
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
