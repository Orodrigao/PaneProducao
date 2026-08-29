import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, mock } from 'node:test'
import {
  LIMITE_PAGINA_RAMIFICACOES,
  PRODUCTION_PROJECT_REF,
  apontarPreviewParaRamificacao,
  escolherChavePublica,
  escolherRamificacao,
  limparVariaveisDaBranch,
  planejarVariaveis,
  ramificacaoEstaPronta,
} from './preview-branch-env.mjs'

const BRANCH = 'feat/programacao-producao-pj'

// Formato real devolvido pela API do Supabase, copiado de uma ramificacao viva.
const RAMIFICACAO_DA_PR = {
  id: '81193360-b665-4227-af3e-e4e99da4b907',
  name: BRANCH,
  project_ref: 'axpkaqpqrvpdfwoozrmy',
  is_default: false,
  git_branch: BRANCH,
  pr_number: 285,
  status: 'FUNCTIONS_DEPLOYED',
  preview_project_status: 'ACTIVE_HEALTHY',
}

const RAMIFICACAO_MAIN = {
  id: 'cb50ec07-5702-49f5-b610-f35e707a9ebb',
  name: 'main',
  project_ref: PRODUCTION_PROJECT_REF,
  is_default: true,
  git_branch: '',
  status: 'FUNCTIONS_DEPLOYED',
  preview_project_status: 'ACTIVE_HEALTHY',
}

const alvo = { prNumber: 285, gitBranch: BRANCH }

describe('escolherRamificacao', () => {
  it('acha a ramificacao pelo numero da PR', () => {
    const escolha = escolherRamificacao([RAMIFICACAO_MAIN, RAMIFICACAO_DA_PR], alvo)
    assert.equal(escolha.situacao, 'encontrada')
    assert.equal(escolha.ramificacao.project_ref, 'axpkaqpqrvpdfwoozrmy')
  })

  it('acha pelo nome da branch quando o numero da PR nao veio', () => {
    const semNumero = { ...RAMIFICACAO_DA_PR, pr_number: undefined }
    const escolha = escolherRamificacao([semNumero], { gitBranch: BRANCH })
    assert.equal(escolha.situacao, 'encontrada')
  })

  it('nunca escolhe a ramificacao padrao, que e a propria producao', () => {
    const escolha = escolherRamificacao([RAMIFICACAO_MAIN], { prNumber: 1, gitBranch: 'main' })
    assert.equal(escolha.situacao, 'sem-ramificacao')
  })

  // Caso 1 dos tres que a realidade nao oferece: lista vazia.
  it('lista vazia significa PR sem migration, nao erro', () => {
    const escolha = escolherRamificacao([], alvo)
    assert.equal(escolha.situacao, 'sem-ramificacao')
  })

  // Caso 2: campo ausente.
  it('recusa ramificacao sem project_ref em vez de montar uma URL quebrada', () => {
    const semRef = { ...RAMIFICACAO_DA_PR, project_ref: undefined }
    assert.throws(() => escolherRamificacao([semRef], alvo), /project_ref/i)
  })

  // Caso 3: lista truncada no limite da paginacao. Este e o perigoso: concluir
  // "sem ramificacao" aqui mandaria uma PR com migration testar no banco
  // compartilhado, que e justamente o que este script existe para impedir.
  it('falha fechado quando a listagem pode estar truncada', () => {
    const cheia = Array.from({ length: LIMITE_PAGINA_RAMIFICACOES }, (_, indice) => ({
      ...RAMIFICACAO_DA_PR,
      id: `outra-${indice}`,
      name: `outra-${indice}`,
      git_branch: `outra-${indice}`,
      pr_number: 9000 + indice,
    }))
    assert.throws(() => escolherRamificacao(cheia, alvo), /truncada/i)
  })

  it('recusa duas ramificacoes respondendo pela mesma PR', () => {
    const gemea = { ...RAMIFICACAO_DA_PR, id: 'gemea', name: 'gemea', project_ref: 'outroref' }
    assert.throws(() => escolherRamificacao([RAMIFICACAO_DA_PR, gemea], alvo), /Mais de uma/i)
  })

  it('recusa ramificacao que aponte para producao', () => {
    const disfarcada = { ...RAMIFICACAO_DA_PR, project_ref: PRODUCTION_PROJECT_REF }
    assert.throws(() => escolherRamificacao([disfarcada], alvo), /producao/i)
  })

  it('recusa resposta que nao seja lista e branch sem nome', () => {
    assert.throws(() => escolherRamificacao(null, alvo), /lista/i)
    assert.throws(() => escolherRamificacao([], { prNumber: 285 }), /branch ausente/i)
  })
})

