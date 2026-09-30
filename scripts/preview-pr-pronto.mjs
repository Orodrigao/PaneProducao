import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { HOST_PREVIEW, localizarPreviewDaPr } from './preview-da-pr.mjs'
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from './provision-preview-users.mjs'

/**
 * Espera o preview da Vercel desta PR ficar pronto E apontado para o banco
 * isolado dela, antes de o job "Navegador no preview desta PR" digitar a senha
 * das contas ficticias.
 *
 * Por que nao basta o check "Apontar o preview para o banco desta PR" estar
 * verde: ele grava as variaveis e PEDE o redeploy, mas termina antes de a
 * Vercel publicar a versao nova. E ele tambem fica verde sem apontar nada
 * quando a sincronizacao nao e de produto. A unica prova de destino e o
 * JavaScript publicado: o endereco do Supabase entra no bundle na hora do
 * build, entao o bundle diz para qual banco aquele link fala.
 *
 * Tudo falha FECHADO. Na duvida, espera; no fim do prazo, reprova com o ultimo
 * motivo. Producao no bundle reprova na hora, porque nunca e legitimo.
 */

export const NOME_CHECK_APONTAR = 'Apontar o preview para o banco desta PR'
export const TEMPO_MAXIMO_MS = 15 * 60_000
export const INTERVALO_MS = 20_000
/** Uma pagina do app exportado carrega uma dezena de scripts; muito acima disso e anomalia. */
export const LIMITE_SCRIPTS = 80

const URL_SUPABASE = /https:\/\/([a-z0-9]{20})\.supabase\.co/g
const SHA_COMPLETO = /^[0-9a-f]{40}$/

/**
 * O endereco que o provisionamento publicou para o banco desta PR. Aceita so
 * o formato exato de um projeto Supabase e recusa producao e o banco
 * compartilhado, que nunca sao o banco isolado de uma PR.
 */
export function validarUrlBancoDaPr(url) {
  const casamento = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(typeof url === 'string' ? url : '')
  if (!casamento) {
    return { ok: false, motivo: 'O endereco do banco desta PR veio ausente ou fora do formato https://<ref>.supabase.co.' }
  }
  const ref = casamento[1]
  if (ref === PRODUCTION_PROJECT_REF) {
    return { ok: false, motivo: 'O endereco informado e o banco de PRODUCAO; o navegador nao entra nele.' }
  }
  if (ref === PREVIEW_PROJECT_REF) {
    return { ok: false, motivo: 'O endereco informado e o banco compartilhado, nao o banco isolado desta PR.' }
  }
  return { ok: true, ref, url }
}

/**
 * Decide, a partir de UMA resposta da API de checks, se o "Apontar" do commit
 * exato terminou bem. So conta o check do GitHub Actions com esse nome e esse
 * commit: homonimo de outro aplicativo ou de outro commit e ignorado.
 */
export function decidirCheckApontar(body, headSha) {
  if (!Array.isArray(body?.check_runs)) {
    return { situacao: 'recusar', motivo: 'A resposta do GitHub sobre o check de apontar veio sem a lista check_runs.' }
  }
  if (body.total_count !== body.check_runs.length) {
    return {
      situacao: 'recusar',
      motivo: `A lista de checks veio incompleta (${body.check_runs.length} de ${body.total_count}).`,
    }
  }
  const deste = body.check_runs.filter((check) => check?.name === NOME_CHECK_APONTAR
    && check.app?.slug === 'github-actions'
    && check.head_sha === headSha)
  if (deste.length === 0) {
    return { situacao: 'aguardar', motivo: `O check "${NOME_CHECK_APONTAR}" ainda nao apareceu neste commit.` }
  }
  const concluidos = deste.filter((check) => check.status === 'completed')
  const reprovado = concluidos.find((check) => check.conclusion !== 'success')
  if (reprovado) {
    return { situacao: 'recusar', motivo: `O check "${NOME_CHECK_APONTAR}" terminou como ${reprovado.conclusion ?? 'sem conclusao'}.` }
  }
  if (concluidos.length !== deste.length) {
    return { situacao: 'aguardar', motivo: `O check "${NOME_CHECK_APONTAR}" ainda esta rodando.` }
  }
  return { situacao: 'aprovado' }
}

