import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { after, describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildPsqlConnection,
  buildPsqlServerCommand,
  buildSessionPoolerUrl,
  mesmoDiretorio,
  parseBranchEnvironment,
  provisionPreviewBranchUsers,
  redactSecrets,
  validateBranchEnvironment,
  waitForPreviewBranch,
  waitForSupabasePreviewCheck,
} from './provision-pr-branch-users.mjs'

const BRANCH_REF = 'unnlpxjuxikreramqlwz'
const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/usuarios-banco-por-pr.yml', import.meta.url))
const RAIZ_CONFIAVEL = fileURLToPath(new URL('..', import.meta.url))
const INTERNAL_OR_MANUAL_CONDITION = "github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository"
const BRANCH_ENV = [
  `POSTGRES_URL=postgresql://postgres.${BRANCH_REF}:senha-url-teste-9z8y7x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?connect_timeout=10`,
  `POSTGRES_URL_NON_POOLING=postgresql://postgres:senha-url-teste-9z8y7x@db.${BRANCH_REF}.supabase.co:5432/postgres`,
  'SUPABASE_SERVICE_ROLE_KEY=service-role-teste',
  `SUPABASE_URL=https://${BRANCH_REF}.supabase.co`,
].join('\n')

function readyBranch() {
  return {
    id: 'branch-id',
    name: 'pr-286',
    pr_number: 286,
    git_branch: 'fix/programacao-producao-pj-preview',
    project_ref: BRANCH_REF,
    is_default: false,
    status: 'MIGRATIONS_PASSED',
    preview_project_status: 'ACTIVE_HEALTHY',
  }
}

describe('credenciais do banco isolado', () => {
  it('aceita somente o conjunto minimo e confirma que a URL pertence a branch', () => {
    const parsed = parseBranchEnvironment(BRANCH_ENV)
    validateBranchEnvironment(parsed, BRANCH_REF)
    assert.equal(parsed.SUPABASE_SERVICE_ROLE_KEY, 'service-role-teste')
  })

  it('transforma o pooler de transacao no pooler de sessao IPv4 da mesma branch', () => {
    const sessionUrl = new URL(buildSessionPoolerUrl(parseBranchEnvironment(BRANCH_ENV), BRANCH_REF))
    assert.equal(sessionUrl.hostname, 'aws-0-sa-east-1.pooler.supabase.com')
    assert.equal(sessionUrl.port, '5432')
    assert.equal(decodeURIComponent(sessionUrl.username), `postgres.${BRANCH_REF}`)
    assert.equal(sessionUrl.pathname, '/postgres')
    assert.equal(sessionUrl.searchParams.get('connect_timeout'), '10')
  })

  it('monta o psql sem colocar senha nos argumentos', () => {
    const connection = buildPsqlConnection(parseBranchEnvironment(BRANCH_ENV), BRANCH_REF)
    assert.deepEqual(connection.args, [
      '--host', 'aws-0-sa-east-1.pooler.supabase.com',
      '--port', '5432',
      '--username', `postgres.${BRANCH_REF}`,
      '--dbname', 'postgres',
      '--no-password',
      '--set', 'ON_ERROR_STOP=1',
    ])
    assert.deepEqual(connection.env, {
      PGPASSWORD: 'senha-url-teste-9z8y7x',
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10',
    })
    assert.ok(connection.args.every((argument) => !argument.includes('senha-url-teste-9z8y7x')))
  })

  it('envia somente SQL ao servidor e recusa comandos locais do psql', () => {
    assert.equal(
      buildPsqlServerCommand('select 1;'),
      'begin;\nselect 1;\ncommit;',
    )
    for (const maliciousSql of [
      'select 1;\n\\! env',
      '  \\getenv token GITHUB_TOKEN',
    ]) {
      assert.throws(() => buildPsqlServerCommand(maliciousSql), /comando local/i)
    }
  })

  it('recusa producao, banco compartilhado e URL de outra branch', () => {
    const parsed = parseBranchEnvironment(BRANCH_ENV)
    assert.throws(() => validateBranchEnvironment(parsed, 'gohluceldchoitihrimw'), /producao/i)
    assert.throws(() => validateBranchEnvironment(parsed, 'tuqzhjsbodoycjbmwuqm'), /compartilhado/i)
    assert.throws(() => validateBranchEnvironment(parsed, 'aaaaaaaaaaaaaaaaaaaa'), /nao pertencem/i)
  })

  it('recusa pooler de outra branch, host arbitrario ou porta inesperada', () => {
    for (const [from, to] of [
      [`postgres.${BRANCH_REF}`, 'postgres.gohluceldchoitihrimw'],
      ['aws-0-sa-east-1.pooler.supabase.com', 'localhost'],
      [':6543/postgres', ':5432/postgres'],
    ]) {
      const parsed = parseBranchEnvironment(
        BRANCH_ENV.replace(from, to),
      )
      assert.throws(() => validateBranchEnvironment(parsed, BRANCH_REF), /conexao Postgres/i)
    }
  })

  it('nao deixa segredo aparecer em mensagem de erro', () => {
    assert.equal(redactSecrets('falhou com senha-secreta', ['senha-secreta']), 'falhou com [OCULTO]')
  })
})

