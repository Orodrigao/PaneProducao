import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  FLUXOS_VIGIADOS,
  MAX_PAGINAS,
  NOME_FLUXO_SINO,
  avaliarExecucoes,
  decidirAviso,
  escolherPrs,
  executarSino,
  marcadorDoAviso,
} from './sino-ci.mjs'

const REPO = 'dono/repo'
const SHA = 'a'.repeat(40)
const OUTRO_SHA = 'b'.repeat(40)
const TOKEN = 'ghs_tokenFalsoQueNaoPodeSairDoGithub'
const BOT = { login: 'github-actions[bot]', type: 'Bot' }

const execucao = (extra = {}) => ({
  id: 1,
  workflow_id: 11,
  name: 'CI',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA,
  run_attempt: 1,
  created_at: '2026-10-21T12:00:00Z',
  ...extra,
})
const ci = (extra) => execucao({ id: 1, workflow_id: 11, name: 'CI', ...extra })
const ciBanco = (extra) => execucao({ id: 2, workflow_id: 12, name: 'CI Banco (ensaio de migrations)', ...extra })
const bancoPorPr = (extra) => execucao({ id: 3, workflow_id: 13, name: 'Banco por PR', ...extra })
const tres = () => [ci(), ciBanco(), bancoPorPr()]
const rodando = { status: 'in_progress', conclusion: null }
const lista = (...runs) => ({ total_count: runs.length, workflow_runs: runs })
const disparo = (extra = {}) => ({ id: 1, run_attempt: 1, conclusion: 'success', ...extra })
const pr = (extra = {}) => ({
  number: 7,
  head: { sha: SHA, repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO } },
  ...extra,
})
const doBot = (body) => ({ user: BOT, body })
const avaliar = (runs, d = disparo()) => avaliarExecucoes(lista(...runs), { sha: SHA, disparo: d })
const avisar = (avaliacao, comentarios = [], extra = {}) => decidirAviso({ avaliacao, comentarios, sha: SHA, repositorio: REPO, ...extra })

function parado(...runs) {
  const avaliacao = avaliar(runs)
  assert.equal(avaliacao.situacao, 'parado', avaliacao.motivo)
  return avaliacao
}

