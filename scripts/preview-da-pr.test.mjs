import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIMITE_ARQUIVOS_COMPARACAO,
  LIMITE_COMMITS_CONSULTADOS,
  LIMITE_COMMITS_PR,
  commitsAnterioresDaPr,
  comparacaoPermiteReuso,
  escolherDeploymentVerde,
  localizarPreviewDaPr,
} from './preview-da-pr.mjs'

const REPO = 'dono/repo'
const API = `https://api.github.com/repos/${REPO}`
const sha = (n) => String(n).padStart(40, 'a')
const HEAD = sha(9)
const URL_VERDE = 'https://pane-git-branch.vercel.app'

const verde = (url = URL_VERDE) => [{ state: 'success', environment_url: url }]
const falhou = [{ state: 'failure' }, { state: 'success', environment_url: 'https://antigo.vercel.app' }]
const doc = (filename) => ({ filename, status: 'modified' })

/**
 * Monta um GitHub de mentira: `deployments` por SHA (lista de listas de
 * status), `commits` da PR em ordem cronologica e `comparacoes` por
 * `base...head`. URL nao cadastrada responde 404, como a API real.
 */
function githubFalso({ deployments = {}, commits = [], comparacoes = {} }) {
  const chamadas = []
  const porId = new Map()
  let proximoId = 1
  const listaPorSha = Object.fromEntries(Object.entries(deployments).map(([s, lista]) => [
    s,
    lista.map((statuses) => {
      const id = proximoId++
      porId.set(id, statuses)
      return { id, sha: s }
    }),
  ]))
  const responder = (corpo) => ({ ok: true, status: 200, json: async () => corpo })
  const fetchImpl = async (url) => {
    chamadas.push(url)
    const u = new URL(url)
    const caminho = u.pathname.replace(`/repos/${REPO}`, '')
    if (caminho === '/deployments') return responder(listaPorSha[u.searchParams.get('sha')] ?? [])
    const status = caminho.match(/^\/deployments\/(\d+)\/statuses$/)
    if (status) return responder(porId.get(Number(status[1])))
    if (caminho === '/pulls/7/commits') {
      const pagina = Number(u.searchParams.get('page'))
      return responder(commits.slice((pagina - 1) * 100, pagina * 100).map((s) => ({ sha: s })))
    }
    const comparacao = caminho.match(/^\/compare\/(.+)$/)
    if (comparacao && comparacoes[comparacao[1]]) return responder(comparacoes[comparacao[1]])
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchImpl, chamadas }
}

const localizar = (github) => localizarPreviewDaPr({ repositorio: REPO, prNumber: 7, headSha: HEAD, fetchImpl: github.fetchImpl })

describe('escolherDeploymentVerde', () => {
  it('lista vazia ou invalida nao escolhe nada', () => {
    assert.equal(escolherDeploymentVerde([]), null)
    assert.equal(escolherDeploymentVerde(undefined), null)
  })

  it('so decide pelo status MAIS RECENTE de cada deployment', () => {
    assert.equal(escolherDeploymentVerde([{ statuses: falhou }]), null)
    assert.equal(escolherDeploymentVerde([{ statuses: [{ state: 'in_progress' }] }]), null)
  })

  it('campo ausente nao vira preview', () => {
    assert.equal(escolherDeploymentVerde([{}]), null)
    assert.equal(escolherDeploymentVerde([{ statuses: [{ state: 'success' }] }]), null)
    assert.equal(escolherDeploymentVerde([{ statuses: [] }]), null)
  })

  it('decide so pela deployment mais nova: redeploy vermelho ou em andamento nao cai na verde antiga', () => {
    assert.equal(escolherDeploymentVerde([{ statuses: falhou }, { statuses: verde() }]), null)
    assert.equal(escolherDeploymentVerde([{ statuses: [{ state: 'in_progress' }] }, { statuses: verde() }]), null)
    assert.equal(escolherDeploymentVerde([{ statuses: verde() }, { statuses: falhou }]), URL_VERDE)
  })
})

describe('commitsAnterioresDaPr', () => {
  it('devolve os anteriores ao atual, do mais novo para o mais antigo', () => {
    const r = commitsAnterioresDaPr([sha(1), sha(2), HEAD, sha(3)].map((s) => ({ sha: s })), HEAD)
    assert.deepEqual(r, { ok: true, anteriores: [sha(2), sha(1)] })
  })

  it('lista vazia, sha ausente e commit atual fora da lista falham fechado', () => {
    assert.equal(commitsAnterioresDaPr([], HEAD).ok, false)
    assert.equal(commitsAnterioresDaPr([{ sha: sha(1) }, {}, { sha: HEAD }], HEAD).ok, false)
    assert.equal(commitsAnterioresDaPr([{ sha: sha(1) }], HEAD).ok, false)
  })

  it('lista no limite de paginacao do GitHub falha fechado', () => {
    const cheia = Array.from({ length: LIMITE_COMMITS_PR }, (_, i) => ({ sha: sha(1000 + i) }))
    cheia[cheia.length - 1] = { sha: HEAD }
    const r = commitsAnterioresDaPr(cheia, HEAD)
    assert.equal(r.ok, false)
    assert.match(r.motivo, /truncada/)
  })
})