describe('condicoes do workflow de usuarios por PR', () => {
  const shouldProvision = (event, repository) => event.name === 'workflow_dispatch'
    || event.pull_request?.head?.repo?.full_name === repository

  it('aceita disparo manual e PR interna, mas nunca PR de fork ou evento incompleto', () => {
    assert.equal(shouldProvision({ name: 'workflow_dispatch' }, 'PaneERP'), true)
    assert.equal(shouldProvision({
      name: 'pull_request',
      pull_request: { head: { repo: { full_name: 'PaneERP' } } },
    }, 'PaneERP'), true)
    assert.equal(shouldProvision({
      name: 'pull_request',
      pull_request: { head: { repo: { full_name: 'fork/PaneERP' } } },
    }, 'PaneERP'), false)
    assert.equal(shouldProvision({ name: 'pull_request' }, 'PaneERP'), false)
  })

  it('mantem a guarda, o filtro Supabase e os dois segredos no workflow real', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8').replace(/\s+/g, ' ')
    assert.match(workflow, /paths: - 'supabase\/\*\*'/)
    assert.ok(workflow.includes(INTERNAL_OR_MANUAL_CONDITION))
    assert.match(workflow, /ref: main/)
    assert.match(workflow, /path: _pr-source/)
    assert.match(workflow, /PROVISION_WORKDIR:/)
    assert.match(workflow, /checks: read/)
    assert.match(workflow, /PR_HEAD_SHA=/)
    assert.match(workflow, /GITHUB_TOKEN:/)
    assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/)
    assert.match(workflow, /secrets\.SUPABASE_TEST_USER_PASSWORD/)
  })

  // O script so consegue separar a automacao confiavel da copia da PR porque roda
  // a partir do checkout da main. Estas duas assercoes cobrem as formas de mudar
  // o DIRETORIO DE EXECUCAO sem tocar em JavaScript: `working-directory` no
  // passo, a mesma chave dentro de um `defaults:` do job, e um `cd` no comando.
  //
  // O QUE ELAS NAO COBREM, para ninguem confundir alcance com garantia: elas
  // olham a forma do passo, nao a PROVENIENCIA dos arquivos. Um terceiro
  // `actions/checkout` da PR por cima da raiz confiavel, ou um `cp` de uma copia
  // para a outra, derrotam a separacao inteira sem mexer no diretorio, e passam
  // por aqui. E, o que e mais contraintuitivo: em evento `pull_request` o GitHub
  // roda o workflow DA PROPRIA PR, nao o da main, e o `npm test` do ci.yml roda
  // sobre o checkout da PR. Ou seja, quem abre a PR controla o arquivo conferido
  // E esta assercao. Isto e uma rede contra descuido, nao contra adversario;
  // contra adversario quem segura e a revisao humana do diff do workflow e a
  // guarda que barra PR de fork.
  it('nao deixa o workflow mudar o diretorio de onde o script roda', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    // Sem ancora de proposito: a chave entre aspas e o `defaults:` em estilo
    // flow escapariam de uma regex presa ao inicio da linha. O custo e barrar
    // ate um comentario que cite o termo, e esse custo esta pago.
    assert.doesNotMatch(
      workflow,
      /working-directory/,
      'working-directory, no passo ou num defaults do job, colapsaria a raiz confiavel na copia da PR',
    )
    // O `- ` opcional aceita as duas formas validas de YAML, com e sem `name:`
    // acima. Sem ele a assercao barraria uma reformatacao inofensiva, e assercao
    // que reclama do que nao importa e assercao que a proxima pessoa apaga.
    assert.match(
      workflow,
      /^\s*(- )?run: node scripts\/provision-pr-branch-users\.mjs\s*$/m,
      'o script tem de ser chamado nu: um cd antes dele mudaria o diretorio sem usar working-directory',
    )
  })

  // Regressao que este proprio commit quase deixou passar. Antes, os testes
  // liam o seed REAL por acidente, porque `workdir` caia no diretorio do
  // processo, e isso pegava de graca um comando local do psql escondido no
  // arquivo. Agora que os testes usam copias de mentira, esse guarda-chuva
  // sumiu. Aqui ele volta explicito, o que e melhor do que era: diz o que testa.
  //
  // O roteiro entra junto por simetria. Ele hoje passa pelo mesmo funil so de
  // carona, num teste que existe para outra coisa, e essa carona e exatamente a
  // armadilha que acabou de acontecer com o seed.
  //
  // Alcance exato, para o nome nao prometer demais: `buildPsqlServerCommand`
  // recusa barra invertida no INICIO da linha. Meta-comando no meio de uma linha
  // nao e recusado por ela; o que segura esse caso e o `-c` do psql, que so
  // trata barra como comando local quando ela abre o argumento, e o argumento
  // sempre abre com `begin;`.
  it('o seed e o roteiro reais nao tem comando local do psql em inicio de linha', () => {
    for (const arquivo of ['../supabase/seed.sql', '../supabase/verification/preview_users.sql']) {
      const sql = readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), 'utf8')
      assert.doesNotThrow(() => buildPsqlServerCommand(sql), `${arquivo} foi recusado`)
    }
  })
})

