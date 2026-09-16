import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DESTINO_INERTE,
  LIMITE_PAGINA_RAMIFICACOES,
  PRODUCTION_PROJECT_REF,
  apontarPreviewParaRamificacao,
  bloquearPreviewDaBranch,
  conferirReleitura,
  decidirPeloEstado,
  escolherChavePublica,
  escolherRamificacao,
  executarAcao,
  lerEstadoDaBranch,
  limparVariaveisDaBranch,
  planejarBloqueio,
  planejarVariaveis,
  ramificacaoEstaPronta,
} from './preview-branch-env.mjs'
import { enderecoDeBancoForaDoPadrao } from './ignore-documentation-build.mjs'

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

function jwtComPapel(role) {
  const cabecalho = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${cabecalho}.${payload}.assinatura`
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

// Ramificacoes de outras PRs, para o cenario de cota cheia.
const RAMIFICACAO_DE_OUTRA = {
  ...RAMIFICACAO_DA_PR,
  id: 'outra-1', name: 'fix/outra', project_ref: 'aaaaaaaaaaaaaaaaaaaa',
  git_branch: 'fix/outra', pr_number: 900,
}
const RAMIFICACAO_DA_PR_ALHEIA = {
  ...RAMIFICACAO_DA_PR,
  id: 'outra-2', name: 'fix/mais-outra', project_ref: 'bbbbbbbbbbbbbbbbbbbb',
  git_branch: 'fix/mais-outra', pr_number: 901,
}

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
    const anonLegada = jwtComPapel('anon')
    assert.equal(escolherChavePublica([
      { name: 'anon', type: 'legacy', api_key: anonLegada },
      { name: 'default', type: 'publishable', api_key: 'sb_publishable_abc' },
    ]), 'sb_publishable_abc')

    assert.equal(escolherChavePublica([
      { name: 'anon', type: 'legacy', api_key: anonLegada },
    ]), anonLegada)
  })

  it('falha fechado para formato desconhecido, chave secreta ou papel privilegiado', () => {
    assert.throws(() => escolherChavePublica([]), /nenhuma chave publica/i)
    assert.throws(
      () => escolherChavePublica([{ name: 'service_role', type: 'secret', api_key: jwtComPapel('service_role') }]),
      /nenhuma chave publica/i,
    )
    assert.throws(
      () => escolherChavePublica([{
        name: 'default',
        type: 'publishable',
        api_key: jwtComPapel('service_role'),
      }]),
      /nenhuma chave publica/i,
    )
    assert.throws(
      () => escolherChavePublica([{ name: 'anon', type: 'legacy', api_key: jwtComPapel('service_role') }]),
      /nenhuma chave publica/i,
    )
    assert.throws(() => escolherChavePublica(undefined), /lista/i)
    assert.throws(() => escolherChavePublica(null), /lista/i)
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

// Variavel de branch no formato da listagem v9 da Vercel.
function envDaBranch(key, value, extra = {}) {
  return { id: `env_${key}`, key, value, type: 'plain', target: ['preview'], gitBranch: BRANCH, ...extra }
}

// A listagem filtrada por branch devolve TAMBEM as genericas de Preview. Elas
// entram em toda releitura fabricada para provar que nao contam.
const GENERICA_URL = {
  id: 'env_generica_url',
  key: 'NEXT_PUBLIC_SUPABASE_URL',
  value: 'https://tuqzhjsbodoycjbmwuqm.supabase.co',
  type: 'plain',
  target: ['preview'],
}

const releituraDaPr = () => resposta({
  envs: [
    envDaBranch('NEXT_PUBLIC_SUPABASE_URL', 'https://axpkaqpqrvpdfwoozrmy.supabase.co'),
    envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_da_pr'),
    GENERICA_URL,
  ],
})

const releituraTravada = () => resposta({
  envs: [
    envDaBranch('NEXT_PUBLIC_SUPABASE_URL', DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_URL),
    envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    GENERICA_URL,
  ],
})

const ehListagemVercel = (url) => /api\.vercel\.com\/v9\/projects\/.+\/env\?gitBranch=/.test(url)

describe('apontarPreviewParaRamificacao', () => {
  it('sem banco proprio, so confere que a branch nao ficou travada', async () => {
    const respostas = [
      resposta({ branches: [] }),
      resposta({ envs: [GENERICA_URL] }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'sem-ramificacao')
    assert.equal(fetchImpl.mock.callCount(), 2)
    assert.match(fetchImpl.mock.calls[0].arguments[0], /api\.supabase\.com/)
    assert.ok(ehListagemVercel(fetchImpl.mock.calls[1].arguments[0]))
    // A generica e o banco compartilhado de todo mundo: nunca e apagada.
    assert.equal(fetchImpl.mock.calls.some((c) => c.arguments[1]?.method !== 'GET'), false)
  })

  it('PR reaberta sem banco proprio: tira a trava e confere que sumiu', async () => {
    const respostas = [
      resposta([RAMIFICACAO_MAIN]),
      releituraTravada(),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      resposta({ envs: [GENERICA_URL] }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'sem-ramificacao')
    assert.equal(respostas.length, 0)
    const apagadas = fetchImpl.mock.calls
      .filter((c) => c.arguments[1]?.method === 'DELETE')
      .map((c) => c.arguments[0].split('/env/')[1])
    assert.deepEqual(apagadas, ['env_NEXT_PUBLIC_SUPABASE_URL', 'env_NEXT_PUBLIC_SUPABASE_ANON_KEY'])
    // Sem banco proprio nao ha o que gravar nem preview a refazer.
    assert.equal(fetchImpl.mock.calls.some((c) => c.arguments[1]?.method === 'POST'), false)
  })

  it('nao manda refazer o preview quando a releitura nao bate com o que foi gravado', async () => {
    const respostas = [
      resposta([RAMIFICACAO_DA_PR]),
      resposta([{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }]),
      resposta({}),
      resposta({}),
      resposta({
        envs: [
          // Outra PR gravou por cima: o endereco nao e o desta.
          envDaBranch('NEXT_PUBLIC_SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co'),
          envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_da_pr'),
        ],
      }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    const erro = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    }).then(() => null, (e) => e)

    assert.match(erro?.message ?? '', /NEXT_PUBLIC_SUPABASE_URL.*nao tem o valor/)
    // Nem o valor esperado nem o encontrado vao para o log.
    assert.ok(!erro.message.includes('supabase.co'), erro.message)
    assert.ok(!erro.message.includes('sb_publishable'), erro.message)
    assert.equal(fetchImpl.mock.calls.some((c) => /deployments/.test(c.arguments[0])), false)
  })

  it('espera o banco ficar pronto, grava as duas variaveis e manda refazer o preview', async () => {
    const respostas = [
      // 1a consulta: ainda nascendo.
      resposta([{ ...RAMIFICACAO_DA_PR, status: 'CREATING_PROJECT' }]),
      // 2a consulta: pronto.
      resposta([RAMIFICACAO_DA_PR]),
      // chaves do banco da PR
      // A Management API devolve a lista crua. Antes, `chaves?.keys` pegava o
      // metodo Array.prototype.keys e passava uma funcao no lugar desta lista.
      resposta([{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }]),
      resposta({}), // grava NEXT_PUBLIC_SUPABASE_URL
      resposta({}), // grava NEXT_PUBLIC_SUPABASE_ANON_KEY
      releituraDaPr(), // confere o que ficou gravado
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
    const corpoDoRedeploy = JSON.parse(redeploy.arguments[1].body)
    assert.equal(corpoDoRedeploy.deploymentId, 'dpl_desta_branch')
    assert.equal(Object.hasOwn(corpoDoRedeploy, 'target'), false)

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
      releituraDaPr(),
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

  it('nunca refaz um deployment de producao mesmo que a busca da branch o devolva', async () => {
    const respostas = [
      resposta([RAMIFICACAO_DA_PR]),
      resposta([{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }]),
      resposta({}),
      resposta({}),
      releituraDaPr(),
      resposta({ deployments: [{ uid: 'dpl_producao', target: 'production' }] }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    await assert.rejects(() => apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      fetchImpl,
      registrar: () => {},
    }), /deployment.*producao.*recusado/i)

    assert.equal(
      fetchImpl.mock.calls.some((chamada) => /v13\/deployments/.test(chamada.arguments[0])),
      false,
    )
  })

  it('falha fechado quando nenhum preview da branch aparece a tempo', async () => {
    const respostas = [
      resposta([RAMIFICACAO_DA_PR]),
      resposta({ keys: [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }] }),
      resposta({}),
      resposta({}),
      releituraDaPr(),
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
          { id: 'env_alheia', key: 'NEXT_PUBLIC_OUTRA_COISA', gitBranch: BRANCH },
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
      // Releitura: sobraram so as que nao sao desta branch.
      resposta({ envs: [{ id: 'env_generica_url', key: 'NEXT_PUBLIC_SUPABASE_URL', gitBranch: null }] }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const intocaveis = ['env_generica_url', 'env_generica_chave', 'env_outra_branch', 'env_alheia']

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

  it('falha quando a variavel continua la depois de apagada', async () => {
    const respostas = [
      releituraTravada(),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      releituraTravada(),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    await assert.rejects(limparVariaveisDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl,
      registrar: () => {},
    }), /continua gravada/)
  })

  it('falha fechado com listagem sem campo envs ou com pagina seguinte', async () => {
    for (const corpo of [{}, { envs: null }, { envs: [], pagination: { next: 1726500000000 } }]) {
      const fetchImpl = mock.fn(async () => resposta(corpo))
      await assert.rejects(limparVariaveisDaBranch({
        ...CREDENCIAIS,
        gitBranch: BRANCH,
        fetchImpl,
        registrar: () => {},
      }), /listagem de variaveis/, JSON.stringify(corpo))
      assert.equal(fetchImpl.mock.calls.some((c) => c.arguments[1]?.method === 'DELETE'), false)
    }
  })

  it('exige o nome da branch, senao tocaria nas genericas', async () => {
    const fetchImpl = mock.fn()
    await assert.rejects(limparVariaveisDaBranch({ ...CREDENCIAIS, gitBranch: '', fetchImpl }), /branch ausente/)
    assert.equal(fetchImpl.mock.callCount(), 0)
  })
})

describe('bloquearPreviewDaBranch', () => {
  it('grava o destino inerte so para Preview daquela branch e rele', async () => {
    const respostas = [resposta({}), resposta({}), releituraTravada()]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const log = []

    const resultado = await bloquearPreviewDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl,
      registrar: (linha) => log.push(linha),
    })

    assert.equal(resultado.situacao, 'bloqueado')
    assert.equal(respostas.length, 0)
    const gravadas = fetchImpl.mock.calls
      .filter((c) => c.arguments[1]?.method === 'POST')
      .map((c) => JSON.parse(c.arguments[1].body))
    assert.deepEqual(gravadas, planejarBloqueio({ gitBranch: BRANCH }))
    for (const variavel of gravadas) {
      assert.deepEqual(variavel.target, ['preview'])
      assert.equal(variavel.gitBranch, BRANCH)
    }
    // Travar nao apaga nada e nao mexe em deploy.
    assert.equal(fetchImpl.mock.calls.some((c) => c.arguments[1]?.method === 'DELETE'), false)
    assert.equal(fetchImpl.mock.calls.some((c) => /deployments/.test(c.arguments[0])), false)
    assert.ok(log.some((linha) => /tem o valor gravado/.test(linha)), log.join('\n'))
  })

  it('aceita releitura sem valor em claro, e diz que so conferiu a existencia', async () => {
    const semValor = (key) => envDaBranch(key, undefined, { type: 'encrypted', decrypted: false })
    const respostas = [
      resposta({}),
      resposta({}),
      resposta({ envs: [semValor('NEXT_PUBLIC_SUPABASE_URL'), semValor('NEXT_PUBLIC_SUPABASE_ANON_KEY')] }),
    ]
    const log = []

    await bloquearPreviewDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl: mock.fn(async () => respostas.shift()),
      registrar: (linha) => log.push(linha),
    })

    assert.ok(log.some((linha) => /0 conferida\(s\) por valor/.test(linha)), log.join('\n'))
  })

  it('falha quando a trava nao aparece na releitura', async () => {
    // Lista vazia: a gravacao respondeu 200 mas nada ficou.
    const respostas = [resposta({}), resposta({}), resposta({ envs: [GENERICA_URL] })]

    await assert.rejects(bloquearPreviewDaBranch({
      ...CREDENCIAIS,
      gitBranch: BRANCH,
      fetchImpl: mock.fn(async () => respostas.shift()),
      registrar: () => {},
    }), /esperava uma NEXT_PUBLIC_SUPABASE_URL.*devolveu 0/)
  })

  it('exige credenciais e branch antes de qualquer chamada', async () => {
    const fetchImpl = mock.fn()
    await assert.rejects(bloquearPreviewDaBranch({ gitBranch: BRANCH, vercelProject: 'p', fetchImpl }), /VERCEL_TOKEN/)
    await assert.rejects(bloquearPreviewDaBranch({ gitBranch: BRANCH, vercelToken: 'v', fetchImpl }), /Projeto da Vercel/)
    await assert.rejects(bloquearPreviewDaBranch({ vercelToken: 'v', vercelProject: 'p', fetchImpl }), /branch ausente/)
    assert.equal(fetchImpl.mock.callCount(), 0)
  })

  it('o destino inerte nao e banco nenhum e a trava do build o recusa', () => {
    const endereco = new URL(DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_URL)
    // `.invalid` e reservado (RFC 2606) e nunca resolve.
    assert.ok(endereco.hostname.endsWith('.invalid'), endereco.hostname)
    assert.ok(!endereco.hostname.endsWith('.supabase.co'))
    assert.doesNotMatch(DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_ANON_KEY, /^sb_publishable_|^[\w-]+\.[\w-]+\.[\w-]+$/)

    // A trava de next.config.ts so aceita `*.supabase.co`; se ela deixar de
    // exigir isso, o destino inerte precisa ser revisto.
    const trava = readFileSync(new URL('../src/lib/environmentSafety.ts', import.meta.url), 'utf8')
    assert.ok(trava.includes("const suffix = '.supabase.co'"), 'A trava do build mudou o sufixo aceito.')
    assert.ok(trava.includes('NEXT_PUBLIC_SUPABASE_URL invalida'), 'A trava do build parou de recusar endereco desconhecido.')

    // O ignoreCommand da Vercel precisa construir a branch travada, senao a
    // trava nunca roda num envio so de documentacao.
    assert.equal(enderecoDeBancoForaDoPadrao(DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_URL), true)
    const copia = readFileSync(new URL('./change-scope.test.mjs', import.meta.url), 'utf8')
    assert.ok(
      copia.includes(`NEXT_PUBLIC_SUPABASE_URL: '${DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_URL}'`),
      'A copia do destino inerte em change-scope.test.mjs ficou para tras.',
    )
  })
})

describe('conferirReleitura', () => {
  const esperadas = planejarVariaveis({ projectRef: 'axpkaqpqrvpdfwoozrmy', chavePublica: 'sb_publishable_da_pr', gitBranch: BRANCH })

  it('conta por valor o que a Vercel devolve em claro', () => {
    const listadas = [
      envDaBranch('NEXT_PUBLIC_SUPABASE_URL', 'https://axpkaqpqrvpdfwoozrmy.supabase.co'),
      envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_da_pr'),
    ]
    assert.deepEqual(conferirReleitura(listadas, esperadas), { porValor: 2 })
  })

  it('recusa duplicada, ausente, fora de Preview e lista que nao e lista', () => {
    const url = envDaBranch('NEXT_PUBLIC_SUPABASE_URL', 'https://axpkaqpqrvpdfwoozrmy.supabase.co')
    const chave = envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_da_pr')

    assert.throws(() => conferirReleitura([url, url, chave], esperadas), /devolveu 2/)
    assert.throws(() => conferirReleitura([url], esperadas), /ANON_KEY.*devolveu 0/)
    assert.throws(() => conferirReleitura([], esperadas), /devolveu 0/)
    assert.throws(
      () => conferirReleitura([{ ...url, target: ['preview', 'production'] }, chave], esperadas),
      /restrita a Preview/,
    )
    assert.throws(() => conferirReleitura([{ ...url, target: undefined }, chave], esperadas), /restrita a Preview/)
    assert.throws(() => conferirReleitura(undefined, esperadas), /nao veio como lista/)
  })

  it('depois de remover, qualquer sobra reprova', () => {
    assert.deepEqual(conferirReleitura([], []), { porValor: 0 })
    assert.throws(
      () => conferirReleitura([envDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'x')], []),
      /continua gravada/,
    )
  })
})

const GITHUB = { repositorio: 'Orodrigao/PaneProducao', githubToken: 'token-github-de-teste' }

function prAberta(numero, ref = BRANCH, repo = GITHUB.repositorio) {
  return { number: numero, head: { ref, repo: { full_name: repo } } }
}

describe('lerEstadoDaBranch', () => {
  it('le a branch pela referencia exata e as PRs abertas da casa', async () => {
    const respostas = [
      resposta({ ref: `refs/heads/${BRANCH}` }),
      resposta([
        prAberta(285),
        // Mesmo nome de branch vindo de fork nao conta.
        prAberta(900, BRANCH, 'estranho/PaneProducao'),
        // Filtro do servidor e casamento, nao igualdade: confere de novo.
        prAberta(901, `${BRANCH}-outra`),
      ]),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())

    const estado = await lerEstadoDaBranch({ ...GITHUB, gitBranch: BRANCH, fetchImpl })

    assert.deepEqual(estado, { branchExiste: true, prsAbertas: [285] })
    assert.equal(
      fetchImpl.mock.calls[0].arguments[0],
      'https://api.github.com/repos/Orodrigao/PaneProducao/git/ref/heads/feat/programacao-producao-pj',
    )
    const busca = new URL(fetchImpl.mock.calls[1].arguments[0])
    assert.equal(busca.searchParams.get('state'), 'open')
    assert.equal(busca.searchParams.get('head'), `Orodrigao:${BRANCH}`)
    assert.equal(busca.searchParams.get('per_page'), '100')
  })

  it('so 404 quer dizer branch apagada', async () => {
    const respostas = [new Response('{}', { status: 404 }), resposta([])]
    const estado = await lerEstadoDaBranch({
      ...GITHUB,
      gitBranch: BRANCH,
      fetchImpl: mock.fn(async () => respostas.shift()),
    })
    assert.deepEqual(estado, { branchExiste: false, prsAbertas: [] })

    for (const status of [401, 403, 500]) {
      // So a leitura da branch falha; a de PRs responde, para o erro nao vir
      // de carona da segunda chamada.
      const fetchImpl = mock.fn(async (url) => (
        url.includes('/git/ref/') ? new Response('{}', { status }) : resposta([])
      ))
      await assert.rejects(
        lerEstadoDaBranch({ ...GITHUB, gitBranch: BRANCH, fetchImpl }),
        new RegExp(`GET da branch no GitHub respondeu ${status}`),
      )
    }
  })

  it('falha fechado com referencia que nao e exatamente a branch', async () => {
    // Formato antigo de casamento parcial: lista em vez de objeto.
    for (const corpo of [[{ ref: `refs/heads/${BRANCH}` }], { ref: `refs/heads/${BRANCH}-2` }, {}]) {
      await assert.rejects(lerEstadoDaBranch({
        ...GITHUB,
        gitBranch: BRANCH,
        fetchImpl: mock.fn(async () => resposta(corpo)),
      }), /nao e exatamente esta branch/, JSON.stringify(corpo))
    }
  })

  it('falha fechado com lista de PRs ausente ou truncada', async () => {
    const cheia = Array.from({ length: 100 }, (_, i) => prAberta(1000 + i, `outra-${i}`))
    for (const [corpo, erro] of [[{}, /nao veio como lista/], [cheia, /limite da pagina/]]) {
      const respostas = [resposta({ ref: `refs/heads/${BRANCH}` }), resposta(corpo)]
      await assert.rejects(lerEstadoDaBranch({
        ...GITHUB,
        gitBranch: BRANCH,
        fetchImpl: mock.fn(async () => respostas.shift()),
      }), erro)
    }
  })

  it('exige token, repositorio e branch antes de qualquer chamada', async () => {
    const fetchImpl = mock.fn()
    await assert.rejects(lerEstadoDaBranch({ ...GITHUB, githubToken: '', gitBranch: BRANCH, fetchImpl }), /GITHUB_TOKEN/)
    for (const repositorio of [undefined, '', 'sem-barra', 'a/b/c', 'a/b?x=1']) {
      await assert.rejects(lerEstadoDaBranch({ ...GITHUB, repositorio, gitBranch: BRANCH, fetchImpl }), /GITHUB_REPOSITORY/)
    }
    await assert.rejects(lerEstadoDaBranch({ ...GITHUB, gitBranch: '', fetchImpl }), /branch ausente/)
    assert.equal(fetchImpl.mock.callCount(), 0)
  })
})

describe('decidirPeloEstado', () => {
  const viva = (prsAbertas) => ({ branchExiste: true, prsAbertas })

  it('branch apagada esquece e branch sem PR aberta trava, venha o pedido de onde vier', () => {
    for (const acao of ['apontar', 'destravar', 'bloquear', 'esquecer']) {
      assert.equal(decidirPeloEstado({ acao, prNumber: '285', branchExiste: false, prsAbertas: [] }), 'esquecer', acao)
      assert.equal(decidirPeloEstado({ acao, prNumber: '285', ...viva([]) }), 'bloquear', acao)
    }
  })

  it('com PR aberta, travar e esquecer nao mexem; apontar e destravar seguem so para a PR aberta', () => {
    assert.equal(decidirPeloEstado({ acao: 'bloquear', ...viva([285]) }), 'nada')
    assert.equal(decidirPeloEstado({ acao: 'esquecer', ...viva([285]) }), 'nada')
    assert.equal(decidirPeloEstado({ acao: 'apontar', prNumber: '285', ...viva([285]) }), 'apontar')
    assert.equal(decidirPeloEstado({ acao: 'destravar', prNumber: 285, ...viva([285]) }), 'destravar')
    // Evento de uma PR ja fechada, com outra PR aberta na mesma branch.
    assert.equal(decidirPeloEstado({ acao: 'apontar', prNumber: '284', ...viva([285]) }), 'nada')
  })

  it('falha fechado com estado incompleto, numero invalido ou acao desconhecida', () => {
    assert.throws(() => decidirPeloEstado({ acao: 'apontar', prNumber: '285', branchExiste: undefined, prsAbertas: [285] }), /existencia/)
    assert.throws(() => decidirPeloEstado({ acao: 'apontar', prNumber: '285', branchExiste: true }), /lista de PRs/)
    for (const prNumber of [undefined, '', '0', 'abc', '2.5']) {
      assert.throws(() => decidirPeloEstado({ acao: 'apontar', prNumber, ...viva([285]) }), /PR_NUMBER/, String(prNumber))
    }
    assert.throws(() => decidirPeloEstado({ acao: 'limpar', ...viva([]) }), /ACAO desconhecida/)
  })
})

// Mundo falso: GitHub e Vercel respondendo a partir de um estado em memoria.
// Serve para provar que a ULTIMA execucao deixa o certo, seja qual for o
// evento que a disparou e o que as anteriores deixaram gravado.
function mundoFalso({ branchExiste, prsAbertas, ramificacao = null, variaveis = [] }) {
  const loja = variaveis.map((v, i) => ({ id: `env_${i}`, ...v }))
  let proximo = loja.length
  const fetchImpl = async (url, { method = 'GET', body } = {}) => {
    const u = new URL(url)
    if (u.hostname === 'api.github.com') {
      if (u.pathname.includes('/git/ref/heads/')) {
        return branchExiste ? resposta({ ref: `refs/heads/${BRANCH}` }) : new Response('{}', { status: 404 })
      }
      if (u.pathname.endsWith('/pulls')) return resposta(prsAbertas.map((n) => prAberta(n)))
    }
    if (u.hostname === 'api.supabase.com') {
      if (u.pathname.endsWith('/branches')) return resposta(ramificacao ? [RAMIFICACAO_MAIN, ramificacao] : [RAMIFICACAO_MAIN])
      if (u.pathname.endsWith('/api-keys')) {
        return resposta([{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }])
      }
    }
    if (u.hostname === 'api.vercel.com') {
      if (method === 'GET' && u.pathname.endsWith('/env')) {
        return resposta({ envs: [GENERICA_URL, ...loja], pagination: { count: loja.length + 1, next: null, prev: null } })
      }
      if (method === 'POST' && u.pathname.endsWith('/env')) {
        const nova = JSON.parse(body)
        const existente = loja.find((v) => v.key === nova.key && v.gitBranch === nova.gitBranch)
        if (existente) Object.assign(existente, nova)
        else loja.push({ id: `env_${proximo++}`, ...nova })
        return resposta({})
      }
      if (method === 'DELETE') {
        const id = decodeURIComponent(u.pathname.split('/env/')[1])
        loja.splice(loja.findIndex((v) => v.id === id), 1)
        return new Response(null, { status: 204 })
      }
      if (u.pathname.endsWith('/deployments') && method === 'GET') return resposta({ deployments: [{ uid: 'dpl_da_branch' }] })
      if (u.pathname.endsWith('/deployments') && method === 'POST') return resposta({ id: 'dpl_novo' })
    }
    throw new Error(`chamada inesperada: ${method} ${url}`)
  }
  const valores = () => Object.fromEntries(loja.map((v) => [v.key, v.value]))
  return { fetchImpl, valores }
}

const TRAVADA = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', value: DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_URL, type: 'plain', target: ['preview'], gitBranch: BRANCH },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: DESTINO_INERTE.NEXT_PUBLIC_SUPABASE_ANON_KEY, type: 'plain', target: ['preview'], gitBranch: BRANCH },
]
const DA_PR = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://axpkaqpqrvpdfwoozrmy.supabase.co', type: 'plain', target: ['preview'], gitBranch: BRANCH },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'sb_publishable_da_pr', type: 'plain', target: ['preview'], gitBranch: BRANCH },
]
const SO_URL_TRAVADA = [TRAVADA[0]] // execucao cancelada entre as duas gravacoes
const ANTERIORES = { vazio: [], travada: TRAVADA, 'da PR': DA_PR, 'meio travada': SO_URL_TRAVADA }
const valoresDe = (lista) => Object.fromEntries(lista.map((v) => [v.key, v.value]))

describe('executarAcao: a ultima execucao deixa o certo em qualquer ordem', () => {
  const rodar = (mundo, acao) => executarAcao({
    ...CREDENCIAIS,
    ...GITHUB,
    acao,
    prNumber: '285',
    gitBranch: BRANCH,
    esperarRamificacaoSegundos: 0,
    dormir: async () => {},
    fetchImpl: mundo.fetchImpl,
    registrar: () => {},
  })

  const cenarios = [
    ['PR fechada, branch viva: travada', { branchExiste: true, prsAbertas: [] }, valoresDe(TRAVADA)],
    ['branch apagada: sem variavel da branch', { branchExiste: false, prsAbertas: [] }, {}],
  ]
  for (const [nome, mundoFinal, esperado] of cenarios) {
    for (const acao of ['apontar', 'destravar', 'bloquear', 'esquecer']) {
      for (const [antes, variaveis] of Object.entries(ANTERIORES)) {
        it(`${nome} | ultima: ${acao} | antes: ${antes}`, async () => {
          const mundo = mundoFalso({ ...mundoFinal, variaveis })
          await rodar(mundo, acao)
          assert.deepEqual(mundo.valores(), esperado)
        })
      }
    }
  }

  for (const [antes, variaveis] of Object.entries(ANTERIORES)) {
    it(`PR aberta sem banco proprio | ultima: apontar ou destravar | antes: ${antes}`, async () => {
      for (const acao of ['apontar', 'destravar']) {
        const mundo = mundoFalso({ branchExiste: true, prsAbertas: [285], variaveis })
        await rodar(mundo, acao)
        assert.deepEqual(mundo.valores(), {}, acao)
      }
    })

    it(`PR aberta com banco proprio | ultima: apontar | antes: ${antes}`, async () => {
      const mundo = mundoFalso({ branchExiste: true, prsAbertas: [285], ramificacao: RAMIFICACAO_DA_PR, variaveis })
      const resultado = await rodar(mundo, 'apontar')
      assert.equal(resultado.situacao, 'apontado')
      assert.deepEqual(mundo.valores(), valoresDe(DA_PR))
    })

    // O limite declarado: com PR aberta, um fechar ou apagar atrasado nao
    // mexe, porque so a execucao da PR conhece a classificacao dela. Se ele
    // for o ultimo, fica o que estava; travada continua falhando fechado ate
    // o proximo envio da PR.
    it(`PR aberta | ultima: bloquear ou esquecer atrasado | antes: ${antes} | nao mexe`, async () => {
      for (const acao of ['bloquear', 'esquecer']) {
        const mundo = mundoFalso({ branchExiste: true, prsAbertas: [285], variaveis })
        const resultado = await rodar(mundo, acao)
        assert.equal(resultado.decisao, 'nada', acao)
        assert.deepEqual(mundo.valores(), valoresDe(variaveis), acao)
      }
    })
  }

  it('fechar, reabrir e fechar de novo, com execucoes em qualquer ordem', async () => {
    // O mundo final e "fechada"; so importa a execucao que roda por ultimo.
    for (const ultima of ['bloquear', 'apontar', 'bloquear']) {
      const mundo = mundoFalso({ branchExiste: true, prsAbertas: [], variaveis: DA_PR })
      await rodar(mundo, ultima)
      assert.deepEqual(mundo.valores(), valoresDe(TRAVADA), ultima)
    }
  })

  it('nao chama ninguem com acao desconhecida ou sem credencial da Vercel', async () => {
    const fetchImpl = mock.fn()
    await assert.rejects(executarAcao({ ...CREDENCIAIS, ...GITHUB, acao: 'limpar', gitBranch: BRANCH, fetchImpl }), /ACAO desconhecida/)
    await assert.rejects(executarAcao({ ...GITHUB, acao: 'bloquear', gitBranch: BRANCH, vercelProject: 'p', fetchImpl }), /VERCEL_TOKEN/)
    assert.equal(fetchImpl.mock.callCount(), 0)
  })
})

describe('acao do script', () => {
  const script = fileURLToPath(new URL('./preview-branch-env.mjs', import.meta.url))

  it('acao desconhecida ou ausente falha sem chamar ninguem', () => {
    // `limpar` era o nome antigo: cair no caminho de apontar por engano
    // gravaria variaveis numa branch que devia ficar travada.
    for (const acao of ['limpar', '', undefined]) {
      const env = { PATH: process.env.PATH ?? process.env.Path ?? '' }
      if (acao !== undefined) env.ACAO = acao
      const execucao = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
      assert.equal(execucao.status, 1, String(acao))
      assert.match(execucao.stderr, /ACAO desconhecida/, String(acao))
    }
  })
})

// Um passo de workflow que DECIDE alguma coisa so era exercitado abrindo PR e
// esperando o semaforo. As condicoes abaixo sao transcricao ao pe da letra do
// que esta em .github/workflows/banco-por-pr.yml; so a fonte dos dados muda.
// O ultimo teste do bloco confere que a transcricao nao envelheceu em silencio.
const CONDICAO_APONTAR = "github.event_name == 'workflow_dispatch' || (github.event.action != 'closed' && github.event.pull_request.head.repo.full_name == github.repository)"
const CONDICAO_DESTRAVAR = "github.event_name == 'pull_request' && (steps.classificar.outputs.perfil == 'documentation' || steps.classificar.outputs.perfil == 'ci-mechanism')"
const CONDICAO_TRAVAR = "github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository"
const CONDICAO_ESQUECER = "github.event_name == 'delete' && github.event.ref_type == 'branch'"
const GRUPO = "banco-por-pr-${{ github.event.pull_request.head.ref || inputs.git_branch || github.event.ref }}"
const AMBIENTE_PR = "${{ github.event.pull_request.number || inputs.pr_number }}"
const AMBIENTE_BRANCH = "${{ github.event.pull_request.head.ref || inputs.git_branch }}"

const apontarRoda = (evento, repositorio, nomeDoEvento) =>
  nomeDoEvento === 'workflow_dispatch'
  || (evento.action !== 'closed'
    && evento.pull_request?.head?.repo?.full_name === repositorio)

const destravarRoda = (nomeDoEvento, perfil) =>
  nomeDoEvento === 'pull_request'
  && (perfil === 'documentation' || perfil === 'ci-mechanism')

const travarRoda = (evento, repositorio) =>
  evento.action === 'closed'
  && evento.pull_request?.head?.repo?.full_name === repositorio

const esquecerRoda = (evento, nomeDoEvento) =>
  nomeDoEvento === 'delete'
  && evento.ref_type === 'branch'

// O `||` do GitHub devolve o primeiro operando verdadeiro, igual ao do
// JavaScript para o que interessa aqui: campo ausente e texto vazio sao falsos.
const numeroDaPr = (evento, inputs) => evento.pull_request?.number || inputs?.pr_number
const branchDaPr = (evento, inputs) => evento.pull_request?.head?.ref || inputs?.git_branch
const grupoDeConcorrencia = (evento, inputs) =>
  `banco-por-pr-${evento.pull_request?.head?.ref || inputs?.git_branch || evento.ref || ''}`

const REPO = 'Orodrigao/PaneProducao'
const daCasa = (action, ref = BRANCH) => ({
  action,
  pull_request: { number: 285, head: { ref, repo: { full_name: REPO } } },
})

const trabalhosQueRodam = (evento, nomeDoEvento) => [
  apontarRoda(evento, REPO, nomeDoEvento) && 'apontar',
  travarRoda(evento, REPO) && 'limpar',
  esquecerRoda(evento, nomeDoEvento) && 'esquecer',
].filter(Boolean)

describe('condicoes do workflow Banco por PR', () => {
  it('cada evento liga exatamente um trabalho, e o certo', () => {
    for (const action of ['opened', 'reopened', 'synchronize']) {
      assert.deepEqual(trabalhosQueRodam(daCasa(action), 'pull_request'), ['apontar'], action)
    }
    assert.deepEqual(trabalhosQueRodam(daCasa('closed'), 'pull_request'), ['limpar'])
    assert.deepEqual(trabalhosQueRodam({ ref: BRANCH, ref_type: 'branch' }, 'delete'), ['esquecer'])
  })

  // A armadilha que quase passou: em disparo manual nao existe
  // `github.event.pull_request`, entao a guarda contra fork viraria falsa e o
  // trabalho simplesmente nao rodaria, sem dizer por que.
  it('o disparo manual so aponta, mesmo sem existir pull_request no evento', () => {
    assert.deepEqual(trabalhosQueRodam({}, 'workflow_dispatch'), ['apontar'])
  })

  it('tag apagada e PR de fork nao ligam nada', () => {
    assert.deepEqual(trabalhosQueRodam({ ref: 'v1.0', ref_type: 'tag' }, 'delete'), [])
    const deFora = (action) => ({
      action,
      pull_request: { head: { ref: BRANCH, repo: { full_name: 'estranho/PaneProducao' } } },
    })
    assert.deepEqual(trabalhosQueRodam(deFora('opened'), 'pull_request'), [])
    assert.deepEqual(trabalhosQueRodam(deFora('closed'), 'pull_request'), [])
  })

  it('campo ausente no evento nao liga nenhum trabalho', () => {
    // Payload capado: se o caminho ate full_name ou ref_type sumir, a
    // comparacao vira undefined e tudo fica desligado. Falha fechado.
    assert.deepEqual(trabalhosQueRodam({ action: 'opened' }, 'pull_request'), [])
    assert.deepEqual(trabalhosQueRodam({ action: 'closed', pull_request: {} }, 'pull_request'), [])
    assert.deepEqual(trabalhosQueRodam({ ref: BRANCH }, 'delete'), [])
  })

  it('destrava so evento de PR sem mudanca de produto, por lista fechada de perfis', () => {
    // O trabalho inteiro so roda em PR aberta (abrir, reabrir, enviar); o
    // fechamento vai para outro trabalho.
    assert.equal(destravarRoda('pull_request', 'documentation'), true)
    assert.equal(destravarRoda('pull_request', 'ci-mechanism'), true)
    // Produto passa pelo passo Apontar, que ja destrava ou aponta.
    assert.equal(destravarRoda('pull_request', 'product'), false)
    // Classificacao ausente ou estranha nao destrava: falha fechado.
    assert.equal(destravarRoda('pull_request', undefined), false)
    assert.equal(destravarRoda('pull_request', ''), false)
    assert.equal(destravarRoda('pull_request', 'Documentation'), false)
    // Disparo manual: a classificacao nao roda e o passo Apontar acabou de
    // gravar o banco da PR. Destravar ali apagaria o que foi gravado.
    assert.equal(destravarRoda('workflow_dispatch', undefined), false)
    assert.equal(destravarRoda('workflow_dispatch', 'documentation'), false)
  })

  it('em disparo manual, numero e branch vem dos campos preenchidos a mao', () => {
    const manual = {}
    const inputs = { pr_number: '286', git_branch: 'fix/programacao-producao-pj-preview' }

    assert.equal(numeroDaPr(manual, inputs), '286')
    assert.equal(branchDaPr(manual, inputs), 'fix/programacao-producao-pj-preview')
  })

  it('em evento de PR, o evento manda e os campos manuais nao atrapalham', () => {
    const inputs = { pr_number: '286', git_branch: 'outra' }

    assert.equal(numeroDaPr(daCasa('synchronize'), inputs), 285)
    assert.equal(branchDaPr(daCasa('synchronize'), inputs), BRANCH)
  })

  it('fechar e apagar a mesma branch fazem fila; branches diferentes nao', () => {
    const fechar = grupoDeConcorrencia(daCasa('closed'), {})
    const apagar = grupoDeConcorrencia({ ref: BRANCH, ref_type: 'branch' }, {})
    assert.equal(fechar, `banco-por-pr-${BRANCH}`)
    assert.equal(apagar, fechar)

    // Sem os `||` os disparos manuais e as branches apagadas virariam todos
    // `banco-por-pr-` e, com cancel-in-progress, um cancelaria o outro.
    assert.notEqual(
      grupoDeConcorrencia({}, { pr_number: '286', git_branch: 'fix/a' }),
      grupoDeConcorrencia({}, { pr_number: '287', git_branch: 'fix/b' }),
    )
    assert.notEqual(
      grupoDeConcorrencia({ ref: 'fix/a', ref_type: 'branch' }, {}),
      grupoDeConcorrencia({ ref: 'fix/b', ref_type: 'branch' }, {}),
    )
    // No disparo manual o evento traz ref da main; o campo digitado vem antes.
    assert.equal(
      grupoDeConcorrencia({ ref: 'refs/heads/main' }, { git_branch: BRANCH }),
      `banco-por-pr-${BRANCH}`,
    )
  })

  it('a transcricao acima continua igual ao workflow de verdade', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/banco-por-pr.yml', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ')

    for (const [nome, trecho] of Object.entries({
      CONDICAO_APONTAR,
      CONDICAO_DESTRAVAR,
      CONDICAO_TRAVAR,
      CONDICAO_ESQUECER,
      GRUPO,
      AMBIENTE_PR,
      AMBIENTE_BRANCH,
    })) {
      assert.ok(workflow.includes(trecho), `${nome} mudou no workflow e este teste ficou para tras.`)
    }
    for (const trecho of [
      'ACAO: apontar',
      'ACAO: destravar',
      'ACAO: bloquear',
      'ACAO: esquecer',
      'GIT_BRANCH: ${{ github.event.ref }}',
      'name: Travar o preview da PR fechada',
      'cancel-in-progress: false',
    ]) {
      assert.ok(workflow.includes(trecho), `"${trecho}" saiu do workflow.`)
    }
    const cru = readFileSync(new URL('../.github/workflows/banco-por-pr.yml', import.meta.url), 'utf8')
    // Os quatro passos que chamam o script conferem o estado atual no GitHub.
    const chamadas = cru.split('run: node scripts/preview-branch-env.mjs').length - 1
    const comToken = cru.split('GITHUB_TOKEN: ${{ github.token }}').length - 1
    assert.equal(chamadas, 4)
    assert.equal(comToken, chamadas, 'Todo passo que chama o script precisa do GITHUB_TOKEN.')
    assert.doesNotMatch(cru, /cancel-in-progress: true/)
    assert.match(cru, /^on:\r?\n(?:(?: {2}.*)?\r?\n)*? {2}delete:\r?\n/m, 'O gatilho de branch apagada saiu do workflow.')
  })

  // A portaria (ConfirmPrDatabase) so libera o banco da PR lendo estes nomes.
  // Renomear aqui exige mudar preview_database_policy.pr_database_workflows na
  // portaria na mesma entrega.
  it('mantem os nomes de trabalho e passo cadastrados na portaria', () => {
    const cadastro = [
      ['banco-por-pr.yml', 'Apontar o preview para o banco desta PR', 'Apontar'],
      ['usuarios-banco-por-pr.yml', 'Criar contas ficticias e conferir perfis', 'Criar contas, ligar perfis e verificar o banco isolado'],
    ]
    for (const [arquivo, trabalho, passo] of cadastro) {
      const linhas = readFileSync(new URL(`../.github/workflows/${arquivo}`, import.meta.url), 'utf8').split(/\r?\n/)
      assert.ok(linhas.includes(`    name: ${trabalho}`), `${arquivo}: trabalho "${trabalho}" sumiu.`)
      assert.ok(linhas.includes(`      - name: ${passo}`), `${arquivo}: passo "${passo}" sumiu.`)
    }
  })
})

// O disparo manual recebe numero da PR e nome da branch em campos separados, e
// nada garante que combinem. Como o casamento da ramificacao aceita numero OU
// branch, uma branch errada sem ramificacao propria deixaria uma candidata so,
// pelo numero, e o preview de uma PR receberia o banco de outra: verde,
// silencioso e no banco errado. No workflow de usuarios, o seed de uma branch
// iria para o banco de outra PR. Os dois workflows conferem antes.
//
// Aqui nao ha transcricao: o bloco `run` DE VERDADE e recortado do YAML e
// executado no bash, com um `gh` falso no PATH. So a fonte dos dados muda.
const PASSO_DA_CONFERENCIA = 'Conferir que a branch informada e mesmo a da PR'

function blocoRunDoPasso(arquivo, nomeDoPasso) {
  const linhas = readFileSync(new URL(`../.github/workflows/${arquivo}`, import.meta.url), 'utf8').split(/\r?\n/)
  const recuo = (linha) => linha.length - linha.trimStart().length
  const inicio = linhas.findIndex((linha) => linha.trim() === `- name: ${nomeDoPasso}`)
  assert.ok(inicio >= 0, `${arquivo}: passo "${nomeDoPasso}" nao encontrado.`)

  let i = inicio + 1
  while (i < linhas.length && linhas[i].trim() !== 'run: |') {
    assert.ok(!linhas[i].trim() || recuo(linhas[i]) > recuo(linhas[inicio]), `${arquivo}: passo sem bloco run.`)
    i += 1
  }
  assert.ok(i < linhas.length, `${arquivo}: passo sem bloco run.`)

  const recuoDoRun = recuo(linhas[i])
  const corpo = []
  for (i += 1; i < linhas.length; i += 1) {
    if (linhas[i].trim() && recuo(linhas[i]) <= recuoDoRun) break
    corpo.push(linhas[i])
  }
  const base = Math.min(...corpo.filter((linha) => linha.trim()).map(recuo))
  return corpo.map((linha) => linha.slice(base)).join('\n').trimEnd() + '\n'
}

function rodarConferencia(bloco, { pr, branch, gh = {} }) {
  const pasta = mkdtempSync(join(tmpdir(), 'gh-falso-'))
  try {
    const registro = join(pasta, 'chamadas.txt')
    const falso = join(pasta, 'gh')
    writeFileSync(falso, [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$GH_FALSO_REGISTRO"',
      'case "$*" in',
      '  *headRefName*) [ -n "${GH_FALSO_FALHA_BRANCH:-}" ] && exit 1; printf "%s\\n" "${GH_FALSO_BRANCH:-}" ;;',
      '  *state*) [ -n "${GH_FALSO_FALHA_ESTADO:-}" ] && exit 1; printf "%s\\n" "${GH_FALSO_ESTADO:-}" ;;',
      '  *) exit 99 ;;',
      'esac',
      '',
    ].join('\n'))
    chmodSync(falso, 0o755)

    // No Windows a variavel se chama `Path`; duas grafias no mesmo ambiente
    // deixariam a escolha para o sistema.
    const env = {}
    for (const [chave, valor] of Object.entries(process.env)) {
      if (chave.toUpperCase() !== 'PATH') env[chave] = valor
    }
    const caminho = process.env.PATH ?? process.env.Path ?? ''
    Object.assign(env, {
      PATH: `${pasta}${delimiter}${caminho}`,
      GITHUB_REPOSITORY: REPO,
      GH_FALSO_REGISTRO: registro,
      PR_INFORMADA: pr,
      BRANCH_INFORMADA: branch,
      GH_FALSO_BRANCH: gh.branch ?? '',
      GH_FALSO_ESTADO: gh.estado ?? '',
      GH_FALSO_FALHA_BRANCH: gh.falhaBranch ? '1' : '',
      GH_FALSO_FALHA_ESTADO: gh.falhaEstado ? '1' : '',
    })

    const execucao = spawnSync('bash', ['-c', bloco], { env, encoding: 'utf8' })
    assert.ifError(execucao.error)
    return {
      status: execucao.status,
      saida: `${execucao.stdout}${execucao.stderr}`,
      chamadas: existsSync(registro) ? readFileSync(registro, 'utf8').split('\n').filter(Boolean) : [],
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

describe('conferencia da branch no disparo manual', () => {
  const BLOCOS = {
    'banco-por-pr.yml': blocoRunDoPasso('banco-por-pr.yml', PASSO_DA_CONFERENCIA),
    'usuarios-banco-por-pr.yml': blocoRunDoPasso('usuarios-banco-por-pr.yml', PASSO_DA_CONFERENCIA),
  }
  const ABERTA = { branch: BRANCH, estado: 'OPEN' }

  it('os dois workflows usam a mesma conferencia, letra por letra', () => {
    assert.equal(BLOCOS['usuarios-banco-por-pr.yml'], BLOCOS['banco-por-pr.yml'])
    assert.match(BLOCOS['banco-por-pr.yml'], /set -euo pipefail/)
  })

  it('os dois so rodam a conferencia no disparo manual e podem ler a PR', () => {
    for (const arquivo of Object.keys(BLOCOS)) {
      const texto = readFileSync(new URL(`../.github/workflows/${arquivo}`, import.meta.url), 'utf8')
      const trecho = texto.slice(texto.indexOf(`- name: ${PASSO_DA_CONFERENCIA}`))
      assert.match(trecho, /^- name: [^\n]+\r?\n\s+if: github\.event_name == 'workflow_dispatch'\r?\n/, arquivo)
      assert.ok(texto.includes('pull-requests: read'), `${arquivo}: sem permissao de leitura de PR.`)
    }
    // Em usuarios, a conferencia vem antes de buscar qualquer codigo da PR.
    const usuarios = readFileSync(new URL('../.github/workflows/usuarios-banco-por-pr.yml', import.meta.url), 'utf8')
    assert.ok(
      usuarios.indexOf(`- name: ${PASSO_DA_CONFERENCIA}`) < usuarios.indexOf('- name: Buscar migrations e seed da PR'),
      'A conferencia precisa rodar antes do checkout da PR.',
    )
  })

  for (const [arquivo, bloco] of Object.entries(BLOCOS)) {
    describe(arquivo, () => {
      it('aceita PR aberta com a branch certa', () => {
        const r = rodarConferencia(bloco, { pr: '285', branch: BRANCH, gh: ABERTA })
        assert.equal(r.status, 0, r.saida)
        assert.match(r.saida, /Confere: a PR 285 esta aberta/)
        assert.equal(r.chamadas.length, 2)
        assert.ok(r.chamadas.every((c) => c.includes(`--repo ${REPO}`) && c.startsWith('pr view 285 ')), r.chamadas.join('|'))
      })

      it('recusa quando o numero e de uma PR e a branch e de outra, inclusive por caixa', () => {
        for (const informada of ['chore/outra-coisa-qualquer', BRANCH.toUpperCase(), '', `${BRANCH} `]) {
          const r = rodarConferencia(bloco, { pr: '285', branch: informada, gh: ABERTA })
          assert.equal(r.status, 1, informada)
          assert.match(r.saida, /nao pertence a PR 285/, informada)
        }
      })

      it('recusa quando a leitura da PR falha ou vem sem branch', () => {
        let r = rodarConferencia(bloco, { pr: '285', branch: BRANCH, gh: { ...ABERTA, falhaBranch: true } })
        assert.equal(r.status, 1)
        assert.match(r.saida, /Nao consegui ler a PR 285/)

        r = rodarConferencia(bloco, { pr: '285', branch: BRANCH, gh: { ...ABERTA, branch: '' } })
        assert.equal(r.status, 1)
        assert.match(r.saida, /nao devolveu nome de branch/)
      })

      it('recusa PR fechada, mesclada, de estado ilegivel ou ausente', () => {
        for (const estado of ['CLOSED', 'MERGED', 'open', '']) {
          const r = rodarConferencia(bloco, { pr: '285', branch: BRANCH, gh: { branch: BRANCH, estado } })
          assert.equal(r.status, 1, estado)
          assert.match(r.saida, /nao esta aberta/, estado)
        }
        const r = rodarConferencia(bloco, { pr: '285', branch: BRANCH, gh: { ...ABERTA, falhaEstado: true } })
        assert.equal(r.status, 1)
        assert.match(r.saida, /Nao consegui ler o estado/)
      })

      it('recusa numero que nao seja so digitos, sem nem consultar o GitHub', () => {
        // `gh pr view` aceitaria nome de branch ou URL no lugar do numero, e o
        // nome digitado se conferiria consigo mesmo.
        for (const pr of [BRANCH, '285a', '', '0', '0285', ' 285', '285\n286', '#285']) {
          const r = rodarConferencia(bloco, { pr, branch: BRANCH, gh: ABERTA })
          assert.equal(r.status, 1, JSON.stringify(pr))
          assert.match(r.saida, /Numero de PR invalido/, JSON.stringify(pr))
          assert.deepEqual(r.chamadas, [], JSON.stringify(pr))
        }
      })
    })
  }
})

// A ponte concluia "nao achei ramificacao, logo esta PR nao mexe no banco".
// Sao coisas diferentes, e a PR 303 provou: ela alterava migration, ficou sem
// ramificacao, e a ponte a apontou para o banco compartilhado em VERDE, com a
// mensagem "o normal para quem nao mexe em migration". Schema novo testado
// contra schema velho e exatamente a mentira que esta ponte existe para matar.
//
// Quem sabe se o schema mudou e o diff da PR. O workflow decide por esta regra,
// transcrita ao pe da letra:
const REGRA_DA_DETECCAO = "grep -q '^supabase/' <<<\"$ARQUIVOS\""
const REGRA_DA_TRUNCAGEM = 'if [ "$RECEBIDOS" != "$DECLARADOS" ]; then'

const alteraSupabase = (arquivos) =>
  arquivos.some((caminho) => caminho.startsWith('supabase/'))

// A API de arquivos para em 3000 e nao avisa. So a comparacao com o numero
// que a propria PR declara transforma truncagem silenciosa em vermelho.
const listaConfere = (recebidos, declarados) => recebidos === declarados

describe('PR que altera supabase/ exige banco proprio', () => {
  it('reconhece qualquer arquivo de supabase/ e ignora vizinhos parecidos', () => {
    assert.equal(alteraSupabase(['supabase/migrations/20260831_x.sql']), true)
    assert.equal(alteraSupabase(['src/app/page.tsx', 'supabase/migrations/a.sql']), true)

    // Seed e teste de banco TAMBEM contam, porque e assim que a plataforma
    // decide: medido na PR 292, que mexeu so nesses dois e ganhou ramificacao.
    // Exigir menos do que ela cria deixa PR com banco proprio sem conferencia.
    assert.equal(alteraSupabase(['supabase/tests/invariantes.test.sql']), true)
    assert.equal(alteraSupabase(['supabase/seed.sql']), true)

    // Nome parecido em outro lugar da arvore nao conta.
    assert.equal(alteraSupabase(['docs/migrations/leia.md']), false)
    assert.equal(alteraSupabase(['src/lib/supabase/cliente.ts']), false)
    assert.equal(alteraSupabase([]), false)
  })

  it('falha fechado quando a PR mexe em supabase/ e nenhum banco aparece', async () => {
    const fetchImpl = mock.fn(async () => resposta([RAMIFICACAO_MAIN]))

    await assert.rejects(apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      prAlteraSupabase: true,
      esperarRamificacaoSegundos: 0,
      dormir: async () => {},
      fetchImpl,
      registrar: () => {},
    }), /altera supabase\/ e nenhum banco proprio apareceu/i)
  })

  it('espera a ramificacao nascer antes de desistir', async () => {
    // A ramificacao nasce em paralelo com o workflow, entao a primeira consulta
    // pode ser cedo demais. Desistir na primeira seria trocar uma corrida
    // perdida por um vermelho injusto.
    const respostas = [
      resposta([RAMIFICACAO_MAIN]),
      resposta([RAMIFICACAO_MAIN]),
      resposta([RAMIFICACAO_DA_PR]),
      resposta({ keys: [{ name: 'default', type: 'publishable', api_key: 'sb_publishable_da_pr' }] }),
      resposta({}),
      resposta({}),
      releituraDaPr(),
      resposta({ deployments: [{ uid: 'dpl_desta_branch' }] }),
      resposta({ id: 'dpl_novo' }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    let esperas = 0

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      prAlteraSupabase: true,
      dormir: async () => { esperas += 1 },
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'apontado')
    assert.equal(esperas, 2)
    assert.equal(respostas.length, 0)
  })

  it('PR que nao toca supabase/ segue no compartilhado, sem esperar', async () => {
    const fetchImpl = mock.fn(async (url) => (
      ehListagemVercel(url) ? resposta({ envs: [] }) : resposta([RAMIFICACAO_MAIN])
    ))

    const resultado = await apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      prAlteraSupabase: false,
      fetchImpl,
      registrar: () => {},
    })

    assert.equal(resultado.situacao, 'sem-ramificacao')
    // Uma consulta ao Supabase e uma leitura das variaveis da branch, sem espera.
    assert.equal(fetchImpl.mock.callCount(), 2)
  })

  // O terceiro caso que a realidade nao oferece: a lista truncada. A API de
  // arquivos para em 3000 e devolve sucesso, entao sem esta conferencia uma PR
  // gigante com a migration no fim passaria batida e o defeito voltaria calado.
  it('recusa listagem de arquivos incompleta', () => {
    assert.equal(listaConfere(139, 139), true)
    assert.equal(listaConfere(3000, 3412), false)
    assert.equal(listaConfere(0, 2), false)
    assert.equal(listaConfere(0, 0), true)
  })

  it('quando desiste, a mensagem nomeia a cota de ramificacoes', async () => {
    // Cota cheia reprova TODA PR de supabase, por motivo que nao e da PR. O
    // comportamento e o certo; a mensagem precisa dizer onde olhar, senao o
    // proximo depura a PR errada.
    const fetchImpl = mock.fn(async () => resposta([RAMIFICACAO_MAIN, RAMIFICACAO_DE_OUTRA, RAMIFICACAO_DA_PR_ALHEIA]))

    await assert.rejects(apontarPreviewParaRamificacao({
      ...CREDENCIAIS,
      ...alvo,
      prAlteraSupabase: true,
      esperarRamificacaoSegundos: 0,
      dormir: async () => {},
      fetchImpl,
      registrar: () => {},
    }), /3 ramificacao\(oes\) no projeto; se a cota estiver cheia/i)
  })

  it('a regra acima continua igual ao workflow de verdade', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/banco-por-pr.yml', import.meta.url),
      'utf8',
    )
    assert.ok(
      workflow.includes(REGRA_DA_TRUNCAGEM),
      'A conferencia de listagem truncada saiu do workflow e este teste ficou para tras.',
    )
    assert.ok(
      workflow.includes(REGRA_DA_DETECCAO),
      'A deteccao de migration mudou no workflow e este teste ficou para tras.',
    )
    assert.ok(
      workflow.includes('PR_ALTERA_SUPABASE=true') && workflow.includes('PR_ALTERA_SUPABASE=false'),
      'O workflow parou de informar ao script se a PR altera supabase/.',
    )
  })
})
