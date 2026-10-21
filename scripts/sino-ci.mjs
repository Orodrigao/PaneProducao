import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Sino do CI: quando um fluxo de PR termina e a consulta nao acha nenhuma
 * verificacao do GitHub Actions do commit rodando, comenta na PR o que
 * terminou (verde ou com falha). E um aviso para acordar a conversa, nao uma
 * certificacao: quem le confere `gh pr checks` antes de `Verify` e `Check`.
 *
 * Por que existe: o app do Claude acorda a conversa da PR (Auto-fix ligado) em
 * falha de CI, conflito e comentario novo, mas nao em CI verde. Conversas
 * terminavam o turno esperando o CI e ficavam horas paradas (PRs 511, 514 e
 * 517, outubro de 2026). Este comentario e o evento que faltava.
 *
 * Roda pelo workflow `.github/workflows/sino-ci.yml` (`workflow_run`), com o
 * codigo da main. Nunca executa codigo da PR: so le a API do GitHub e escreve
 * um texto montado aqui, sem nada que a PR controla (nome de fluxo vira rotulo
 * da lista abaixo; link sai do numero da execucao). Na duvida, nao comenta e o
 * job fica vermelho.
 */

export const NOME_FLUXO_SINO = 'Sino do CI'
/** A lista `workflows:` do sino-ci.yml; o teste confere que sao iguais. */
export const FLUXOS_VIGIADOS = ['CI', 'CI Banco (ensaio de migrations)', 'Banco por PR', 'Usuarios do Banco por PR']
export const BASE_DAS_PRS = 'main'
export const MAX_PAGINAS = 20
export const PRAZO_POR_PEDIDO_MS = 15_000

const API = 'https://api.github.com'
const AUTOR_DO_AVISO = 'github-actions[bot]'
const SHA_COMPLETO = /^[0-9a-f]{40}$/
const REPOSITORIO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
const STATUS_CONHECIDOS = new Set(['requested', 'queued', 'in_progress', 'waiting', 'pending', 'completed'])
const CONCLUSOES_VERDES = new Set(['success', 'skipped', 'neutral'])
const CONCLUSAO_EM_PORTUGUES = {
  failure: 'falhou',
  cancelled: 'cancelada',
  timed_out: 'estourou o tempo',
  action_required: 'pede ação manual',
  startup_failure: 'não conseguiu começar',
}

const inteiroPositivo = (valor) => Number.isInteger(valor) && valor > 0
const textoCheio = (valor) => typeof valor === 'string' && valor.length > 0

/** PRs abertas desta branch que recebem o aviso: da casa, contra a main, com a cabeca neste commit. */
export function escolherPrs(prs, { repositorio, sha }) {
  if (!Array.isArray(prs) || prs.some((pr) => !inteiroPositivo(pr?.number) || !textoCheio(pr?.head?.sha))) {
    return { situacao: 'recusar', numeros: [], motivo: 'A lista de PRs da branch veio em formato inesperado.' }
  }
  const daCasa = prs.filter((pr) => pr.head.repo?.full_name === repositorio
    && pr.base?.repo?.full_name === repositorio && pr.base.ref === BASE_DAS_PRS)
  const numeros = daCasa.filter((pr) => pr.head.sha === sha).map((pr) => pr.number).sort((a, b) => a - b)
  if (numeros.length > 0) return { situacao: 'avisar', numeros, motivo: null }
  return {
    situacao: 'ignorar',
    numeros: [],
    motivo: daCasa.length > 0
      ? 'A PR desta branch ja esta em outro commit; o aviso fica para o commit novo.'
      : `Nenhuma PR aberta deste repositorio contra a ${BASE_DAS_PRS} para esta branch.`,
  }
}

function execucaoValida(run, sha) {
  if (!run || typeof run !== 'object') return 'veio vazia'
  if (!['id', 'workflow_id', 'run_attempt'].every((campo) => inteiroPositivo(run[campo]))) return 'sem numero ou tentativa'
  if (!['name', 'event', 'head_sha', 'created_at'].every((campo) => textoCheio(run[campo]))) return 'sem nome, evento, commit ou data'
  if (!STATUS_CONHECIDOS.has(run.status)) return 'com status desconhecido'
  return run.head_sha === sha ? null : 'de outro commit'
}