describe('waitForSupabasePreviewCheck', () => {
  it('espera o check do mesmo commit e aceita somente sucesso', async () => {
    const answers = [
      { check_runs: [{ name: 'Supabase Preview', status: 'in_progress', conclusion: null }] },
      { check_runs: [{ name: 'Supabase Preview', status: 'completed', conclusion: 'success' }] },
    ]
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify(answers.shift()), { status: 200 }))
    const sleep = mock.fn(async () => {})
    const check = await waitForSupabasePreviewCheck({
      githubRepository: 'Orodrigao/PaneProducao',
      githubToken: 'github-token',
      prHeadSha: 'a'.repeat(40),
      fetchImpl,
      sleep,
      now: () => 1,
      log: () => {},
    })

    assert.equal(check.conclusion, 'success')
    assert.equal(fetchImpl.mock.callCount(), 2)
    assert.match(fetchImpl.mock.calls[0].arguments[0], new RegExp(`/commits/${'a'.repeat(40)}/check-runs`))
  })

  it('recusa check vermelho e commit ausente', async () => {
    await assert.rejects(() => waitForSupabasePreviewCheck({
      githubRepository: 'Orodrigao/PaneProducao',
      githubToken: 'github-token',
      prHeadSha: 'b'.repeat(40),
      fetchImpl: async () => new Response(JSON.stringify({
        check_runs: [{ name: 'Supabase Preview', status: 'completed', conclusion: 'failure' }],
      }), { status: 200 }),
      now: () => 1,
      log: () => {},
    }), /failure/i)

    await assert.rejects(() => waitForSupabasePreviewCheck({
      githubRepository: 'Orodrigao/PaneProducao',
      githubToken: 'github-token',
      prHeadSha: '',
    }), /commit/i)
  })
})