describe('comparacaoPermiteReuso', () => {
  it('aceita so documentacao ou mecanismo de CI depois de um ancestral', () => {
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files: [doc('AGENTS.md'), doc('docs/X.md')] }).ok, true)
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files: [doc('scripts/change-scope.mjs')] }).ok, true)
  })

  it('codigo, vercel.json sem conferencia, historico divergente ou campo ausente reprovam', () => {
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files: [doc('AGENTS.md'), doc('src/app/page.tsx')] }).ok, false)
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files: [doc('vercel.json')] }).ok, false)
    assert.equal(comparacaoPermiteReuso({ status: 'diverged', files: [doc('AGENTS.md')] }).ok, false)
    assert.equal(comparacaoPermiteReuso({ status: 'behind', files: [] }).ok, false)
    assert.equal(comparacaoPermiteReuso({ status: 'ahead' }).ok, false)
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files: [] }).ok, false)
    assert.equal(comparacaoPermiteReuso(undefined).ok, false)
  })

  it('lista de arquivos no limite da comparacao falha fechado', () => {
    const files = Array.from({ length: LIMITE_ARQUIVOS_COMPARACAO }, (_, i) => doc(`docs/D${i}.md`))
    assert.equal(comparacaoPermiteReuso({ status: 'ahead', files }).ok, false)
  })
})

describe('localizarPreviewDaPr', () => {
  it('commit atual com preview verde: usa ele, sem olhar o resto', async () => {
    const github = githubFalso({ deployments: { [HEAD]: [verde('https://atual.vercel.app')] } })
    assert.equal(await localizar(github), 'https://atual.vercel.app')
    assert.ok(github.chamadas.every((url) => !url.includes('/pulls/') && !url.includes('/compare/')))
  })

  it('commit atual com redeploy em andamento sobre verde antiga: falha fechado', async () => {
    const github = githubFalso({ deployments: { [HEAD]: [[{ state: 'in_progress' }], verde()] } })
    await assert.rejects(localizar(github), /ainda nao publicou um preview verde/)
  })

  it('commit atual com deployment vermelha: falha, sem recorrer a commit anterior', async () => {
    const github = githubFalso({
      deployments: { [HEAD]: [falhou], [sha(1)]: [verde()] },
      commits: [sha(1), HEAD],
    })
    await assert.rejects(localizar(github), /ainda nao publicou um preview verde/)
  })

  it('verde antigo + push so de texto ignorado pela Vercel: usa o verde antigo (caso da PR #453)', async () => {
    const github = githubFalso({
      deployments: { [sha(1)]: [verde()] },
      commits: [sha(1), HEAD],
      comparacoes: { [`${sha(1)}...${HEAD}`]: { status: 'ahead', files: [doc('AGENTS.md')] } },
    })
    assert.equal(await localizar(github), URL_VERDE)
  })

  it('anda por varios pushes ignorados ate o ultimo publicado', async () => {
    const github = githubFalso({
      deployments: { [sha(1)]: [verde('https://velho.vercel.app')], [sha(2)]: [verde()] },
      commits: [sha(1), sha(2), sha(3), HEAD],
      comparacoes: { [`${sha(2)}...${HEAD}`]: { status: 'ahead', files: [doc('AGENTS.md'), doc('docs/A.md')] } },
    })
    assert.equal(await localizar(github), URL_VERDE)
  })

  it('ultimo publicado vermelho: nao volta a um verde mais antigo', async () => {
    const github = githubFalso({
      deployments: { [sha(1)]: [verde()], [sha(2)]: [falhou] },
      commits: [sha(1), sha(2), HEAD],
    })
    await assert.rejects(localizar(github), /\(aaaaaaa\) nao tem preview verde/)
  })

  it('codigo entre o publicado e o atual: falha fechado', async () => {
    const github = githubFalso({
      deployments: { [sha(1)]: [verde()] },
      commits: [sha(1), HEAD],
      comparacoes: { [`${sha(1)}...${HEAD}`]: { status: 'ahead', files: [doc('src/lib/x.ts')] } },
    })
    await assert.rejects(localizar(github), /exige build novo/)
  })

  it('nenhuma deployment na PR inteira (lista vazia): falha fechado', async () => {
    await assert.rejects(localizar(githubFalso({ commits: [sha(1), HEAD] })), /nenhum dos ultimos/)
    await assert.rejects(localizar(githubFalso({ commits: [HEAD] })), /nenhum dos ultimos/)
  })

  it('so consulta um numero limitado de commits anteriores', async () => {
    const antigos = Array.from({ length: LIMITE_COMMITS_CONSULTADOS + 2 }, (_, i) => sha(100 + i))
    const github = githubFalso({ deployments: { [antigos[0]]: [verde()] }, commits: [...antigos, HEAD] })
    await assert.rejects(localizar(github), /nenhum dos ultimos/)
  })

  it('lista de commits da PR truncada no limite de paginacao: falha fechado', async () => {
    const commits = Array.from({ length: LIMITE_COMMITS_PR }, (_, i) => sha(1000 + i))
    commits[commits.length - 1] = HEAD
    const github = githubFalso({ deployments: { [commits[0]]: [verde()] }, commits })
    await assert.rejects(localizar(github), /truncada/)
    assert.equal(github.chamadas.filter((url) => url.includes('/pulls/7/commits')).length, 3)
  })

  it('commit atual ausente da lista (push novo durante o teste): falha fechado', async () => {
    const github = githubFalso({ deployments: { [sha(1)]: [verde()] }, commits: [sha(1)] })
    await assert.rejects(localizar(github), /nao aparece na lista/)
  })

  it('comparacao indisponivel: falha fechado', async () => {
    const github = githubFalso({ deployments: { [sha(1)]: [verde()] }, commits: [sha(1), HEAD] })
    await assert.rejects(localizar(github), /respondeu 404/)
  })

  it('evento sem numero da PR ou sem commit: falha fechado', async () => {
    await assert.rejects(localizarPreviewDaPr({ repositorio: REPO, headSha: HEAD, fetchImpl: async () => { throw new Error('nao devia chamar') } }), /nao informou/)
    await assert.rejects(localizarPreviewDaPr({ repositorio: REPO, prNumber: 7, fetchImpl: async () => { throw new Error('nao devia chamar') } }), /nao informou/)
  })
})
