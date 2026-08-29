import { pathToFileURL } from 'node:url'

/**
 * Aponta o preview da Vercel para o banco de teste daquela pull request.
 *
 * O Supabase ja cria uma ramificacao de banco por PR que mexe em arquivos do
 * Supabase. O que faltava era avisar a Vercel qual banco usar: sem isso, todo
 * preview conversa com o mesmo banco compartilhado e duas PRs se atropelam.
 *
 * A regra e deliberadamente simples:
 *
 * - PR SEM ramificacao (nao mexeu em migration) continua no banco
 *   compartilhado, pelas variaveis genericas de Preview. Nada a fazer aqui.
 * - PR COM ramificacao ganha variaveis amarradas ao nome da branch. Na Vercel,
 *   variavel de branch manda por cima da generica.
 *
 * Na duvida este script falha FECHADO: preview vermelho e melhor que preview
 * verde conversando com o banco errado.
 */

export const PRODUCTION_PROJECT_REF = 'gohluceldchoitihrimw'

export const VARIAVEIS_DO_BANCO = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

/**
 * Quantas ramificacoes a listagem do Supabase devolve antes de truncar. O
 * endpoint nao documenta paginacao, entao tratamos uma lista cheia como
 * "pode estar truncada" e nao como "nao existe ramificacao".
 */
export const LIMITE_PAGINA_RAMIFICACOES = 100

/** Estados em que a ramificacao ainda nao serve para o site conversar. */
const ESTADOS_EM_CRIACAO = new Set([
  'CREATING_PROJECT',
  'RUNNING_MIGRATIONS',
  'MIGRATIONS_PASSED',
  'FUNCTIONS_DEPLOYING',
])

const ESTADOS_DE_FALHA = new Set([
  'MIGRATIONS_FAILED',
  'FUNCTIONS_FAILED',
])

/**
 * Encontra a ramificacao de banco daquela PR.
 *
 * Devolve `{ situacao: 'encontrada' | 'sem-ramificacao' }` ou lanca. A
 * diferenca importa: "sem ramificacao" e um caminho normal (PR sem migration),
 * enquanto ambiguidade e campo faltando sao erro.
 */
export function escolherRamificacao(ramificacoes, { prNumber, gitBranch }) {
  if (!Array.isArray(ramificacoes)) {
    throw new Error('A listagem de ramificacoes do Supabase nao veio como lista.')
  }
  if (!gitBranch) {
    throw new Error('Nome da branch ausente: nao da para saber qual ramificacao pertence a esta PR.')
  }

  const candidatas = ramificacoes.filter((ramificacao) => {
    if (!ramificacao || ramificacao.is_default === true) return false
    if (prNumber != null && Number(ramificacao.pr_number) === Number(prNumber)) return true
    return ramificacao.git_branch === gitBranch
  })

  if (candidatas.length > 1) {
    const nomes = candidatas.map((c) => c.name ?? c.id ?? '(sem nome)').join(', ')
    throw new Error(
      `Mais de uma ramificacao responde por esta PR (${nomes}); recusado por seguranca.`,
    )
  }

  if (candidatas.length === 0) {
    // Uma lista cheia pode estar truncada. Nesse caso NAO da para concluir que
    // a PR nao tem ramificacao: seria mandar uma PR com migration testar no
    // banco compartilhado, exatamente o erro que este script existe para evitar.
    if (ramificacoes.length >= LIMITE_PAGINA_RAMIFICACOES) {
      throw new Error(
        'A listagem de ramificacoes veio no limite da pagina e pode estar truncada; '
        + 'nao da para afirmar que esta PR nao tem banco proprio.',
      )
    }
    return { situacao: 'sem-ramificacao' }
  }

  const ramificacao = candidatas[0]
  if (!ramificacao.project_ref) {
    throw new Error('A ramificacao encontrada nao informa project_ref; recusado por seguranca.')
  }
  if (ramificacao.project_ref === PRODUCTION_PROJECT_REF) {
    throw new Error('A ramificacao aponta para o projeto de producao; recusado por seguranca.')
  }

  return { situacao: 'encontrada', ramificacao }
}

/** A ramificacao ja pode receber conexao? */
export function ramificacaoEstaPronta(ramificacao) {
  if (!ramificacao) return false
  if (ESTADOS_DE_FALHA.has(ramificacao.status)) {
    throw new Error(
      `A ramificacao desta PR falhou no Supabase (${ramificacao.status}); `
      + 'conserte o banco da PR antes de testar o preview.',
    )
  }
  if (ramificacao.preview_project_status !== 'ACTIVE_HEALTHY') return false
  return !ESTADOS_EM_CRIACAO.has(ramificacao.status)
}

