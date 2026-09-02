import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildPsqlConnection,
  buildPsqlServerCommand,
  buildSessionPoolerUrl,
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
    const raizDaPr = mkdtempSync(join(tmpdir(), 'copia-da-pr-'))
    mkdirSync(join(raizDaPr, 'supabase', 'verification'), { recursive: true })
    writeFileSync(join(raizDaPr, 'supabase', 'seed.sql'), 'select 1; -- seed legitimo da PR')
    writeFileSync(
      join(raizDaPr, 'supabase', 'verification', 'preview_users.sql'),
      'select 1; -- conferencia afrouxada pela propria PR',
    )

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