describe('avaliarExecucoes', () => {
  it('espera enquanto alguma verificacao do Actions do commit ainda roda', () => {
    const avaliacao = avaliar([ci(), ciBanco(rodando), bancoPorPr({ status: 'queued', conclusion: null })])
    assert.equal(avaliacao.situacao, 'aguardar')
    assert.match(avaliacao.motivo, /CI Banco .*Banco por PR/)
  })

  it('para com sucesso, pulada ou neutra como verdes; o resto e falha', () => {
    assert.deepEqual(parado(ci(), ciBanco({ conclusion: 'skipped' }), bancoPorPr({ conclusion: 'neutral' })).falhas, [])
    const avaliacao = parado(ci(), ciBanco({ conclusion: 'failure' }), bancoPorPr({ conclusion: 'cancelled' }), execucao({ id: 4, workflow_id: 14, name: 'X', conclusion: null }))
    assert.deepEqual(avaliacao.falhas.map((item) => [item.nome, item.conclusao]), [
      ['CI Banco (ensaio de migrations)', 'failure'],
      ['Banco por PR', 'cancelled'],
      ['X', null],
    ])
  })

  it('fica de fora so quem roda por workflow_run (o proprio sino); fluxo da PR com o nome do sino conta', () => {
    const sino = execucao({ id: 9, workflow_id: 19, name: NOME_FLUXO_SINO, event: 'workflow_run', ...rodando })
    assert.deepEqual(parado(...tres(), sino).execucoes.map((item) => item.nome), FLUXOS_VIGIADOS.slice(0, 3))
    assert.equal(avaliar([...tres(), { ...sino, event: 'pull_request' }]).situacao, 'aguardar')
  })

  it('qualquer execucao rodando segura o aviso; paradas, toda execucao conta: a verde nao esconde a falha de outro contexto', () => {
    const daMain = (extra) => ci({ id: 1, ...extra })
    const daOutraPr = (extra) => ci({ id: 5, created_at: '2026-10-21T12:05:00Z', ...extra })
    const avaliacao = parado(daMain({ conclusion: 'failure' }), daOutraPr(), ciBanco())
    assert.deepEqual(avaliacao.falhas.map((item) => [item.id, item.conclusao]), [[1, 'failure']])
    assert.equal(avaliacao.rodada, '1.1,2.1,5.1')
    assert.equal(avaliar([daMain(rodando), daOutraPr(), ciBanco()], disparo({ id: 2 })).situacao, 'aguardar')
    assert.equal(avaliar([daMain(), daOutraPr(rodando), ciBanco()]).situacao, 'aguardar')
  })

  it('a execucao que disparou conta como terminada mesmo se a API ainda nao viu, ou estiver na tentativa anterior', () => {
    assert.deepEqual(avaliar([ci(rodando), ciBanco()], disparo({ conclusion: 'failure' })).falhas.map((item) => item.nome), ['CI'])
    const nova = avaliar([ci({ conclusion: 'failure' }), ciBanco()], disparo({ run_attempt: 2 }))
    assert.deepEqual(nova.falhas, [])
    assert.equal(nova.rodada, '1.2,2.1')
    assert.equal(avaliar([ci({ run_attempt: 2, ...rodando }), ciBanco()]).situacao, 'aguardar')
  })

  it('a rodada nao depende da ordem e muda quando alguem roda de novo', () => {
    const primeira = parado(...tres()).rodada
    assert.equal(parado(bancoPorPr(), ci(), ciBanco()).rodada, primeira)
    assert.notEqual(avaliar([ci({ run_attempt: 2 }), ciBanco(), bancoPorPr()], disparo({ run_attempt: 2 })).rodada, primeira)
  })

  it('lista vazia, campo ausente e lista truncada recusam', () => {
    const recusa = (corpo) => avaliarExecucoes(corpo, { sha: SHA, disparo: disparo() }).situacao
    for (const corpo of [lista(), lista(execucao({ event: 'workflow_run' })), {}, undefined, { workflow_runs: tres() }, { total_count: 4, workflow_runs: tres() }, lista(...tres(), null)]) {
      assert.equal(recusa(corpo), 'recusar', JSON.stringify(corpo))
    }
    for (const campo of ['id', 'workflow_id', 'name', 'event', 'status', 'head_sha', 'run_attempt', 'created_at']) {
      const run = ci()
      delete run[campo]
      assert.equal(recusa(lista(run, ciBanco())), 'recusar', campo)
    }
    assert.equal(recusa(lista(ci({ status: 'algo-novo' }))), 'recusar')
  })

  it('execucao de outro commit, disparo ausente da lista ou disparo invalido recusam', () => {
    assert.equal(avaliar([ci(), ciBanco({ head_sha: OUTRO_SHA })]).situacao, 'recusar')
    assert.equal(avaliar([ciBanco()]).situacao, 'recusar')
    for (const ruim of [disparo({ id: 'x' }), disparo({ run_attempt: 0 }), disparo({ conclusion: '' }), null]) {
      assert.equal(avaliar(tres(), ruim).situacao, 'recusar', JSON.stringify(ruim))
    }
  })
})

describe('escolherPrs', () => {
  const escolher = (prs) => escolherPrs(prs, { repositorio: REPO, sha: SHA })

  it('avisa a PR aberta da casa, contra a main, neste commit', () => {
    assert.deepEqual(escolher([pr(), pr({ number: 3 })]), { situacao: 'avisar', numeros: [3, 7], motivo: null })
  })

  it('commit antigo, nenhuma PR, outra base, fork ou outro repositorio: nao avisa', () => {
    assert.match(escolher([pr({ head: { sha: OUTRO_SHA, repo: { full_name: REPO } } })]).motivo, /outro commit/)
    for (const prs of [[], [pr({ base: { ref: 'outra', repo: { full_name: REPO } } })], [pr({ head: { sha: SHA, repo: { full_name: 'fork/repo' } } })],
      [pr({ head: { sha: SHA, repo: null } })], [pr({ base: { ref: 'main', repo: { full_name: 'outro/repo' } } })]]) {
      assert.equal(escolher(prs).situacao, 'ignorar', JSON.stringify(prs))
    }
  })

  it('lista invalida ou campo ausente recusa', () => {
    for (const prs of [undefined, {}, [null], [pr({ number: undefined })], [pr({ head: undefined })], [pr({ head: { repo: { full_name: REPO } } })]]) {
      assert.equal(escolher(prs).situacao, 'recusar', JSON.stringify(prs))
    }
  })
})

