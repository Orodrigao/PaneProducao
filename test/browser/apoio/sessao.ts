import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Entrar pela tela de login custava cerca de 2 s dos ~5,6 s de cada teste do
// smoke (medido em 12 execucoes do job Navegador, 18/10/2026): abrir /login,
// pedir a sessao ao Supabase Auth e carregar a tela de chegada, so para o teste
// abrir outra tela logo depois. Aqui cada conta entra pela tela UMA vez por
// processo do Playwright, num contexto a parte, e os testes seguintes da mesma
// conta comecam ja com a sessao.
//
// O que viaja de um teste para o outro e so o que o proprio login grava no
// navegador: a sessao do Supabase Auth e o perfil que o login guarda em
// `pane_auth_profile_cache` (src/lib/auth.ts). Rascunho ou escolha que alguma
// tela tenha gravado no contexto do login fica para tras.
//
// A sessao guardada vive so na memoria deste processo. Nada vai para disco: o
// arquivo de sessao carregaria o token de renovacao, e artefato de teste com
// credencial ja vazou uma vez (PR 506). Depois de uma falha o Playwright troca
// de processo, entao a repeticao do CI sempre entra de novo pela tela.
//
// Quem NAO usa: teste que prova o proprio login (onde cada perfil cai depois de
// entrar, troca de conta, Sair). Esses continuam entrando pela tela, e nenhum
// teste que use a sessao guardada pode clicar em Sair: o logout encerra a
// sessao no Supabase Auth para todos os testes seguintes da mesma conta.

type EstadoDoNavegador = Awaited<ReturnType<BrowserContext['storageState']>>

const sessoesGuardadas = new Map<string, EstadoDoNavegador>()

// Folga antes de a sessao vencer. Com ela o aplicativo nao chega a renovar uma
// sessao guardada no meio de um teste (o mais longo tem teto de 3 min): a
// renovacao troca o token de renovacao, e os testes seguintes ficariam com um
// token ja trocado. Vale enquanto o relogio do navegador nao for adiantado:
// `page.clock` no futuro, perto do vencimento, faria o supabase-js renovar.
const FOLGA_ANTES_DE_VENCER_MS = 10 * 60_000

function chaveDoLogin(nome: string): boolean {
  return /^sb-[a-z0-9]+-auth-token$/.test(nome) || nome === 'pane_auth_profile_cache'
}

function sessaoDoSupabase(estado: EstadoDoNavegador): { expires_at?: number } | null {
  for (const { localStorage } of estado.origins) {
    const item = localStorage.find(({ name }) => /^sb-[a-z0-9]+-auth-token$/.test(name))
    if (item) return JSON.parse(item.value) as { expires_at?: number }
  }
  return null
}

function aindaValida(estado: EstadoDoNavegador): boolean {
  const expiraEm = sessaoDoSupabase(estado)?.expires_at
  return typeof expiraEm === 'number' && expiraEm * 1000 - Date.now() > FOLGA_ANTES_DE_VENCER_MS
}

async function entrarNumContextoAParte(browser: Browser, email: string, senha: string): Promise<EstadoDoNavegador> {
  // `storageState: undefined` explicito: sem ele o contexto herdaria um
  // `test.use({ storageState })` do spec em vez de comecar sem sessao.
  const context = await browser.newContext({ storageState: undefined })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
    await page.locator('input[type="password"]').fill(senha)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })

    const estado = await context.storageState()
    const soLogin: EstadoDoNavegador = {
      cookies: estado.cookies,
      origins: estado.origins
        .map(({ origin, localStorage }) => ({ origin, localStorage: localStorage.filter(({ name }) => chaveDoLogin(name)) }))
        .filter(({ localStorage }) => localStorage.length > 0),
    }
    expect(sessaoDoSupabase(soLogin), `o login de ${email} nao deixou sessao do Supabase no navegador`).not.toBeNull()
    return soLogin
  } finally {
    await context.close()
  }
}

/**
 * Deixa o contexto da pagina com a sessao da conta, como logo depois do login.
 * A pagina continua em branco: o teste abre a tela que ele prova.
 */
export async function entrarComSessaoGuardada(page: Page, email: string): Promise<void> {
  const senha = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!senha, 'A senha das contas ficticias existe somente no cofre local e no secret do GitHub.')

  let estado = sessoesGuardadas.get(email)
  if (!estado || !aindaValida(estado)) {
    const browser = page.context().browser()
    if (!browser) throw new Error('Sessao guardada exige contexto criado a partir do navegador do Playwright.')
    estado = await entrarNumContextoAParte(browser, email, senha!)
    sessoesGuardadas.set(email, estado)
  }
  await page.context().setStorageState(estado)
}