/**
 * Le as execucoes do GitHub Actions do commit (`actions/runs?head_sha=`).
 * `aguardar` se qualquer uma ainda roda; senao `parado`, com TODAS as
 * terminadas: duas execucoes do mesmo fluxo no mesmo commit podem ser de
 * contextos diferentes (outra PR da mesma branch, disparo manual), entao uma
 * verde nao esconde a falha da outra. Rodar de novo (`gh run rerun`) e a mesma
 * execucao numa tentativa nova, e a API so mostra a ultima. Fica de fora so
 * quem roda por `workflow_run` (o proprio sino, que roda no commit da main;
 * uma PR nao cria execucao dessas no commit dela). A execucao que disparou o
 * sino conta como terminada, com a conclusao do evento, se a API ainda a
 * mostrar rodando ou na tentativa anterior. `rodada` muda quando alguem roda
 * uma verificacao de novo.
 */
export function avaliarExecucoes(corpo, { sha, disparo }) {
  const recusar = (motivo) => ({ situacao: 'recusar', motivo })
  if (!inteiroPositivo(disparo?.id) || !inteiroPositivo(disparo?.run_attempt) || !textoCheio(disparo?.conclusion)) {
    return recusar('O evento que disparou o sino veio sem execucao, tentativa ou conclusao.')
  }
  if (!Array.isArray(corpo?.workflow_runs) || corpo.total_count !== corpo.workflow_runs.length) {
    return recusar('A lista de execucoes do commit veio ausente ou incompleta.')
  }
  for (const run of corpo.workflow_runs) {
    const defeito = execucaoValida(run, sha)
    if (defeito) return recusar(`Uma execucao do commit veio ${defeito}.`)
  }
  const verificacoes = corpo.workflow_runs.filter((run) => run.event !== 'workflow_run').map((run) => {
    const atrasada = run.id === disparo.id && (run.run_attempt < disparo.run_attempt
      || (run.run_attempt === disparo.run_attempt && run.status !== 'completed'))
    return atrasada ? { ...run, status: 'completed', conclusion: disparo.conclusion, run_attempt: disparo.run_attempt } : run
  })
  if (!verificacoes.some((run) => run.id === disparo.id)) {
    return recusar('A execucao que disparou o sino nao aparece entre as execucoes do commit.')
  }
  const rodando = verificacoes.filter((run) => run.status !== 'completed')
  if (rodando.length > 0) return { situacao: 'aguardar', motivo: `Ainda rodando: ${rodando.map((run) => run.name).join(', ')}.` }

  const execucoes = verificacoes.map((run) => ({ id: run.id, workflowId: run.workflow_id, nome: run.name, conclusao: run.conclusion ?? null }))
  return {
    situacao: 'parado',
    motivo: null,
    execucoes,
    falhas: execucoes.filter((item) => !CONCLUSOES_VERDES.has(item.conclusao)),
    rodada: verificacoes.map((run) => `${run.id}.${run.run_attempt}`).sort().join(','),
  }
}

/** Marca oculta do aviso: um por commit e por rodada de tentativas. */
export function marcadorDoAviso(sha, rodada) {
  return `<!-- sino-ci sha=${sha} rodada=${rodada} -->`
}

/** So nome da lista confiavel; nome que a PR inventou vira o numero do fluxo. */
const rotulo = (item) => (FLUXOS_VIGIADOS.includes(item.nome) ? item.nome : `outro fluxo do Actions (${item.workflowId})`)