/**
 * Escolhe a chave publica do banco da PR.
 *
 * Prefere a chave nova (`sb_publishable_...`) e aceita a legada `anon` como
 * reserva, porque projetos criados em epocas diferentes expoem uma ou outra.
 */
export function escolherChavePublica(chaves) {
  if (!Array.isArray(chaves)) {
    throw new Error('A listagem de chaves do Supabase nao veio como lista.')
  }

  const publicavel = chaves.find((chave) => chave?.type === 'publishable' && chave.api_key)
  if (publicavel) return publicavel.api_key

  const legada = chaves.find((chave) => chave?.name === 'anon' && chave.api_key)
  if (legada) return legada.api_key

  throw new Error('O banco desta PR nao expos nenhuma chave publica utilizavel.')
}

/** O par de variaveis que a Vercel precisa receber para esta branch. */
export function planejarVariaveis({ projectRef, chavePublica, gitBranch }) {
  if (!projectRef) throw new Error('project_ref ausente ao montar as variaveis.')
  if (!chavePublica) throw new Error('Chave publica ausente ao montar as variaveis.')
  if (!gitBranch) throw new Error('Nome da branch ausente ao montar as variaveis.')

  return [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      value: `https://${projectRef}.supabase.co`,
      // `plain` porque tudo que comeca com NEXT_PUBLIC_ viaja no navegador: a
      // propria Vercel recusa marcar essas variaveis como secretas.
      type: 'plain',
      target: ['preview'],
      gitBranch,
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      value: chavePublica,
      type: 'plain',
      target: ['preview'],
      gitBranch,
    },
  ]
}

async function pedir(url, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  const resposta = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '')
    throw new Error(`${method} ${url} respondeu ${resposta.status}. ${detalhe}`.trim())
  }

  if (resposta.status === 204) return null
  return resposta.json()
}

function comEscopo(url, teamId) {
  if (!teamId) return url
  return `${url}${url.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`
}

export async function apontarPreviewParaRamificacao({
  prNumber,
  gitBranch,
  supabaseToken,
  vercelToken,
  vercelProject,
  vercelTeamId,
  esperarSegundos = 300,
  intervaloSegundos = 10,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  registrar = console.log,
  fetchImpl = fetch,
}) {
  if (!supabaseToken) throw new Error('SUPABASE_ACCESS_TOKEN ausente.')
  if (!vercelToken) throw new Error('VERCEL_TOKEN ausente.')
  if (!vercelProject) throw new Error('Projeto da Vercel ausente.')

  // A listagem pode chegar como lista pura ou embrulhada em `branches`. Como
  // este script nasceu sem poder bater na API de verdade (o token so existe
  // dentro do GitHub), ele aceita as duas formas em vez de apostar numa.
  const listar = async () => {
    const corpo = await pedir(
      `https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT_REF}/branches`,
      { token: supabaseToken, fetchImpl },
    )
    return Array.isArray(corpo) ? corpo : corpo?.branches
  }

  let escolha = escolherRamificacao(await listar(), { prNumber, gitBranch })
  if (escolha.situacao === 'sem-ramificacao') {
    registrar(
      'Esta PR nao tem banco proprio, o que e o normal para quem nao mexe em migration. '
      + 'O preview segue no Banco Preview compartilhado, que espelha a main.',
    )
    return { situacao: 'sem-ramificacao' }
  }

  const limite = Date.now() + esperarSegundos * 1000
  while (!ramificacaoEstaPronta(escolha.ramificacao)) {
    if (Date.now() >= limite) {
      throw new Error(
        `O banco desta PR nao ficou pronto em ${esperarSegundos}s `
        + `(estado ${escolha.ramificacao.status}/${escolha.ramificacao.preview_project_status}).`,
      )
    }
    registrar(`Banco da PR ainda nascendo (${escolha.ramificacao.status}); esperando.`)
    await dormir(intervaloSegundos * 1000)
    escolha = escolherRamificacao(await listar(), { prNumber, gitBranch })
    if (escolha.situacao === 'sem-ramificacao') {
      throw new Error('A ramificacao desta PR desapareceu no meio da espera.')
    }
  }

  const refDaRamificacao = escolha.ramificacao.project_ref
  const chaves = await pedir(
    `https://api.supabase.com/v1/projects/${refDaRamificacao}/api-keys?reveal=true`,
    { token: supabaseToken, fetchImpl },
  )
  const chavePublica = escolherChavePublica(chaves?.keys ?? chaves)

  const variaveis = planejarVariaveis({
    projectRef: refDaRamificacao,
    chavePublica,
    gitBranch,
  })

  for (const variavel of variaveis) {
    await pedir(
      comEscopo(
        `https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProject)}/env?upsert=true`,
        vercelTeamId,
      ),
      { token: vercelToken, method: 'POST', body: variavel, fetchImpl },
    )
  }

  registrar(`Preview desta PR apontado para o banco ${refDaRamificacao}.`)

  const redeploy = await reconstruirPreview({
    gitBranch,
    vercelToken,
    vercelProject,
    vercelTeamId,
    registrar,
    fetchImpl,
  })

  return { situacao: 'apontado', projectRef: refDaRamificacao, redeploy }
}