describe('decidirAviso', () => {
  const verde = () => parado(ci(), ciBanco({ conclusion: 'skipped' }), bancoPorPr())
  const vermelho = () => parado(ci(), ciBanco({ conclusion: 'failure' }), bancoPorPr())

  it('avisa que nada roda e o que terminou verde, mandando conferir antes de Verify e Check', () => {
    const avaliacao = verde()
    const decisao = avisar(avaliacao)
    assert.equal(decisao.acao, 'comentar')
    assert.ok(decisao.corpo.startsWith(marcadorDoAviso(SHA, avaliacao.rodada)))
    assert.match(decisao.corpo, /na consulta ao GitHub Actions, nenhuma verificação estava rodando para o commit `aaaaaaa`/)
    assert.match(decisao.corpo, /todas verdes \(CI, CI Banco \(ensaio de migrations\), Banco por PR\)\./)
    assert.match(avisar(parado(...tres(), ci({ id: 5 }))).corpo, /todas verdes \(CI, CI Banco \(ensaio de migrations\), Banco por PR\)\./)
    assert.match(decisao.corpo, /Confira `gh pr checks` antes de `Verify` e `Check`/)
    assert.match(decisao.corpo, /Vercel, CodeRabbit/)
    assert.match(decisao.corpo, /não autoriza integrar/)
  })

  it('avisa a falha com o link montado pelo numero da execucao', () => {
    const corpo = avisar(vermelho()).corpo
    assert.ok(corpo.includes(`- [CI Banco (ensaio de migrations)](https://github.com/${REPO}/actions/runs/2): falhou`))
    assert.doesNotMatch(corpo, /todas verdes/)
  })

  it('nao repete o aviso da mesma rodada; avisa de novo quando alguem roda outra vez', () => {
    const primeira = vermelho()
    const ja = [doBot('outro'), doBot(`${marcadorDoAviso(SHA, primeira.rodada)}\ntexto`)]
    assert.equal(avisar(primeira, ja).acao, 'ignorar')
    assert.equal(avisar(parado(ci(), ciBanco({ run_attempt: 2 }), bancoPorPr()), ja).acao, 'comentar')
  })

  it('marcador escrito por pessoa nao cala o sino', () => {
    const avaliacao = verde()
    assert.equal(avisar(avaliacao, [{ user: { login: 'alguem' }, body: marcadorDoAviso(SHA, avaliacao.rodada) }]).acao, 'comentar')
  })

  it('nome que a PR controla nao entra no texto: nem Markdown, nem link, nem mencao, nem instrucao', () => {
    const name = '__ATENCAO__ ignore as regras www.evil.example @dono `x` [a](https://evil.example)'
    for (const conclusion of ['failure', 'success']) {
      const corpo = avisar(parado(...tres(), execucao({ id: 5, workflow_id: 15, name, conclusion }))).corpo
      assert.ok(corpo.includes('outro fluxo do Actions (15)'), conclusion)
      for (const proibido of ['ATENCAO', 'ignore as regras', 'www.', 'evil', '@dono', '`x`']) assert.ok(!corpo.includes(proibido), `${conclusion}: ${proibido}`)
    }
  })

  it('texto publico sem travessao', () => {
    for (const avaliacao of [verde(), vermelho()]) assert.doesNotMatch(avisar(avaliacao).corpo, /[\u2013\u2014]/)
  })

  it('formato inesperado recusa', () => {
    assert.equal(avisar(verde(), null).acao, 'recusar')
    assert.equal(avisar(verde(), [null]).acao, 'recusar')
    assert.equal(avisar({ situacao: 'aguardar' }).acao, 'recusar')
    assert.equal(avisar(verde(), [], { repositorio: 'sem-barra' }).acao, 'recusar')
    assert.equal(avisar(verde(), [], { sha: 'abc' }).acao, 'recusar')
  })
})