function montarAviso(sha, avaliacao, repositorio) {
  const resultado = avaliacao.falhas.length === 0
    ? [`Concluídas: todas verdes (${[...new Set(avaliacao.execucoes.map(rotulo))].join(', ')}).`]
    : ['Concluídas com falha:', '', ...avaliacao.falhas.map((item) => `- [${rotulo(item)}](https://github.com/${repositorio}/actions/runs/${item.id}): `
      + (CONCLUSAO_EM_PORTUGUES[item.conclusao] ?? 'não ficou verde'))]
  return [
    marcadorDoAviso(sha, avaliacao.rodada),
    `**Sino do CI:** na consulta ao GitHub Actions, nenhuma verificação estava rodando para o commit \`${sha.slice(0, 7)}\`.`,
    ...resultado,
    '',
    'Confira `gh pr checks` antes de `Verify` e `Check`: este aviso não inclui execução que ainda não apareceu nem checks de fora do Actions (Vercel, CodeRabbit), e não autoriza integrar.',
  ].join('\n')
}

/**
 * Comenta ou nao numa PR, dados a avaliacao e TODOS os comentarios dela. So
 * conta o marcador escrito pelo proprio GitHub Actions, para que ninguem cale
 * o sino copiando-o.
 */
export function decidirAviso({ avaliacao, comentarios, sha, repositorio }) {
  if (avaliacao?.situacao !== 'parado' || !REPOSITORIO.test(repositorio ?? '') || !SHA_COMPLETO.test(sha ?? '')) {
    return { acao: 'recusar', motivo: 'So se avisa com nada rodando, num repositorio e commit validos.' }
  }
  if (!Array.isArray(comentarios) || comentarios.some((item) => !item || typeof item !== 'object')) {
    return { acao: 'recusar', motivo: 'Os comentarios da PR vieram em formato inesperado.' }
  }
  const marcador = marcadorDoAviso(sha, avaliacao.rodada)
  if (comentarios.some((item) => item.user?.login === AUTOR_DO_AVISO && String(item.body).includes(marcador))) {
    return { acao: 'ignorar', motivo: 'O sino já deu este aviso neste commit.' }
  }
  return { acao: 'comentar', motivo: null, corpo: montarAviso(sha, avaliacao, repositorio) }
}

/** Cliente minimo da API: prazo por pedido, todas as paginas e o token so para a API do GitHub. */
function clienteDoGithub({ token, fetchImpl, prazoPorPedidoMs }) {
  // O prazo vale tambem para ler o corpo. Relogio com setTimeout comum: o do
  // AbortSignal.timeout nao segura o processo do Node, que sem socket aberto
  // terminava antes de o prazo disparar (visto no Node 22 do CI).
  const pedir = async (url, init = {}) => {
    const caminho = new URL(url).pathname
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), prazoPorPedidoMs)
    let resposta
    let corpo
    try {
      resposta = await fetchImpl(url, {
        ...init,
        signal: controle.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      })
      if (resposta.ok) corpo = await resposta.json()
    } catch {
      throw new Error(`Falha de rede, prazo estourado ou resposta ilegivel na API do GitHub em ${caminho}.`)
    } finally {
      clearTimeout(relogio)
    }
    if (!resposta.ok) throw new Error(`A API do GitHub respondeu ${resposta.status} em ${caminho}.`)
    return { corpo, link: resposta.headers.get('link') }
  }
  const paginas = async (url) => {
    const lidas = []
    for (let atual = url; atual;) {
      if (lidas.length >= MAX_PAGINAS) throw new Error(`A lista passou de ${MAX_PAGINAS} paginas em ${new URL(url).pathname}.`)
      const { corpo, link } = await pedir(atual)
      lidas.push(corpo)
      atual = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? '')?.[1] ?? null
      if (atual && !atual.startsWith(`${API}/`)) throw new Error('A paginacao do GitHub apontou para fora da API.')
    }
    return lidas
  }
  const lista = async (url) => {
    const lidas = await paginas(url)
    if (!lidas.every(Array.isArray)) throw new Error(`Resposta fora do formato de lista em ${new URL(url).pathname}.`)
    return lidas.flat()
  }
  return { pedir, paginas, lista }
}