/** Todos os projetos Supabase citados num texto, sem repeticao. */
export function refsSupabaseNoTexto(texto) {
  const refs = new Set()
  for (const casamento of String(texto ?? '').matchAll(URL_SUPABASE)) refs.add(casamento[1])
  return refs
}

/**
 * O bundle publicado precisa citar o banco desta PR e nenhum outro. Producao
 * reprova na hora; banco compartilhado ou ausencia e espera, porque o redeploy
 * que troca o destino pode ainda nao ter sido publicado.
 */
export function decidirBundle(refsEncontrados, refEsperado) {
  const refs = [...(refsEncontrados ?? [])]
  if (refs.includes(PRODUCTION_PROJECT_REF)) {
    return { situacao: 'recusar', motivo: 'O JavaScript publicado deste preview aponta para o banco de PRODUCAO.' }
  }
  if (refs.length === 0) {
    return { situacao: 'aguardar', motivo: 'Nao achei endereco de banco no JavaScript publicado deste preview.' }
  }
  const outros = refs.filter((ref) => ref !== refEsperado)
  if (outros.length > 0) {
    const compartilhado = outros.includes(PREVIEW_PROJECT_REF) ? ' (o banco compartilhado)' : ''
    return {
      situacao: 'aguardar',
      motivo: `O JavaScript publicado ainda aponta para outro banco${compartilhado}; esperando o redeploy desta PR.`,
    }
  }
  return { situacao: 'aprovado' }
}

/**
 * Scripts do proprio preview que a pagina carrega. So caminhos do mesmo
 * endereco sob /_next/static/: nada de fora recebe pedido deste passo.
 */
export function scriptsDaPagina(html, baseUrl) {
  const origem = new URL(baseUrl).origin
  const scripts = new Set()
  for (const casamento of String(html ?? '').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    let alvo
    try {
      alvo = new URL(casamento[1], origem)
    } catch {
      continue
    }
    if (alvo.origin === origem && alvo.pathname.startsWith('/_next/static/')) scripts.add(alvo.toString())
  }
  if (scripts.size > LIMITE_SCRIPTS) {
    throw new Error(`A pagina de login carregou ${scripts.size} scripts, acima do limite de ${LIMITE_SCRIPTS}.`)
  }
  return [...scripts]
}

/** Le a pagina de login do preview e junta os bancos citados nos scripts dela. */
export async function bancosDoPreview({ baseUrl, fetchImpl = fetch }) {
  const pagina = await fetchImpl(new URL('/login', baseUrl).toString(), { redirect: 'error' })
  if (!pagina.ok) throw new Error(`A pagina de login do preview respondeu ${pagina.status}.`)
  const html = await pagina.text()
  const scripts = scriptsDaPagina(html, baseUrl)
  if (scripts.length === 0) throw new Error('A pagina de login do preview nao carregou nenhum script do proprio app.')
  const refs = refsSupabaseNoTexto(html)
  for (const script of scripts) {
    const resposta = await fetchImpl(script, { redirect: 'error' })
    if (!resposta.ok) throw new Error(`O script ${new URL(script).pathname} respondeu ${resposta.status}.`)
    for (const ref of refsSupabaseNoTexto(await resposta.text())) refs.add(ref)
  }
  return refs
}

/**
 * O token do GitHub so vai para a API do GitHub. Os pedidos ao preview da
 * Vercel saem sem ele.
 */
export function fetchDoGithub({ githubToken, fetchImpl = fetch }) {
  return (url, init = {}) => {
    if (!String(url).startsWith('https://api.github.com/')) {
      throw new Error(`Pedido com token do GitHub recusado para fora da API: ${url}`)
    }
    return fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        ...init.headers,
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  }
}

