import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { calcularMergeBase, classificarPerfilPorReferencias, referenciaGitValida } from './change-scope.mjs'

/**
 * `ignoreCommand` da Vercel (vercel.json). Roda ANTES da instalacao de
 * dependencias, para toda deployment (preview ou producao). Sai com 0 para
 * cancelar o build (economico) e com 1 para segui-lo — essa e a unica
 * semantica documentada pela Vercel; nao inventar um terceiro codigo.
 *
 * A referencia "commit anterior" e `VERCEL_GIT_PREVIOUS_SHA`: o SHA da ultima
 * deployment BEM-SUCEDIDA daquela branch (documentado pela Vercel). So existe
 * quando ha um Ignored Build Step configurado, e falta na primeira deployment
 * de uma branch nova — os dois casos em que este script constroi, nunca
 * dispensa.
 *
 * ATENCAO — merge-base sozinho NAO prova que o commit anterior implantado
 * seja ancestral do commit atual, e essa prova e obrigatoria aqui (diferente
 * do uso de `classificarPerfilPorReferencias` numa PR, onde a base e um alvo
 * movel e o merge-base e exatamente a tecnica certa para achar o ponto de
 * bifurcacao). Exemplo concreto do risco: ancestral comum A; uma branch B
 * antiga parte de A e altera codigo-fonte, e fica implantada; a nova head C
 * tambem parte de A (nao de B) e so altera documentacao. `merge-base(B, C)`
 * devolve A, e o diff A..C parece "so documental" — mas o que esta no ar
 * agora e o codigo de B, que C nunca viu e portanto nunca removeria se
 * fosse construido. Dispensar o build nessa situacao mantém codigo morto no
 * ar indefinidamente. Por isso este script confirma primeiro que o
 * ancestral comum entre o commit anterior e o atual e LITERALMENTE o commit
 * anterior (`baseReal === VERCEL_GIT_PREVIOUS_SHA`), o equivalente a `git
 * merge-base --is-ancestor`, antes de sequer calcular o diff. Historico
 * insuficiente (clone raso da Vercel), historico divergente OU primeira
 * deployment de uma branch nova (sem `VERCEL_GIT_PREVIOUS_SHA`) tambem falham
 * fechado: constroem, nunca dispensam — EXCETO o fallback restrito de
 * primeira deployment de PREVIEW descrito em `decidirPrimeiraDeploymentPreview`
 * logo abaixo. Perfil 'ci-mechanism' (ver `classificarPerfilMudancas` em
 * change-scope.mjs) dispensa o build pelo mesmo motivo que 'documentation':
 * nenhum dos oito caminhos do mecanismo de CI cadastrado entra no bundle que
 * a Vercel publica.
 */

export function resolverReferencias(env = process.env) {
  return {
    base: env.VERCEL_GIT_PREVIOUS_SHA,
    head: env.VERCEL_GIT_COMMIT_SHA,
  }
}

/**
 * Profundidade e teto de tempo do fetch de fallback (ver
 * `decidirPrimeiraDeploymentPreview`): uma UNICA tentativa, sem laco de
 * novas tentativas. 50 commits cobre folgadamente o ritmo de push deste
 * repositorio; se nao bastar, o merge-base seguinte falha (historico
 * insuficiente) e o resultado e falha fechada (constroi), nunca um laco que
 * tenta profundidades maiores.
 */
const PROFUNDIDADE_FETCH_FALLBACK_PREVIEW = 50
const TIMEOUT_FETCH_FALLBACK_PREVIEW_MS = 15_000

/**
 * URL HTTPS publica e fixa do repositorio, usada SOMENTE por este fallback.
 * NAO usa o remoto `origin` do clone da Vercel: reproduzido em producao na
 * PR #383, o clone da branch da PR nao tem remoto nenhum configurado —
 * `git fetch origin main` falha com `fatal: 'origin' does not appear to be
 * a git repository`, antes mesmo de qualquer questao de refspec restrito
 * (essa era a suposicao errada da versao anterior deste fallback). A URL e
 * publica, sem token nem credencial embutida.
 */