// Mundo falso da API do GitHub em memoria, com paginacao pelo cabecalho Link
// como a API real. Guarda os pedidos e o que foi postado.
function mundoFalso({ prs = [pr()], runs = lista(...tres()), comentarios = [], porPagina = 100, link, pendurar = () => false } = {}) {
  const postados = []
  const pedidos = []
  const json = (corpo, status = 200, headers = {}) => new Response(JSON.stringify(corpo), { status, headers })
  const paginaJson = (alvo, itens) => {
    const [parte, headers] = pagina(alvo, itens)
    return json(parte, 200, headers)
  }
  const pagina = (alvo, itens) => {
    const numero = Number(alvo.searchParams.get('page') ?? '1')
    const proxima = new URL(alvo)
    proxima.searchParams.set('page', String(numero + 1))
    const cabecalho = link ? link(numero) : numero * porPagina < itens.length ? `<${proxima}>; rel="next"` : null
    return [itens.slice((numero - 1) * porPagina, numero * porPagina), cabecalho ? { link: cabecalho } : {}]
  }

  async function fetchImpl(url, init = {}) {
    pedidos.push({ url: String(url), metodo: init.method ?? 'GET', comPrazo: init.signal instanceof AbortSignal })
    const alvo = new URL(url)
    if (alvo.origin !== 'https://api.github.com') throw new Error(`pedido para fora da API: ${url}`)
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return json({ message: 'sem token' }, 401)
    if (pendurar(alvo)) return new Promise((_, rejeitar) => init.signal.addEventListener('abort', () => rejeitar(init.signal.reason)))
    if (alvo.pathname === `/repos/${REPO}/pulls`) {
      assert.equal(alvo.searchParams.get('state'), 'open')
      assert.equal(alvo.searchParams.get('head'), 'dono:feat/exemplo')
      return paginaJson(alvo, prs)
    }
    if (alvo.pathname === `/repos/${REPO}/actions/runs`) {
      assert.equal(alvo.searchParams.get('head_sha'), SHA)
      if (runs instanceof Response) return runs
      const [itens, headers] = pagina(alvo, runs.workflow_runs)
      return json({ total_count: runs.total_count, workflow_runs: itens }, 200, headers)
    }
    const doPr = /^\/repos\/dono\/repo\/issues\/(\d+)\/comments$/.exec(alvo.pathname)
    if (doPr && init.method === 'POST') {
      const body = JSON.parse(init.body).body
      postados.push({ numero: Number(doPr[1]), body })
      comentarios.push(doBot(body))
      return json({ id: postados.length }, 201)
    }
    if (doPr) return paginaJson(alvo, comentarios)
    return json({ message: 'nao existe' }, 404)
  }
  return { fetchImpl, postados, pedidos }
}

const ambiente = (extra = {}) => ({
  GITHUB_REPOSITORY: REPO,
  GITHUB_TOKEN: TOKEN,
  SINO_SHA: SHA,
  SINO_BRANCH: 'feat/exemplo',
  SINO_RUN_ID: '1',
  SINO_RUN_ATTEMPT: '1',
  SINO_RUN_CONCLUSION: 'success',
  ...extra,
})
const rodar = (mundo, extra, opcoes) => executarSino({ env: ambiente(extra), fetchImpl: mundo.fetchImpl, log: () => {}, ...opcoes })

