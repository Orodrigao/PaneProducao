import { classificarPerfilMudancas } from './change-scope.mjs'

/**
 * Localiza o preview verde da Vercel que corresponde ao commit atual de uma
 * PR. Usado pelo smoke de fotos (test/browser/auth.smoke.spec.ts), que precisa
 * falar com o banco para onde o preview daquela PR aponta.
 *
 * Por que nao basta procurar pelo commit atual: o `ignoreCommand` da Vercel
 * (ignore-documentation-build.mjs) pula o build quando tudo desde a ultima
 * deployment da branch e documentacao ou mecanismo de CI. Commit pulado nao
 * ganha deployment nenhum no GitHub, entao numa PR com codigo cujo ultimo
 * push foi so de texto o preview do commit atual nunca existe (PR #453, commit
 * 7b4bd1f). O preview certo e o do ultimo commit que a Vercel de fato
 * publicou.
 *
 * Por que nao buscar pelo nome da branch: a Vercel registra a deployment no
 * GitHub com `ref` igual ao SHA do commit, nunca ao nome da branch.
 *
 * Regra de reuso, toda ela fail-closed (na duvida, sem preview e o teste
 * reprova com a mensagem certa):
 *
 * - commit atual com deployment: decide so pela mais nova dele;
 * - sem deployment: anda pelos commits DA PROPRIA PR, do mais novo para o
 *   mais antigo, ate o primeiro que tenha deployment. Esse precisa estar
 *   verde (sem voltar mais para tras) e a comparacao dele ate o commit atual
 *   precisa provar que ele e ancestral e que so mudou documentacao ou
 *   mecanismo de CI, pelo mesmo classificador que a Vercel usa. Assim o codigo
 *   publicado e o mesmo do commit atual, e o banco e o da mesma branch.
 */

/** A API do GitHub para de listar commits de PR em 250, sem avisar. */
export const LIMITE_COMMITS_PR = 250
/** Quantos commits anteriores consultar antes de desistir. */
export const LIMITE_COMMITS_CONSULTADOS = 10
/** A comparacao do GitHub lista no maximo 300 arquivos, sem avisar. */
export const LIMITE_ARQUIVOS_COMPARACAO = 300

const SHA_COMPLETO = /^[0-9a-f]{40}$/

/**
 * Entre as deployments de UM commit (mais nova primeiro, com os status de
 * cada uma, mais novo primeiro), decide SO pela mais nova: devolve a URL dela
 * se o status mais recente for `success`, senao `null`. O workflow Banco por
 * PR refaz o deploy no mesmo commit depois de apontar o preview para o banco
 * da PR; aceitar uma verde mais antiga testaria contra o banco errado.
 */
export function escolherDeploymentVerde(deployments) {
  if (!Array.isArray(deployments)) return null
  const statuses = deployments[0]?.statuses
  const ultimo = Array.isArray(statuses) ? statuses[0] : undefined
  if (ultimo?.state === 'success' && typeof ultimo.environment_url === 'string' && ultimo.environment_url) {
    return ultimo.environment_url
  }
  return null
}

/**
 * Commits da PR anteriores ao commit atual, do mais novo para o mais antigo.
 * Lista truncada, commit atual ausente (push novo no meio do teste) ou SHA
 * malformado viram erro, nunca uma lista parcial.
 */
export function commitsAnterioresDaPr(commits, headSha) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return { ok: false, motivo: 'A PR nao listou nenhum commit.' }
  }
  if (commits.length >= LIMITE_COMMITS_PR) {
    return { ok: false, motivo: `A PR tem ${LIMITE_COMMITS_PR} commits ou mais; a lista do GitHub pode estar truncada.` }
  }
  const shas = commits.map((commit) => commit?.sha)
  if (shas.some((sha) => typeof sha !== 'string' || !SHA_COMPLETO.test(sha))) {
    return { ok: false, motivo: 'A lista de commits da PR veio com SHA ausente ou malformado.' }
  }
  const posicaoHead = shas.indexOf(headSha)
  if (posicaoHead === -1) {
    return { ok: false, motivo: 'O commit atual nao aparece na lista de commits da PR.' }
  }
  return { ok: true, anteriores: shas.slice(0, posicaoHead).reverse() }
}

/**
 * A comparacao `publicado...atual` prova que o preview publicado serve para o
 * commit atual: publicado e ancestral e so houve documentacao ou mecanismo de
 * CI no meio. `vercel.json` sem referencia git cai em 'product' no
 * classificador, de proposito.
 */