export const URL_REPOSITORIO_PUBLICO = 'https://github.com/Orodrigao/PaneProducao.git'

/**
 * Primeira deployment de uma branch de PREVIEW nunca tem
 * `VERCEL_GIT_PREVIOUS_SHA` (documentado pela Vercel: so existe a partir da
 * segunda deployment bem-sucedida da mesma branch). Sem este fallback, TODA
 * primeira preview de TODA PR construía o ERP inteiro mesmo quando ela so
 * toca o mecanismo de CI cadastrado ou documentacao aprovada — inclusive a
 * primeira preview desta propria branch.
 *
 * Fallback restrito e de UMA UNICA tentativa (sem retry, sem laço): busca
 * `main` da URL publica fixa acima (nunca do remoto `origin`, que a Vercel
 * nao configura no clone da branch da PR) com profundidade e timeout
 * limitados e confirma que o SHA resolvido e ANCESTRAL LITERAL do commit
 * atual (mesma tecnica de ancestralidade usada para `VERCEL_GIT_PREVIOUS_SHA`
 * acima) antes de classificar o diff COMPLETO main..head com o mesmo
 * classificador tri-estado. Qualquer falha no meio do caminho — fetch,
 * resolucao do SHA, ausencia de ancestral comum ou ancestral que nao e
 * literalmente o `main` buscado — falha fechado: constroi. Nao usa `HEAD^`,
 * mensagem de commit, nome de branch isolado nem qualquer suposicao sobre a
 * base.
 *
 * ATENCAO — `git rev-parse origin/main` (ou qualquer coisa que dependa de um
 * remoto configurado) NAO serve aqui: alem de nao haver remoto `origin`
 * nenhum no clone da Vercel, mesmo COM um remoto configurado um clone raso
 * single-branch restringe o refspec aquela UNICA branch, entao
 * `refs/remotes/origin/main` nao existiria de qualquer forma. A fonte de
 * verdade correta e `FETCH_HEAD` — a referencia que o proprio `git fetch`
 * acabou de escrever — resolvida com `--verify` e `^{commit}` para garantir
 * que aponta a um commit de verdade e nao a uma tag anotada ou lixo.
 *
 * Nao usa token, API nem variavel de ambiente para a URL: o repositorio e
 * publico e o comando nomeia a URL fixa e `main`, sem credencial embutida e
 * sem indireção configuravel. So se aplica quando `VERCEL_GIT_PREVIOUS_SHA`
 * esta literalmente AUSENTE (nao apenas invalido) e `VERCEL_ENV ===
 * 'preview'` — producao sem commit anterior segue sem fallback (motivo
 * `sem-base`), e um `VERCEL_GIT_PREVIOUS_SHA` presente porem
 * invalido/divergente tambem segue sem fallback: so a AUSENCIA franca do
 * valor caracteriza "primeira deployment", nunca um valor que a Vercel de
 * fato mandou e que nao serve.
 *
 * A profundidade do fetch (`PROFUNDIDADE_FETCH_FALLBACK_PREVIEW`) precisa
 * cobrir tambem a distancia real ate o ponto de bifurcacao na PROPRIA
 * branch: a Vercel documenta clone raso de profundidade 10 para a branch da
 * PR, e o merge-base so enxerga alem desse limite se `main` estiver dentro
 * da janela que o clone da propria branch ja trouxe. Historico insuficiente
 * (bifurcacao mais antiga que a profundidade buscada) falha fechado
 * normalmente (motivo `sem-base-fallback-sem-ancestral`), sem segunda busca
 * nem laco de tentativas crescentes.
 */