function lerEvento(env) {
  const disparo = { id: Number(env.SINO_RUN_ID), run_attempt: Number(env.SINO_RUN_ATTEMPT), conclusion: env.SINO_RUN_CONCLUSION }
  if (!REPOSITORIO.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('GITHUB_REPOSITORY ausente ou invalido.')
  if (!textoCheio(env.GITHUB_TOKEN)) throw new Error('GITHUB_TOKEN ausente.')
  if (!SHA_COMPLETO.test(env.SINO_SHA ?? '')) throw new Error('Commit do evento ausente ou invalido.')
  // eslint-disable-next-line no-control-regex
  if (!textoCheio(env.SINO_BRANCH) || /[\x00-\x1f\x7f]/.test(env.SINO_BRANCH)) throw new Error('Branch do evento ausente ou invalida.')
  if (!inteiroPositivo(disparo.id) || !inteiroPositivo(disparo.run_attempt) || !/^[a-z_]+$/.test(disparo.conclusion ?? '')) {
    throw new Error('Execucao do evento ausente ou invalida.')
  }
  return { repositorio: env.GITHUB_REPOSITORY, sha: env.SINO_SHA, branch: env.SINO_BRANCH, disparo }
}

/** Uma volta do sino: devolve `{ acao, motivo, prs }`; erro lancado e recusa (job vermelho, nada comentado). */
export async function executarSino({ env, fetchImpl = fetch, log = console.log, prazoPorPedidoMs = PRAZO_POR_PEDIDO_MS }) {
  const { repositorio, sha, branch, disparo } = lerEvento(env)
  const github = clienteDoGithub({ token: env.GITHUB_TOKEN, fetchImpl, prazoPorPedidoMs })
  const dono = repositorio.split('/')[0]

  const escolha = escolherPrs(await github.lista(`${API}/repos/${repositorio}/pulls?state=open&head=${encodeURIComponent(`${dono}:${branch}`)}&per_page=100`), { repositorio, sha })
  if (escolha.situacao === 'recusar') throw new Error(escolha.motivo)
  if (escolha.situacao === 'ignorar') return { acao: 'ignorar', motivo: escolha.motivo, prs: [] }

  const paginas = await github.paginas(`${API}/repos/${repositorio}/actions/runs?head_sha=${sha}&exclude_pull_requests=true&per_page=100`)
  const avaliacao = avaliarExecucoes({
    total_count: paginas[0]?.total_count,
    workflow_runs: paginas.every((pagina) => Array.isArray(pagina?.workflow_runs)) ? paginas.flatMap((pagina) => pagina.workflow_runs) : undefined,
  }, { sha, disparo })
  if (avaliacao.situacao === 'recusar') throw new Error(avaliacao.motivo)
  if (avaliacao.situacao === 'aguardar') return { acao: 'aguardar', motivo: avaliacao.motivo, prs: [] }

  const comentados = []
  for (const numero of escolha.numeros) {
    const comentarios = await github.lista(`${API}/repos/${repositorio}/issues/${numero}/comments?per_page=100`)
    const decisao = decidirAviso({ avaliacao, comentarios, sha, repositorio })
    if (decisao.acao === 'recusar') throw new Error(decisao.motivo)
    if (decisao.acao === 'ignorar') continue
    await github.pedir(`${API}/repos/${repositorio}/issues/${numero}/comments`, { method: 'POST', body: JSON.stringify({ body: decisao.corpo }) })
    log(`PR #${numero}: aviso publicado.`)
    comentados.push(numero)
  }
  return comentados.length > 0
    ? { acao: 'comentar', motivo: null, prs: comentados }
    : { acao: 'ignorar', motivo: 'O sino já deu este aviso neste commit.', prs: [] }
}

async function main() {
  const ocultar = (texto) => String(texto).split(process.env.GITHUB_TOKEN || '\u0000').join('[OCULTO]')
  try {
    const resultado = await executarSino({ env: process.env })
    const prs = resultado.prs.map((numero) => `#${numero}`).join(', ')
    console.log(`Sino do CI: ${resultado.acao}${prs ? ` (PR ${prs})` : ''}. ${ocultar(resultado.motivo ?? '')}`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Sino do CI: ${resultado.acao}${prs ? ` (PR ${prs})` : ''}\n`)
  } catch (erro) {
    console.error(ocultar(erro instanceof Error ? erro.message : erro))
    process.exitCode = 1
  }
}

const execucaoDireta = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (execucaoDireta) await main()
