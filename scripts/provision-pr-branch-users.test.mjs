import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
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
const INTERNAL_OR_MANUAL_CONDITION = "github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository"
const BRANCH_ENV = [
  `POSTGRES_URL=postgresql://postgres.${BRANCH_REF}:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?connect_timeout=10`,
  `POSTGRES_URL_NON_POOLING=postgresql://postgres:senha@db.${BRANCH_REF}.supabase.co:5432/postgres`,
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
      runCommand.mock.calls.slice(1).map((call) => call.arguments[1].at(-1)),
      ['supabase/seed.sql', 'supabase/verification/preview_users.sql'],
    )
    const databaseUrls = runCommand.mock.calls.slice(1)
      .map((call) => call.arguments[1][call.arguments[1].indexOf('--db-url') + 1])
      .map((value) => new URL(value))
    assert.ok(databaseUrls.every((url) => url.port === '5432'))
    assert.ok(databaseUrls.every((url) => decodeURIComponent(url.username) === `postgres.${BRANCH_REF}`))
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