describe('executarSino', () => {
  it('comenta uma vez e, chamado de novo no mesmo estado, nao repete', async () => {
    const mundo = mundoFalso()
    assert.equal((await rodar(mundo)).acao, 'comentar')
    assert.deepEqual(mundo.postados.map((item) => item.numero), [7])
    assert.equal((await rodar(mundo)).acao, 'ignorar')
    assert.equal(mundo.postados.length, 1)
  })

  it('verificacao rodando: nao comenta e nem le os comentarios', async () => {
    const mundo = mundoFalso({ runs: lista(ci(), ciBanco(rodando)) })
    assert.equal((await rodar(mundo)).acao, 'aguardar')
    assert.equal(mundo.postados.length, 0)
    assert.ok(!mundo.pedidos.some((pedido) => pedido.url.includes('/comments')))
  })

  it('execucoes e comentarios em varias paginas: acha o aviso ja dado', async () => {
    const avaliacao = parado(...tres())
    const comentarios = [doBot('a'), doBot('b'), doBot('c'), doBot(marcadorDoAviso(SHA, avaliacao.rodada)), doBot('e')]
    const mundo = mundoFalso({ comentarios, porPagina: 2 })
    assert.equal((await rodar(mundo)).acao, 'ignorar')
    assert.equal(mundo.postados.length, 0)
    assert.equal(mundo.pedidos.filter((pedido) => pedido.url.includes('/comments')).length, 3)
    assert.equal(mundo.pedidos.filter((pedido) => pedido.url.includes('/actions/runs')).length, 2)
  })

  it('lista alem do limite de paginas, paginacao para fora da API ou erro da API recusam sem comentar nem vazar o token', async () => {
    const casos = [
      [mundoFalso({ comentarios: Array.from({ length: (MAX_PAGINAS + 1) * 2 }, (_, i) => doBot(String(i))), porPagina: 2 }), /paginas/],
      [mundoFalso({ link: () => '<https://evil.example/x?page=2>; rel="next"' }), /fora da API/],
      [mundoFalso({ runs: new Response('{}', { status: 500 }) }), /500/],
      [mundoFalso({ runs: { total_count: 4, workflow_runs: tres() } }), /incompleta/],
    ]
    for (const [mundo, erro] of casos) {
      await assert.rejects(rodar(mundo), (falha) => erro.test(falha.message) && !falha.message.includes(TOKEN))
      assert.equal(mundo.postados.length, 0)
      assert.ok(mundo.pedidos.every((pedido) => pedido.url.startsWith('https://api.github.com/')))
    }
  })

  it('pedido que nao responde estoura o prazo dele; todo pedido leva prazo', async () => {
    const mundo = mundoFalso({ pendurar: (alvo) => alvo.pathname.endsWith('/actions/runs') })
    await assert.rejects(rodar(mundo, {}, { prazoPorPedidoMs: 5 }), /prazo/)
    assert.equal(mundo.postados.length, 0)
    assert.ok(mundo.pedidos.every((pedido) => pedido.comPrazo))
  })

  it('dado do evento invalido recusa antes de qualquer pedido', async () => {
    for (const extra of [{ SINO_SHA: 'abc' }, { SINO_SHA: undefined }, { SINO_BRANCH: '' }, { SINO_BRANCH: 'feat/x\nlinha' }, { SINO_RUN_ID: 'x' },
      { SINO_RUN_ATTEMPT: '0' }, { SINO_RUN_CONCLUSION: '' }, { GITHUB_REPOSITORY: 'sem-barra' }, { GITHUB_TOKEN: '' }]) {
      const mundo = mundoFalso()
      await assert.rejects(rodar(mundo, extra), undefined, JSON.stringify(extra))
      assert.equal(mundo.pedidos.length, 0, JSON.stringify(extra))
    }
  })

  it('commit antigo ou branch sem PR: nao comenta e nao le execucoes', async () => {
    for (const prs of [[], [pr({ head: { sha: OUTRO_SHA, repo: { full_name: REPO } } })]]) {
      const mundo = mundoFalso({ prs })
      assert.equal((await rodar(mundo)).acao, 'ignorar')
      assert.ok(!mundo.pedidos.some((pedido) => pedido.url.includes('/actions/runs')))
    }
  })
})

// ---------------------------------------------------------------------------
// Guardas dos workflows. O sino so acorda quando um fluxo vigiado termina, e o
// GitHub casa a lista `workflows:` pelo `name:` de cada arquivo: renomear o CI
// calaria o sino sem erro nenhum. Leitura minima e estrita do YAML, so os
// formatos que os workflows deste repositorio usam (indentacao de 2 espacos);
// formato que ela nao conhece reprova, nunca passa como "nao roda em PR".
// ---------------------------------------------------------------------------