export function comparacaoPermiteReuso(comparacao) {
  if (!comparacao || (comparacao.status !== 'ahead' && comparacao.status !== 'identical')) {
    return { ok: false, motivo: `o commit publicado nao e ancestral do atual (status ${comparacao?.status ?? 'ausente'}).` }
  }
  const arquivos = comparacao.files
  if (!Array.isArray(arquivos)) {
    return { ok: false, motivo: 'a comparacao nao listou os arquivos alterados.' }
  }
  if (arquivos.length >= LIMITE_ARQUIVOS_COMPARACAO) {
    return { ok: false, motivo: 'a lista de arquivos da comparacao pode estar truncada.' }
  }
  if (comparacao.status === 'identical' && arquivos.length === 0) return { ok: true }
  const { perfil, motivo, arquivo } = classificarPerfilMudancas(arquivos)
  if (perfil === 'documentation' || perfil === 'ci-mechanism') return { ok: true }
  return { ok: false, motivo: `houve mudanca que exige build novo (${motivo ?? perfil}${arquivo ? `: ${arquivo}` : ''}).` }
}

async function pedirJson(url, fetchImpl) {
  const resposta = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!resposta.ok) throw new Error(`O GitHub respondeu ${resposta.status} ao localizar o preview da PR (${url}).`)
  return resposta.json()
}

async function deploymentsDoCommit({ api, sha, fetchImpl }) {
  const deployments = await pedirJson(`${api}/deployments?sha=${sha}&environment=Preview&per_page=10`, fetchImpl)
  if (!Array.isArray(deployments)) throw new Error('A lista de deployments do GitHub nao veio como lista.')
  const maisNova = deployments[0]
  if (!maisNova) return { existe: false, deployments: [] }
  if (!maisNova.id) return { existe: true, deployments: [] }
  const statuses = await pedirJson(`${api}/deployments/${maisNova.id}/statuses?per_page=20`, fetchImpl)
  return { existe: true, deployments: [{ id: maisNova.id, statuses }] }
}

async function listarCommitsDaPr({ api, prNumber, fetchImpl }) {
  const commits = []
  for (let pagina = 1; pagina <= Math.ceil(LIMITE_COMMITS_PR / 100); pagina += 1) {
    const lote = await pedirJson(`${api}/pulls/${prNumber}/commits?per_page=100&page=${pagina}`, fetchImpl)
    if (!Array.isArray(lote)) throw new Error('A lista de commits da PR nao veio como lista.')
    commits.push(...lote)
    if (lote.length < 100) break
  }
  return commits
}

export async function localizarPreviewDaPr({ repositorio, prNumber, headSha, fetchImpl = fetch }) {
  if (!repositorio || !prNumber || !headSha) {
    throw new Error('O evento da PR nao informou repositorio, numero e commit para localizar o preview.')
  }
  const api = `https://api.github.com/repos/${repositorio}`
  const semPreview = 'A Vercel ainda nao publicou um preview verde para o commit atual da PR'

  const atual = await deploymentsDoCommit({ api, sha: headSha, fetchImpl })
  if (atual.existe) {
    const url = escolherDeploymentVerde(atual.deployments)
    if (url) return url
    throw new Error(`${semPreview}.`)
  }

  const lista = commitsAnterioresDaPr(await listarCommitsDaPr({ api, prNumber, fetchImpl }), headSha)
  if (!lista.ok) throw new Error(`${semPreview}: ${lista.motivo}`)

  for (const sha of lista.anteriores.slice(0, LIMITE_COMMITS_CONSULTADOS)) {
    const anterior = await deploymentsDoCommit({ api, sha, fetchImpl })
    if (!anterior.existe) continue
    const url = escolherDeploymentVerde(anterior.deployments)
    if (!url) throw new Error(`${semPreview}: o ultimo commit publicado (${sha.slice(0, 7)}) nao tem preview verde.`)
    const reuso = comparacaoPermiteReuso(await pedirJson(`${api}/compare/${sha}...${headSha}`, fetchImpl))
    if (!reuso.ok) throw new Error(`${semPreview}: ${reuso.motivo}`)
    return url
  }
  throw new Error(`${semPreview}: nenhum dos ultimos ${LIMITE_COMMITS_CONSULTADOS} commits da PR tem deployment.`)
}