describe('ramificacaoEstaPronta', () => {
  it('espera enquanto o banco ainda esta nascendo', () => {
    // Estado real observado: o projeto ja responde ACTIVE_HEALTHY enquanto a
    // ramificacao ainda esta em CREATING_PROJECT. Olhar so um dos dois campos
    // daria pronto cedo demais.
    assert.equal(ramificacaoEstaPronta({
      ...RAMIFICACAO_DA_PR,
      status: 'CREATING_PROJECT',
    }), false)

    assert.equal(ramificacaoEstaPronta({
      ...RAMIFICACAO_DA_PR,
      preview_project_status: 'COMING_UP',
    }), false)
  })

  it('aceita a ramificacao com migrations aplicadas e projeto saudavel', () => {
    assert.equal(ramificacaoEstaPronta(RAMIFICACAO_DA_PR), true)
  })

  it('nao espera as edge functions, porque so o banco importa aqui', () => {
    // Uma ramificacao sem function para publicar pode parar em
    // MIGRATIONS_PASSED e nunca chegar a FUNCTIONS_DEPLOYED. Exigir o estado
    // final travaria TODA PR. Como este script so escreve endereco e chave do
    // banco, schema aplicado ja basta.
    for (const status of ['MIGRATIONS_PASSED', 'FUNCTIONS_DEPLOYING']) {
      assert.equal(ramificacaoEstaPronta({ ...RAMIFICACAO_DA_PR, status }), true, status)
    }
  })

  it('interrompe quando a migration da PR quebrou no banco dela', () => {
    assert.throws(() => ramificacaoEstaPronta({
      ...RAMIFICACAO_DA_PR,
      status: 'MIGRATIONS_FAILED',
    }), /falhou no Supabase/i)
  })
})

describe('escolherChavePublica', () => {
  it('prefere a chave nova e aceita a legada como reserva', () => {
    assert.equal(escolherChavePublica([
      { name: 'anon', type: 'legacy', api_key: 'jwt-legado' },
      { name: 'default', type: 'publishable', api_key: 'sb_publishable_abc' },
    ]), 'sb_publishable_abc')

    assert.equal(escolherChavePublica([
      { name: 'anon', type: 'legacy', api_key: 'jwt-legado' },
    ]), 'jwt-legado')
  })

  it('falha quando nao ha chave publica utilizavel', () => {
    assert.throws(() => escolherChavePublica([]), /nenhuma chave publica/i)
    assert.throws(() => escolherChavePublica([{ name: 'service_role', type: 'secret' }]), /nenhuma chave publica/i)
    assert.throws(() => escolherChavePublica(undefined), /lista/i)
  })
})