describe('waitForPreviewBranch', () => {
  it('espera a branch ficar saudavel', async () => {
    const lists = [
      [{ ...readyBranch(), status: 'RUNNING_MIGRATIONS' }],
      [readyBranch()],
    ]
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify(lists.shift()), { status: 200 }))
    const sleep = mock.fn(async () => {})

    const branch = await waitForPreviewBranch({
      prNumber: 286,
      gitBranch: 'fix/programacao-producao-pj-preview',
      supabaseToken: 'token-teste',
      fetchImpl,
      sleep,
      now: () => 1,
      log: () => {},
    })

    assert.equal(branch.project_ref, BRANCH_REF)
    assert.equal(fetchImpl.mock.callCount(), 2)
    assert.equal(sleep.mock.callCount(), 1)
  })

  it('falha fechado quando a branch esperada nao aparece', async () => {
    await assert.rejects(() => waitForPreviewBranch({
      prNumber: 286,
      gitBranch: 'fix/programacao-producao-pj-preview',
      supabaseToken: 'token-teste',
      timeoutMs: 0,
      fetchImpl: async () => new Response('[]', { status: 200 }),
      now: () => 1,
      log: () => {},
    }), /nao ficou pronto/i)
  })
})

// Monta uma copia de PR de mentira, num diretorio proprio. E como a automacao
// roda de verdade: o checkout da main num lugar, o codigo da PR noutro. Passar
// as duas raizes explicitamente em todo teste tambem impede que alguem tape a
// trava de raizes iguais so para um teste antigo voltar a passar.
const copiasDaPr = []

function montarCopiaDaPr({ seed = 'select 1; -- seed legitimo da PR', roteiro } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'copia-da-pr-'))
  copiasDaPr.push(raiz)
  mkdirSync(join(raiz, 'supabase', 'verification'), { recursive: true })
  writeFileSync(join(raiz, 'supabase', 'seed.sql'), seed)
  if (roteiro !== undefined) {
    writeFileSync(join(raiz, 'supabase', 'verification', 'preview_users.sql'), roteiro)
  }
  return raiz
}

const apelidos = []

after(() => {
  // Os apelidos primeiro, e sempre por unlink: apagar em modo recursivo um
  // junction vivo poderia atravessar para dentro do alvo.
  for (const apelido of apelidos) {
    try {
      unlinkSync(apelido)
    } catch {
      try { rmdirSync(apelido) } catch { /* apelido ja sumiu */ }
    }
  }
  for (const raiz of copiasDaPr) rmSync(raiz, { recursive: true, force: true })
})

// A trava do script compara DIRETORIOS, nao textos. Estes casos sao os apelidos
// que uma comparacao de string deixaria passar, e cada um deles reabriria em
// silencio o buraco que a trava fecha.
describe('mesmoDiretorio', () => {
  it('reconhece a mesma pasta escrita de outras formas', () => {
    const raiz = montarCopiaDaPr()
    assert.equal(mesmoDiretorio(raiz, raiz), true)
    assert.equal(mesmoDiretorio(raiz, `${raiz}${sep}`), true, 'barra no fim')
    assert.equal(mesmoDiretorio(raiz, join(raiz, 'supabase', '..')), true, 'volta com ..')
    if (process.platform === 'win32') {
      assert.equal(mesmoDiretorio(raiz, raiz.toUpperCase()), true,
        'no Windows a caixa das letras nao distingue diretorio')
    }
  })

  it('reconhece a mesma pasta sob outro nome do sistema de arquivos', (t) => {
    const raiz = montarCopiaDaPr()
    const apelido = `${raiz}-apelido`
    try {
      symlinkSync(raiz, apelido, 'junction')
    } catch {
      t.skip('este sistema nao deixou criar junction ou symlink')
      return
    }
    apelidos.push(apelido)
    assert.equal(mesmoDiretorio(raiz, apelido), true,
      'junction e symlink sao outro nome da MESMA pasta')
  })

  it('nao confunde duas pastas que sao mesmo diferentes', () => {
    assert.equal(mesmoDiretorio(montarCopiaDaPr(), montarCopiaDaPr()), false)
  })

  it('cai na comparacao de texto quando o caminho ainda nao existe', () => {
    const inexistente = join(tmpdir(), 'nao-existe-de-proposito-4f2a')
    assert.equal(mesmoDiretorio(inexistente, inexistente), true)
    assert.equal(mesmoDiretorio(inexistente, `${inexistente}-outro`), false)
  })
})