function decidirPrimeiraDeploymentPreview({ head, execImpl }) {
  let mainRecemBuscado
  try {
    execImpl(
      'git',
      ['fetch', '--quiet', `--depth=${PROFUNDIDADE_FETCH_FALLBACK_PREVIEW}`, URL_REPOSITORIO_PUBLICO, 'main'],
      { encoding: 'utf8', timeout: TIMEOUT_FETCH_FALLBACK_PREVIEW_MS },
    )
    mainRecemBuscado = String(
      execImpl('git', ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { encoding: 'utf8' }),
    ).trim()
  } catch (erro) {
    return {
      perfil: 'product',
      documental: false,
      motivo: 'sem-base-fallback-fetch-falhou',
      detalhe: erro instanceof Error ? erro.message : String(erro),
    }
  }
  if (!referenciaGitValida(mainRecemBuscado)) {
    return { perfil: 'product', documental: false, motivo: 'sem-base-fallback-fetch-falhou' }
  }

  let ancestralComum
  try {
    ancestralComum = calcularMergeBase({ base: mainRecemBuscado, head, execImpl })
  } catch (erro) {
    return {
      perfil: 'product',
      documental: false,
      motivo: 'sem-base-fallback-sem-ancestral',
      detalhe: erro instanceof Error ? erro.message : String(erro),
    }
  }
  if (ancestralComum !== mainRecemBuscado) {
    return {
      perfil: 'product',
      documental: false,
      motivo: 'sem-base-fallback-nao-ancestral',
      detalhe: `main buscado da URL publica fixa (${mainRecemBuscado}) nao e ancestral literal do commit atual (${head}); o ancestral comum real e ${ancestralComum}.`,
    }
  }

  const resultado = classificarPerfilPorReferencias({ base: mainRecemBuscado, head, execImpl })
  return { ...resultado, documental: resultado.perfil === 'documentation', primeiraPreview: true }
}

/**
 * Devolve `perfil` ('documentation' | 'ci-mechanism' | 'product') e, por
 * compatibilidade com quem ja consumia o campo booleano historico,
 * `documental` (`true` somente quando `perfil === 'documentation'`).
 */
export function decidirIgnorarBuild({ env = process.env, execImpl = execFileSync } = {}) {
  const { base, head } = resolverReferencias(env)
  try {
    if (!referenciaGitValida(head)) {
      return { perfil: 'product', documental: false, motivo: 'sem-head' }
    }
    if (!referenciaGitValida(base)) {
      const baseAusente = base === undefined || base === null || base === ''
      if (baseAusente && env.VERCEL_ENV === 'preview') {
        return decidirPrimeiraDeploymentPreview({ head, execImpl })
      }
      return { perfil: 'product', documental: false, motivo: 'sem-base' }
    }
    const baseReal = calcularMergeBase({ base, head, execImpl })
    if (baseReal !== String(base)) {
      return {
        perfil: 'product',
        documental: false,
        motivo: 'base-nao-ancestral',
        detalhe: `VERCEL_GIT_PREVIOUS_SHA (${base}) nao e ancestral de VERCEL_GIT_COMMIT_SHA (${head}); o ancestral comum real e ${baseReal}.`,
      }
    }
    const resultado = classificarPerfilPorReferencias({ base, head, execImpl })
    return { ...resultado, documental: resultado.perfil === 'documentation' }
  } catch (erro) {
    return {
      perfil: 'product',
      documental: false,
      motivo: 'erro-git',
      detalhe: erro instanceof Error ? erro.message : String(erro),
    }
  }
}

function main() {
  const resultado = decidirIgnorarBuild()
  if (resultado.perfil !== 'product') {
    // Primeira preview de uma branch nao tem deployment anterior nenhuma: a
    // comparacao foi contra o `main` buscado agora, nao contra um commit ja
    // implantado por esta mesma branch (ver decidirPrimeiraDeploymentPreview).
    const origemComparacao = resultado.primeiraPreview
      ? 'a main buscada agora (primeira deployment desta branch, sem deployment anterior)'
      : 'a ultima deployment desta branch'
    console.log(`Mudanca classificada como "${resultado.perfil}" desde ${origemComparacao}; build dispensado.`)
    process.exitCode = 0
    return
  }
  console.log(`Build necessario (motivo: ${resultado.motivo}).`)
  process.exitCode = 1
}

const execucaoDireta = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (execucaoDireta) main()