describe('planejarVariaveis', () => {
  it('monta as duas variaveis amarradas a branch, e nunca como segredo', () => {
    const variaveis = planejarVariaveis({
      projectRef: 'axpkaqpqrvpdfwoozrmy',
      chavePublica: 'sb_publishable_abc',
      gitBranch: BRANCH,
    })

    assert.deepEqual(variaveis.map((v) => v.key), [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ])
    assert.equal(variaveis[0].value, 'https://axpkaqpqrvpdfwoozrmy.supabase.co')
    assert.equal(variaveis[1].value, 'sb_publishable_abc')
    for (const variavel of variaveis) {
      // A Vercel recusa marcar NEXT_PUBLIC_* como secreta, e com razao: essas
      // variaveis viajam dentro do site.
      assert.equal(variavel.type, 'plain')
      assert.deepEqual(variavel.target, ['preview'])
      assert.equal(variavel.gitBranch, BRANCH)
    }
  })

  it('recusa montar variavel com peca faltando', () => {
    assert.throws(() => planejarVariaveis({ chavePublica: 'k', gitBranch: BRANCH }), /project_ref/i)
    assert.throws(() => planejarVariaveis({ projectRef: 'r', gitBranch: BRANCH }), /Chave publica/i)
    assert.throws(() => planejarVariaveis({ projectRef: 'r', chavePublica: 'k' }), /branch ausente/i)
  })
})

function resposta(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status })
}

const CREDENCIAIS = {
  supabaseToken: 'token-supabase-de-teste',
  vercelToken: 'token-vercel-de-teste',
  vercelProject: 'pane-producao',
}

describe('apontarPreviewParaRamificacao', () => {
  it('nao encosta na Vercel quando a PR nao tem banco proprio', async () => {
    const fetchImpl = mock.fn(async () => resposta({ branches: [] }))

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'sem-ramificacao')
    assert.equal(fetchImpl.mock.callCount(), 1)
    assert.match(fetchImpl.mock.calls[0].arguments[0], /api\.supabase\.com/)
  })

  it('espera o banco ficar pronto, grava as duas variaveis e manda refazer o preview', async () => {
    const respostas = [
      // 1a consulta: ainda nascendo.
      resposta([{ ...RAMIFICACAO_DA_PR, status: 'CREATING_PROJECT' }]),
      // 2a consulta: pronto.
      resposta([RAMIFICACAO_DA_PR]),
      // chaves do banco da PR
      resposta({
        keys: [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }],
      }),
      resposta({}), // grava NEXT_PUBLIC_SUPABASE_URL
      resposta({}), // grava NEXT_PUBLIC_SUPABASE_ANON_KEY
      // Ja filtrado pelo servidor: o endpoint aceita `branch`.
      resposta({ deployments: [{ uid: 'dpl_desta_branch' }] }),
      resposta({ id: 'dpl_novo' }), // redeploy
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    let dormiu = 0

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      dormir: async () => { dormiu += 1 },
      intervaloSegundos: 0,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'apontado')
    assert.equal(resultado.projectRef, 'axpkaqpqrvpdfwoozrmy')
    assert.equal(dormiu, 1)

    const gravacoes = fetchImpl.mock.calls.filter(
      (chamada) => chamada.arguments[1]?.method === 'POST' && /\/env\?/.test(chamada.arguments[0]),
    )
    assert.equal(gravacoes.length, 2)
    const primeira = JSON.parse(gravacoes[0].arguments[1].body)
    assert.equal(primeira.key, 'NEXT_PUBLIC_SUPABASE_URL')
    assert.equal(primeira.value, 'https://axpkaqpqrvpdfwoozrmy.supabase.co')
    assert.equal(primeira.gitBranch, BRANCH)

    // O deploy velho ficou com as variaveis antigas: sem mandar refazer, o
    // preview continuaria falando com o banco errado mesmo estando verde.
    const redeploy = fetchImpl.mock.calls.at(-1)
    assert.match(redeploy.arguments[0], /v13\/deployments/)
    assert.equal(JSON.parse(redeploy.arguments[1].body).deploymentId, 'dpl_desta_branch')

    // O filtro por branch precisa acontecer no SERVIDOR. Filtrar no cliente uma
    // pagina dos deploys mais recentes do projeto inteiro confundiria "nao esta
    // nesta pagina" com "nao existe".
    const busca = fetchImpl.mock.calls.at(-2).arguments[0]
    assert.match(busca, /v7\/deployments/)
    assert.ok(busca.includes('branch=' + encodeURIComponent(BRANCH)), busca)
  })

  it('espera o preview aparecer na Vercel antes de desistir', async () => {
    // A Vercel comeca o deploy no mesmo push que dispara este workflow, entao o
    // deploy pode existir e ainda nao aparecer na API. Concluir "nao existe" na
    // primeira tentativa deixaria vivo justamente o deploy com a configuracao
    // velha, verde e apontando para o banco compartilhado.
    const respostas = [
      resposta([RAMIFICACAO_DA_PR]),
      resposta({ keys: [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }] }),
      resposta({}),
      resposta({}),
      resposta({ deployments: [] }),
      resposta({ deployments: [{ uid: 'dpl_que_demorou' }] }),
      resposta({ id: 'dpl_novo' }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      dormir: async () => {},
      registrar: () => {},
    })

    assert.equal(resultado.redeploy.situacao, 'refeito')
    assert.equal(resultado.redeploy.deploymentId, 'dpl_que_demorou')
    assert.equal(respostas.length, 0)
  })

  it('falha fechado quando nenhum preview da branch aparece a tempo', async () => {
    const respostas = [
      resposta([RAMIFICACAO_DA_PR]),
      resposta({ keys: [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }] }),
      resposta({}),
      resposta({}),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift() ?? resposta({ deployments: [] }))

    await assert.rejects(apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      esperarPreviewSegundos: 0,
      dormir: async () => {},
      registrar: () => {},
    }), /Nenhum preview da branch/i)
  })

  it('desiste com mensagem clara se o banco nao ficar pronto a tempo', async () => {
    const fetchImpl = mock.fn(async () => resposta([{ ...RAMIFICACAO_DA_PR, status: 'CREATING_PROJECT' }]))

    await assert.rejects(apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      esperarSegundos: 0,
      registrar: () => {},
    }), /nao ficou pronto/i)
  })

  it('repassa o erro da API em vez de seguir no escuro', async () => {
    const fetchImpl = mock.fn(async () => new Response('sem permissao', { status: 403 }))

    await assert.rejects(apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    }), /403/)
  })

  it('exige as credenciais antes de qualquer chamada', async () => {
    await assert.rejects(apontarPreviewParaRamificacao({
      ...alvo,
      vercelToken: 'v',
      vercelProject: 'p',
    }), /SUPABASE_ACCESS_TOKEN/)

    await assert.rejects(apontarPreviewParaRamificacao({
      ...alvo,
      supabaseToken: 's',
      vercelProject: 'p',
    }), /VERCEL_TOKEN/)
  })
})