const PASTA_WORKFLOWS = new URL('../.github/workflows/', import.meta.url)
const ARQUIVO_SINO = 'sino-ci.yml'
const semAspas = (texto) => texto.trim().replace(/^(['"])(.*)\1$/, '$2')
const semComentario = (linha) => linha.replace(/(^|\s)#.*$/, '').replace(/\s+$/, '')
const ordenado = (itens) => [...itens].sort()

function nomeDoFluxo(texto) {
  const casamento = /^name:\s*(.+)$/m.exec(texto)
  if (!casamento) throw new Error('workflow sem name: no topo')
  return semAspas(semComentario(casamento[1]))
}

/** Linhas do bloco de primeiro nivel `on:`, sem comentarios. */
function blocoOn(texto) {
  const linhas = texto.split('\n').map(semComentario)
  const inicio = linhas.findIndex((linha) => linha === 'on:' || linha.startsWith('on: '))
  if (inicio === -1) throw new Error('workflow sem bloco on:')
  if (linhas[inicio] !== 'on:') throw new Error(`formato de on: nao conhecido: ${linhas[inicio]}`)
  const fim = linhas.findIndex((linha, indice) => indice > inicio && /^\S/.test(linha))
  return linhas.slice(inicio + 1, fim === -1 ? undefined : fim)
}

/** Fluxos que o sino vigia: os itens de on.workflow_run.workflows. */
function fluxosVigiados(texto) {
  const on = blocoOn(texto)
  const inicio = on.indexOf('    workflows:')
  if (inicio === -1) throw new Error('sino sem on.workflow_run.workflows')
  const itens = []
  for (const linha of on.slice(inicio + 1)) {
    const item = /^ {6}- (.+)$/.exec(linha)
    if (!item) break
    itens.push(semAspas(item[1]))
  }
  return itens
}

/**
 * Se o fluxo roda como verificacao de PR: algum gatilho pull_request ou
 * pull_request_target com tipo alem de `closed`. Estrito: linha que cite
 * pull_request fora do formato, ou linha do gatilho que nao seja types,
 * branches ou paths no formato conhecido, reprova.
 */
function rodaEmPr(texto) {
  const on = blocoOn(texto)
  let roda = false
  on.forEach((linha, indice) => {
    if (!linha.includes('pull_request')) return
    if (!/^ {2}(pull_request|pull_request_target):$/.test(linha)) throw new Error(`gatilho de PR em formato nao conhecido: ${linha.trim()}`)
    const fim = on.findIndex((outra, j) => j > indice && /^ {2}\S/.test(outra))
    let tipos = null
    let emLista = false
    for (const sub of on.slice(indice + 1, fim === -1 ? undefined : fim)) {
      if (sub === '' || (emLista && /^ {6}- \S/.test(sub))) continue
      const campo = /^ {4}(types|branches|paths):(.*)$/.exec(sub)
      if (!campo) throw new Error(`linha nao conhecida no gatilho de PR: ${sub.trim()}`)
      emLista = campo[1] === 'paths' && campo[2].trim() === ''
      if (emLista) continue
      const valores = /^\[(.*)\]$/.exec(campo[2].trim())
      if (!valores) throw new Error(`${campo[1]}: fora do formato [a, b]`)
      if (campo[1] === 'types') tipos = valores[1].split(',').map(semAspas).filter(Boolean)
    }
    if (!tipos || tipos.some((tipo) => tipo !== 'closed')) roda = true
  })
  return roda
}

function conferirVigiados(arquivos) {
  const sino = arquivos.find((arquivo) => arquivo.nome === ARQUIVO_SINO)
  if (!sino) throw new Error(`${ARQUIVO_SINO} ausente`)
  const outros = arquivos.filter((arquivo) => arquivo !== sino)
  const nomes = outros.map((arquivo) => nomeDoFluxo(arquivo.texto))
  const vigiados = fluxosVigiados(sino.texto)
  return {
    vigiados,
    inexistentes: vigiados.filter((nome) => nomes.filter((outro) => outro === nome).length !== 1),
    esquecidos: outros.filter((arquivo) => rodaEmPr(arquivo.texto)).map((arquivo) => nomeDoFluxo(arquivo.texto)).filter((nome) => !vigiados.includes(nome)),
  }
}

const arquivosReais = () => readdirSync(PASTA_WORKFLOWS)
  .filter((nome) => nome.endsWith('.yml') || nome.endsWith('.yaml'))
  .sort()
  .map((nome) => ({ nome, texto: readFileSync(new URL(nome, PASTA_WORKFLOWS), 'utf8').replace(/\r\n/g, '\n') }))
const textoDoSino = () => arquivosReais().find((arquivo) => arquivo.nome === ARQUIVO_SINO).texto

describe('guarda dos fluxos vigiados', () => {
  const fabricado = (nome, corpoOn) => ({ nome: `${nome}.yml`, texto: `name: ${nome}\n\non:\n${corpoOn}\njobs:\n  x:\n    runs-on: ubuntu-latest\n` })
  const sinoFabricado = (...vigiados) => ({
    nome: ARQUIVO_SINO,
    texto: `name: ${NOME_FLUXO_SINO}\n\non:\n  workflow_run:\n    workflows:\n${vigiados.map((nome) => `      - ${nome}`).join('\n')}\n    types: [completed]\n\njobs: {}\n`,
  })

  it('reprova fluxo vigiado renomeado ou sumido e fluxo de PR fora da lista; ignora o que so roda ao fechar a PR', () => {
    const resultado = conferirVigiados([
      sinoFabricado('CI', 'Banco por PR'),
      fabricado('CI renomeado', '  pull_request:\n'),
      fabricado('Banco por PR', "  pull_request:\n    types: [opened, closed]\n    branches: [main]\n    paths:\n      - 'supabase/**'\n      # nota\n"),
      fabricado('Novo', "  pull_request_target:\n    types: ['opened']\n"),
      fabricado('Segundo gatilho', '  pull_request:\n    types: [closed]\n  pull_request_target:\n    types: [opened]\n'),
      fabricado('Comentado', '  pull_request: # roda em toda PR\n'),
      fabricado('Comentario na coluna zero', '  push:\n# nota solta\n  pull_request:\n'),
      fabricado('So ao fechar', '  pull_request:\n    types: [closed]\n  push:\n    branches: [main]\n'),
      fabricado('Producao', '  push:\n    branches: [main]\n'),
    ])
    assert.deepEqual(resultado.inexistentes, ['CI'])
    assert.deepEqual(ordenado(resultado.esquecidos), ['CI renomeado', 'Comentado', 'Comentario na coluna zero', 'Novo', 'Segundo gatilho'])
  })

  it('formato de gatilho desconhecido reprova em vez de passar calado', () => {
    for (const corpoOn of ['on: [pull_request]\n', 'on:\n  pull_request: {}\n', 'on:\n   pull_request:\n', 'on:\n  pull_request:\n    types:\n      - opened\n',
      "on:\n  pull_request:\n    paths : ['x/**']\n", 'on:\n  pull_request:\n    types : [opened]\n', "on:\n  pull_request:\n    paths-ignore: ['docs/**']\n"]) {
      assert.throws(() => rodaEmPr(`name: X\n${corpoOn}`), undefined, corpoOn)
    }
  })

  it('todo fluxo vigiado existe uma vez em .github/workflows, todo fluxo de PR esta vigiado e a lista do script e a do workflow', () => {
    const resultado = conferirVigiados(arquivosReais())
    assert.ok(resultado.vigiados.length >= 4, resultado.vigiados.join(', '))
    assert.deepEqual(resultado.inexistentes, [])
    assert.deepEqual(resultado.esquecidos, [])
    assert.deepEqual(ordenado(FLUXOS_VIGIADOS), ordenado(resultado.vigiados))
  })

  it('o nome do sino no script e o do workflow, e ele nao vigia a si mesmo', () => {
    assert.equal(nomeDoFluxo(textoDoSino()), NOME_FLUXO_SINO)
    assert.ok(!fluxosVigiados(textoDoSino()).includes(NOME_FLUXO_SINO))
  })
})

describe('o workflow do sino', () => {
  const texto = textoDoSino()
  const linhas = texto.split('\n')

  it('so acorda com fluxo terminado, fora da main e de PR da casa', () => {
    assert.match(texto, /^ {4}types: \[completed\]$/m)
    assert.match(texto, /^ {4}branches-ignore: \[main\]$/m)
    assert.match(texto, /^ {4}if: github\.event\.workflow_run\.head_repository\.full_name == github\.repository$/m)
  })

  it('permissao minima: nada no topo; no job, ler codigo e execucoes e comentar em PR', () => {
    assert.match(texto, /^permissions: \{\}$/m)
    const bloco = texto.match(/^ {4}permissions:\n((?: {6}\S.*\n)+)/m)
    assert.ok(bloco, 'job sem permissions')
    assert.deepEqual(bloco[1].trim().split('\n').map((linha) => linha.trim()).sort(), ['actions: read', 'contents: read', 'pull-requests: write'])
  })

  it('roda o script do commit da main: checkout em github.sha, sem guardar o token, dado do evento so por variavel', () => {
    assert.deepEqual(linhas.filter((linha) => /^\s+ref:/.test(linha)).map((linha) => linha.trim()), ['ref: ${{ github.sha }}'])
    assert.match(texto, /^ {10}persist-credentials: false$/m)
    assert.match(texto, /^ {10}sparse-checkout: scripts\/sino-ci\.mjs$/m)
    const comandos = linhas.filter((linha) => /^\s+(- )?run:/.test(linha))
    assert.deepEqual(comandos.map((linha) => linha.trim()), ['run: node scripts/sino-ci.mjs'])
  })

  it('fila por commit sem cancelar quem espera', () => {
    assert.match(texto, /^ {2}group: .*workflow_run\.head_sha/m)
    assert.match(texto, /^ {2}cancel-in-progress: false$/m)
    assert.match(texto, /^ {2}queue: max$/m)
  })
})