export async function esperarPreviewPronto({
  repositorio,
  prNumber,
  headSha,
  supabaseUrl,
  githubToken,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = TEMPO_MAXIMO_MS,
  intervalMs = INTERVALO_MS,
  log = console.log,
}) {
  if (!repositorio) throw new Error('GITHUB_REPOSITORY ausente.')
  if (!/^[1-9][0-9]*$/.test(String(prNumber ?? ''))) throw new Error('Numero da PR ausente ou invalido.')
  if (!SHA_COMPLETO.test(headSha ?? '')) throw new Error('Commit da PR ausente ou invalido.')
  if (!githubToken) throw new Error('GITHUB_TOKEN ausente.')
  const banco = validarUrlBancoDaPr(supabaseUrl)
  if (!banco.ok) throw new Error(banco.motivo)

  const github = fetchDoGithub({ githubToken, fetchImpl })
  const checks = `https://api.github.com/repos/${repositorio}/commits/${headSha}/check-runs`
    + `?check_name=${encodeURIComponent(NOME_CHECK_APONTAR)}&filter=latest&per_page=100`
  const prazo = now() + timeoutMs
  let motivo = 'nenhuma volta concluida.'

  while (true) {
    const volta = await umaVolta()
    if (volta.situacao === 'aprovado') return { baseUrl: volta.baseUrl, supabaseUrl: banco.url }
    if (volta.situacao === 'recusar') throw new Error(volta.motivo)
    motivo = volta.motivo
    if (now() >= prazo) {
      throw new Error(`O preview desta PR nao ficou pronto no banco dela em ${timeoutMs / 60_000} min. Ultimo motivo: ${motivo}`)
    }
    log(`Aguardando: ${motivo}`)
    await sleep(intervalMs)
  }

  async function umaVolta() {
    const resposta = await github(checks)
    if (!resposta.ok) return { situacao: 'aguardar', motivo: `A consulta do check de apontar respondeu ${resposta.status}.` }
    const check = decidirCheckApontar(await resposta.json(), headSha)
    if (check.situacao !== 'aprovado') return check

    let baseUrl
    try {
      baseUrl = await localizarPreviewDaPr({ repositorio, prNumber, headSha, fetchImpl: github })
    } catch (erro) {
      return { situacao: 'aguardar', motivo: erro instanceof Error ? erro.message : String(erro) }
    }
    // localizarPreviewDaPr ja confere a procedencia; repetir aqui e barato e
    // mantem a trava mesmo se aquela funcao mudar.
    if (!HOST_PREVIEW.test(new URL(baseUrl).hostname)) {
      return { situacao: 'recusar', motivo: `O link encontrado nao tem formato de preview deste projeto: ${baseUrl}` }
    }

    let refs
    try {
      refs = await bancosDoPreview({ baseUrl, fetchImpl })
    } catch (erro) {
      return { situacao: 'aguardar', motivo: erro instanceof Error ? erro.message : String(erro) }
    }
    const bundle = decidirBundle(refs, banco.ref)
    return bundle.situacao === 'aprovado' ? { situacao: 'aprovado', baseUrl } : bundle
  }
}

async function main() {
  try {
    const pronto = await esperarPreviewPronto({
      repositorio: process.env.GITHUB_REPOSITORY,
      prNumber: process.env.PR_NUMBER,
      headSha: process.env.PR_HEAD_SHA,
      supabaseUrl: process.env.PREVIEW_PR_SUPABASE_URL,
      githubToken: process.env.GITHUB_TOKEN,
    })
    console.log(`Preview pronto: ${pronto.baseUrl} fala com ${pronto.supabaseUrl}.`)
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `base_url=${pronto.baseUrl}\nsupabase_url=${pronto.supabaseUrl}\n`)
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Preview provado antes do login: \`${pronto.baseUrl}\` publica o banco \`${pronto.supabaseUrl}\` e nenhum outro.\n\n`,
      )
    }
  } catch (erro) {
    const texto = String(erro instanceof Error ? erro.message : erro)
      .split(process.env.GITHUB_TOKEN || '\u0000').join('[OCULTO]')
    console.error(texto)
    process.exitCode = 1
  }
}

const execucaoDireta = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (execucaoDireta) await main()