describe('provisionPreviewBranchUsers', () => {
  it('cria contas, reaplica o seed e verifica os perfis', async () => {
    const responses = [
      new Response(JSON.stringify({
        check_runs: [{ name: 'Supabase Preview', status: 'completed', conclusion: 'success' }],
      }), { status: 200 }),
      new Response(JSON.stringify([readyBranch()]), { status: 200 }),
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
      ...Array.from({ length: 7 }, () => new Response('{}', { status: 200 })),
    ]
    const fetchImpl = mock.fn(async () => responses.shift())
    const runCommand = mock.fn(async (_command, args) => ({
      stdout: args.includes('branches') ? BRANCH_ENV : '',
      stderr: '',
    }))

    const result = await provisionPreviewBranchUsers({
      prNumber: 286,
      gitBranch: 'fix/programacao-producao-pj-preview',
      prHeadSha: 'c'.repeat(40),
      githubRepository: 'Orodrigao/PaneProducao',
      githubToken: 'github-token',
      supabaseToken: 'token-teste',
      testUserPassword: 'SenhaTeste1!',
      workdir: montarCopiaDaPr(),
      trustedRoot: RAIZ_CONFIAVEL,
      fetchImpl,
      runCommand,
      log: () => {},
    })

    assert.deepEqual(result, { projectRef: BRANCH_REF, users: 7 })
    assert.equal(runCommand.mock.callCount(), 3)
    assert.deepEqual(
      runCommand.mock.calls.slice(1).map((call) => call.arguments[0]),
      ['psql', 'psql'],
    )
    assert.deepEqual(
      runCommand.mock.calls.slice(1).map((call) => call.arguments[1].at(-2)),
      ['--command', '--command'],
    )
    for (const call of runCommand.mock.calls.slice(1)) {
      const [command, args, options] = call.arguments
      assert.equal(command, 'psql')
      assert.equal(args[args.indexOf('--host') + 1], 'aws-0-sa-east-1.pooler.supabase.com')
      assert.equal(args[args.indexOf('--port') + 1], '5432')
      assert.equal(args[args.indexOf('--username') + 1], `postgres.${BRANCH_REF}`)
      assert.equal(args[args.indexOf('--dbname') + 1], 'postgres')
      assert.ok(args[args.indexOf('--command') + 1].startsWith('begin;\n'))
      assert.ok(args[args.indexOf('--command') + 1].endsWith('\ncommit;'))
      assert.ok(!args.includes('--file'))
      assert.equal(options.inheritEnvironment, false)
      assert.equal(options.env.PGPASSWORD, 'senha-url-teste-9z8y7x')
      assert.equal(options.env.PGSSLMODE, 'require')
      assert.deepEqual(
        Object.keys(options.env).sort(),
        ['LANG', 'PATH', 'PGCONNECT_TIMEOUT', 'PGPASSWORD', 'PGSSLMODE'].sort(),
      )
      assert.ok(args.every((argument) => !argument.includes('senha-url-teste-9z8y7x')))
    }
  })

  // O seed PRECISA vir da PR: e a mudanca dela que tem de entrar no banco isolado.
  // O roteiro de conferencia NAO pode: lido da copia da PR, bastaria enfraquecer o
  // arquivo no mesmo commit para o check ficar verde sem provar nada. Quem confere
  // nao pode ser escolhido por quem e conferido. Este teste monta exatamente esse
  // ataque: a copia da PR traz um roteiro afrouxado, e ele precisa ser ignorado.
  it('le o seed da PR, mas o roteiro de conferencia sempre da main', async () => {
    const raizDaPr = montarCopiaDaPr({
      roteiro: 'select 1; -- conferencia afrouxada pela propria PR',
    })

    const responses = [
      new Response(JSON.stringify({
        check_runs: [{ name: 'Supabase Preview', status: 'completed', conclusion: 'success' }],
      }), { status: 200 }),
      new Response(JSON.stringify([readyBranch()]), { status: 200 }),
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
      ...Array.from({ length: 7 }, () => new Response('{}', { status: 200 })),
    ]
    const fetchImpl = mock.fn(async () => responses.shift())
    const runCommand = mock.fn(async (_command, args) => ({
      stdout: args.includes('branches') ? BRANCH_ENV : '',
      stderr: '',
    }))

    await provisionPreviewBranchUsers({
      prNumber: 286,
      gitBranch: 'fix/programacao-producao-pj-preview',
      prHeadSha: 'c'.repeat(40),
      githubRepository: 'Orodrigao/PaneProducao',
      githubToken: 'github-token',
      supabaseToken: 'token-teste',
      testUserPassword: 'SenhaTeste1!',
      workdir: raizDaPr,
      trustedRoot: RAIZ_CONFIAVEL,
      fetchImpl,
      runCommand,
      log: () => {},
    })

    const enviados = runCommand.mock.calls.slice(1).map(call => {
      const args = call.arguments[1]
      return args[args.indexOf('--command') + 1]
    })

    assert.match(enviados[0], /seed legitimo da PR/,
      'o seed continua vindo da copia da PR')
    assert.doesNotMatch(enviados[1], /conferencia afrouxada pela propria PR/,
      'o roteiro de conferencia NAO pode vir da copia da PR')
    assert.match(enviados[1], /expected_users/,
      'o roteiro de conferencia vem do arquivo real da main')
  })

  // A separacao das duas raizes e o que segura tudo, e ela mora no workflow, nao
  // no script. Sem esta trava, um `working-directory: _pr-source` no passo (ou um
  // PROVISION_WORKDIR esquecido) colapsaria as duas em silencio: o roteiro
  // voltaria a vir da PR e nenhum teste falharia. Falha FECHADA, antes da rede.
  it('recusa rodar quando a raiz confiavel e a copia da PR sao o mesmo diretorio', async () => {
    const mesmaRaiz = montarCopiaDaPr()
    const fetchImpl = mock.fn(async () => new Response('{}', { status: 200 }))
    const runCommand = mock.fn(async () => ({ stdout: BRANCH_ENV, stderr: '' }))

    await assert.rejects(
      () => provisionPreviewBranchUsers({
        prNumber: 286,
        gitBranch: 'fix/programacao-producao-pj-preview',
        prHeadSha: 'e'.repeat(40),
        githubRepository: 'Orodrigao/PaneProducao',
        githubToken: 'github-token',
        supabaseToken: 'token-teste',
        testUserPassword: 'SenhaTeste1!',
        workdir: mesmaRaiz,
        trustedRoot: mesmaRaiz,
        fetchImpl,
        runCommand,
        // Sem paciencia e sem espera: se a trava sumir um dia, este teste tem de
        // FALHAR em milissegundos, e nao ficar pendurado ate o timeout de cinco
        // minutos da espera pelo banco. Teste que trava em vez de falhar some do
        // radar de quem esta olhando o semaforo.
        timeoutMs: 0,
        sleep: async () => {},
        log: () => {},
      }),
      (error) => {
        assert.match(error.message, /mesmo diretorio/)
        assert.match(error.message, /PROVISION_WORKDIR/)
        return true
      },
    )

    assert.equal(fetchImpl.mock.callCount(), 0, 'barra antes de qualquer chamada de rede')
    assert.equal(runCommand.mock.callCount(), 0, 'barra antes de tocar no banco')
  })

  it('oculta a conexao do banco se a reaplicacao do seed falhar', async () => {
    const responses = [
      new Response(JSON.stringify({
        check_runs: [{ name: 'Supabase Preview', status: 'completed', conclusion: 'success' }],
      }), { status: 200 }),
      new Response(JSON.stringify([readyBranch()]), { status: 200 }),
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
      ...Array.from({ length: 7 }, () => new Response('{}', { status: 200 })),
    ]
    const runCommand = mock.fn(async (_command, args) => {
      if (args.includes('branches')) return { stdout: BRANCH_ENV, stderr: '' }
      throw new Error(`falha ao conectar em ${parseBranchEnvironment(BRANCH_ENV).POSTGRES_URL}`)
    })

    await assert.rejects(
      () => provisionPreviewBranchUsers({
        prNumber: 286,
        gitBranch: 'fix/programacao-producao-pj-preview',
        prHeadSha: 'd'.repeat(40),
        githubRepository: 'Orodrigao/PaneProducao',
        githubToken: 'github-token',
        supabaseToken: 'token-teste',
        testUserPassword: 'SenhaTeste1!',
        workdir: montarCopiaDaPr(),
        trustedRoot: RAIZ_CONFIAVEL,
        fetchImpl: async () => responses.shift(),
        runCommand,
        log: () => {},
      }),
      (error) => {
        assert.doesNotMatch(error.message, /postgresql:\/\//)
        assert.match(error.message, /\[OCULTO\]/)
        return true
      },
    )
  })
})