/**
 * Manda a Vercel refazer o preview da branch.
 *
 * Sem isto, o deploy que ja tinha subido continua com as variaveis antigas: um
 * deploy nao se refaz sozinho quando a configuracao muda. Se ainda nao existir
 * deploy nenhum, nao ha nada a refazer e o proximo ja nasce certo.
 */
export async function reconstruirPreview({
  gitBranch,
  vercelToken,
  vercelProject,
  vercelTeamId,
  registrar = console.log,
  fetchImpl = fetch,
}) {
  const lista = await pedir(
    comEscopo(
      `https://api.vercel.com/v6/deployments?app=${encodeURIComponent(vercelProject)}&target=preview&limit=20`,
      vercelTeamId,
    ),
    { token: vercelToken, fetchImpl },
  )

  const daBranch = (lista?.deployments ?? []).find(
    (deployment) => deployment?.meta?.githubCommitRef === gitBranch,
  )

  if (!daBranch) {
    registrar('Nenhum preview desta branch existe ainda; o proximo ja nasce com o banco certo.')
    return { situacao: 'nada-a-refazer' }
  }

  await pedir(
    comEscopo('https://api.vercel.com/v13/deployments?forceNew=1', vercelTeamId),
    {
      token: vercelToken,
      method: 'POST',
      body: { name: vercelProject, deploymentId: daBranch.uid, target: 'preview' },
      fetchImpl,
    },
  )

  registrar('Preview mandado reconstruir com o banco da PR.')
  return { situacao: 'refeito', deploymentId: daBranch.uid }
}

/**
 * Apaga as variaveis daquela branch quando a PR fecha.
 *
 * O Supabase apaga o banco sozinho; sobra a variavel apontando para um
 * endereco morto, que confundiria qualquer preview futuro do mesmo nome.
 */
export async function limparVariaveisDaBranch({
  gitBranch,
  vercelToken,
  vercelProject,
  vercelTeamId,
  registrar = console.log,
  fetchImpl = fetch,
}) {
  if (!gitBranch) throw new Error('Nome da branch ausente ao limpar as variaveis.')

  const lista = await pedir(
    comEscopo(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProject)}/env?gitBranch=${encodeURIComponent(gitBranch)}`,
      vercelTeamId,
    ),
    { token: vercelToken, fetchImpl },
  )

  const alvos = (lista?.envs ?? []).filter(
    (variavel) => VARIAVEIS_DO_BANCO.includes(variavel?.key) && variavel.gitBranch === gitBranch,
  )

  for (const alvo of alvos) {
    await pedir(
      comEscopo(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProject)}/env/${encodeURIComponent(alvo.id)}`,
        vercelTeamId,
      ),
      { token: vercelToken, method: 'DELETE', fetchImpl },
    )
  }

  registrar(`${alvos.length} variavel(is) desta branch removida(s) da Vercel.`)
  return { removidas: alvos.length }
}

async function main() {
  const acao = process.env.ACAO
  const comum = {
    gitBranch: process.env.GIT_BRANCH,
    vercelToken: process.env.VERCEL_TOKEN,
    vercelProject: process.env.VERCEL_PROJECT,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
  }

  if (acao === 'limpar') {
    await limparVariaveisDaBranch(comum)
    return
  }

  await apontarPreviewParaRamificacao({
    ...comum,
    prNumber: process.env.PR_NUMBER,
    supabaseToken: process.env.SUPABASE_ACCESS_TOKEN,
  })
}

const execucaoDireta = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (execucaoDireta) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha desconhecida ao apontar o banco da PR.')
    process.exitCode = 1
  })
}