describe('limparVariaveisDaBranch', () => {
  it('apaga so as duas variaveis daquela branch', async () => {
    const respostas = [
      resposta({
        envs: [
          { id: 'env_url', key: 'NEXT_PUBLIC_SUPABASE_URL', gitBranch: BRANCH },
          { id: 'env_key', key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', gitBranch: BRANCH },
          { id: 'env_telegram', key: 'NEXT_PUBLIC_TELEGRAM_BOT_TOKEN', gitBranch: BRANCH },
          { id: 'env_outra_branch', key: 'NEXT_PUBLIC_SUPABASE_URL', gitBranch: 'outra' },
          // A listagem filtrada por branch devolve TAMBEM as genericas de
          // Preview, que sao as que o Rodrigo recriou a mao. Apagar uma delas
          // deixaria todo preview sem banco. E a comparacao de gitBranch no
          // codigo que impede isso, e e este fixture que prende a regra.
          { id: 'env_generica_url', key: 'NEXT_PUBLIC_SUPABASE_URL', gitBranch: null },
          { id: 'env_generica_chave', key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' },
        ],
      }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const intocaveis = ['env_generica_url', 'env_generica_chave', 'env_outra_branch', 'env_telegram']

    const resultado = await limparVariaveisDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.removidas, 2)
    const apagadas = fetchImpl.mock.calls
      .filter((chamada) => chamada.arguments[1]?.method === 'DELETE')
      .map((chamada) => chamada.arguments[0].split('/env/')[1])
    assert.deepEqual(apagadas, ['env_url', 'env_key'])
    for (const intocavel of intocaveis) {
      assert.ok(!apagadas.includes(intocavel), 'apagou ' + intocavel + ', que nao e desta branch')
    }
  })

  it('exige as credenciais antes de apagar qualquer coisa', async () => {
    await assert.rejects(limparVariaveisDaBranch({
      gitBranch: BRANCH,
      vercelProject: 'pane-producao',
    }), /VERCEL_TOKEN/)

    await assert.rejects(limparVariaveisDaBranch({
      gitBranch: BRANCH,
      vercelToken: 'v',
    }), /Projeto da Vercel/)
  })

  it('nao apaga nada quando a PR nunca teve banco proprio', async () => {
    const fetchImpl = mock.fn(async () => resposta({ envs: [] }))

    const resultado = await limparVariaveisDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.removidas, 0)
    assert.equal(fetchImpl.mock.callCount(), 1)
  })
})

// Um passo de workflow que DECIDE alguma coisa so era exercitado abrindo PR e
// esperando o semaforo. As duas condicoes abaixo sao transcricao ao pe da letra
// do que esta em .github/workflows/banco-por-pr.yml; so a fonte dos dados muda.
// O teste final confere que a transcricao nao envelheceu em silencio.
const CONDICAO_APONTAR = "github.event.action != 'closed' && github.event.pull_request.head.repo.full_name == github.repository"
const CONDICAO_LIMPAR = "github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository"

const apontarRoda = (evento, repositorio) =>
  evento.action !== 'closed'
  && evento.pull_request?.head?.repo?.full_name === repositorio

const limparRoda = (evento, repositorio) =>
  evento.action === 'closed'
  && evento.pull_request?.head?.repo?.full_name === repositorio

const REPO = 'Orodrigao/PaneProducao'
const daCasa = (action) => ({
  action,
  pull_request: { head: { repo: { full_name: REPO } } },
})

describe('condicoes do workflow Banco por PR', () => {
  it('aponta ao abrir, reabrir e a cada envio, e nunca ao fechar', () => {
    for (const action of ['opened', 'reopened', 'synchronize']) {
      assert.equal(apontarRoda(daCasa(action), REPO), true, action)
      assert.equal(limparRoda(daCasa(action), REPO), false, action)
    }

    assert.equal(apontarRoda(daCasa('closed'), REPO), false)
    assert.equal(limparRoda(daCasa('closed'), REPO), true)
  })

  it('nao roda em PR de fork, que nao recebe segredo e falharia sem explicacao', () => {
    const deFora = {
      action: 'opened',
      pull_request: { head: { repo: { full_name: 'estranho/PaneProducao' } } },
    }
    assert.equal(apontarRoda(deFora, REPO), false)
    assert.equal(limparRoda({ ...deFora, action: 'closed' }, REPO), false)
  })

  it('campo ausente no evento nao liga nenhum dos dois trabalhos', () => {
    // Payload capado: se o caminho ate full_name sumir, a comparacao vira
    // undefined e os dois lados ficam desligados. Falha fechado.
    assert.equal(apontarRoda({ action: 'opened' }, REPO), false)
    assert.equal(limparRoda({ action: 'closed', pull_request: {} }, REPO), false)
  })

  it('a transcricao acima continua igual ao workflow de verdade', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/banco-por-pr.yml', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ')

    assert.ok(
      workflow.includes(CONDICAO_APONTAR),
      'A condicao do trabalho "apontar" mudou no workflow e este teste ficou para tras.',
    )
    assert.ok(
      workflow.includes(CONDICAO_LIMPAR),
      'A condicao do trabalho "limpar" mudou no workflow e este teste ficou para tras.',
    )
  })
})
