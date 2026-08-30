import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  escolherRamificacao,
  ramificacaoEstaPronta,
} from './preview-branch-env.mjs'
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  PREVIEW_USERS,
  ensurePreviewUsers,
} from './provision-preview-users.mjs'

const execFileAsync = promisify(execFile)

const REQUIRED_BRANCH_ENV = [
  'POSTGRES_URL_NON_POOLING',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
]

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

export function parseBranchEnvironment(output) {
  const parsed = {}
  for (const rawLine of String(output ?? '').split(/\r?\n/)) {
    const separator = rawLine.indexOf('=')
    if (separator <= 0) continue
    const key = rawLine.slice(0, separator).trim()
    if (!/^[A-Z0-9_]+$/.test(key)) continue
    parsed[key] = unquote(rawLine.slice(separator + 1).trim())
  }

  const missing = REQUIRED_BRANCH_ENV.filter((key) => !parsed[key])
  if (missing.length > 0) {
    throw new Error(`Credenciais incompletas da ramificacao: faltam ${missing.join(', ')}.`)
  }
  return parsed
}

export function validateBranchEnvironment(branchEnvironment, expectedProjectRef) {
  if (!expectedProjectRef) {
    throw new Error('A ramificacao encontrada nao informou project_ref.')
  }
  if (expectedProjectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('Provisionamento recusado: a ramificacao aponta para producao.')
  }
  if (expectedProjectRef === PREVIEW_PROJECT_REF) {
    throw new Error('Provisionamento recusado: a ramificacao aponta para o banco compartilhado.')
  }

  let urlProjectRef
  try {
    const hostname = new URL(branchEnvironment.SUPABASE_URL).hostname.toLowerCase()
    urlProjectRef = hostname.endsWith('.supabase.co')
      ? hostname.slice(0, -'.supabase.co'.length)
      : null
  } catch {
    urlProjectRef = null
  }

  if (urlProjectRef !== expectedProjectRef) {
    throw new Error('As credenciais devolvidas nao pertencem a ramificacao esperada.')
  }

  let postgresUrl
  try {
    postgresUrl = new URL(branchEnvironment.POSTGRES_URL_NON_POOLING)
  } catch {
    postgresUrl = null
  }
  const expectedHost = `db.${expectedProjectRef}.supabase.co`
  const postgresIsExpected = postgresUrl
    && ['postgres:', 'postgresql:'].includes(postgresUrl.protocol)
    && postgresUrl.hostname.toLowerCase() === expectedHost
    && decodeURIComponent(postgresUrl.username) === 'postgres'
    && postgresUrl.port === '5432'
    && postgresUrl.pathname === '/postgres'

  if (!postgresIsExpected) {
    throw new Error('A conexao Postgres nao pertence a ramificacao esperada.')
  }
}

async function fetchBranchList({ supabaseToken, fetchImpl }) {
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT_REF}/branches`,
    { headers: { Authorization: `Bearer ${supabaseToken}` } },
  )
  if (!response.ok) {
    throw new Error(`Listagem das ramificacoes falhou (${response.status}).`)
  }
  const body = await response.json()
  return Array.isArray(body) ? body : body?.branches
}

export async function waitForPreviewBranch({
  prNumber,
  gitBranch,
  supabaseToken,
  timeoutMs = 300_000,
  intervalMs = 10_000,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  if (!prNumber) throw new Error('Numero da PR ausente.')
  if (!gitBranch) throw new Error('Nome da branch Git ausente.')
  if (!supabaseToken) throw new Error('SUPABASE_ACCESS_TOKEN ausente.')

  const deadline = now() + timeoutMs
  while (true) {
    const branches = await fetchBranchList({ supabaseToken, fetchImpl })
    const choice = escolherRamificacao(branches, { prNumber, gitBranch })
    if (choice.situacao === 'encontrada' && ramificacaoEstaPronta(choice.ramificacao)) {
      return choice.ramificacao
    }
    if (now() >= deadline) {
      throw new Error(`O banco isolado da PR ${prNumber} nao ficou pronto em ${timeoutMs / 1000}s.`)
    }
    log('Banco isolado ainda nao esta pronto; aguardando sem tocar em producao.')
    await sleep(intervalMs)
  }
}

export async function waitForSupabasePreviewCheck({
  githubRepository,
  githubToken,
  prHeadSha,
  timeoutMs = 300_000,
  intervalMs = 10_000,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  if (!githubRepository) throw new Error('GITHUB_REPOSITORY ausente.')
  if (!githubToken) throw new Error('GITHUB_TOKEN ausente.')
  if (!/^[0-9a-f]{40}$/i.test(prHeadSha ?? '')) throw new Error('Commit da PR ausente ou invalido.')

  const deadline = now() + timeoutMs
  const endpoint = `https://api.github.com/repos/${githubRepository}/commits/${prHeadSha}/check-runs`
    + '?check_name=Supabase%20Preview&filter=latest&per_page=100'

  while (true) {
    const response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) {
      throw new Error(`Consulta do check Supabase Preview falhou (${response.status}).`)
    }
    const body = await response.json()
    const checks = Array.isArray(body?.check_runs)
      ? body.check_runs.filter((check) => check?.name === 'Supabase Preview')
      : []
    const completed = checks.find((check) => check.status === 'completed')
    if (completed) {
      if (completed.conclusion !== 'success') {
        throw new Error(`O Supabase Preview do commit terminou como ${completed.conclusion}.`)
      }
      return completed
    }
    if (now() >= deadline) {
      throw new Error(`O Supabase Preview do commit ${prHeadSha.slice(0, 7)} nao terminou em ${timeoutMs / 1000}s.`)
    }
    log('O Supabase ainda esta aplicando este commit; aguardando o check exato.')
    await sleep(intervalMs)
  }
}

async function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  })
}

export function redactSecrets(message, secrets) {
  let safe = String(message ?? '')
  for (const secret of secrets.filter(Boolean)) {
    safe = safe.split(String(secret)).join('[OCULTO]')
  }
  return safe
}

export async function provisionPreviewBranchUsers({
  prNumber,
  gitBranch,
  prHeadSha,
  githubRepository,
  githubToken,
  supabaseToken,
  testUserPassword,
  workdir = process.cwd(),
  fetchImpl = fetch,
  runCommand = defaultRunCommand,
  timeoutMs,
  intervalMs,
  now,
  sleep,
  log = console.log,
}) {
  await waitForSupabasePreviewCheck({
    githubRepository,
    githubToken,
    prHeadSha,
    timeoutMs,
    intervalMs,
    fetchImpl,
    now,
    sleep,
    log,
  })

  const branch = await waitForPreviewBranch({
    prNumber,
    gitBranch,
    supabaseToken,
    timeoutMs,
    intervalMs,
    fetchImpl,
    now,
    sleep,
    log,
  })

  const environmentResult = await runCommand('supabase', [
    '--experimental',
    'branches',
    'get',
    gitBranch,
    '--project-ref',
    PRODUCTION_PROJECT_REF,
    '-o',
    'env',
  ], { cwd: workdir, env: { SUPABASE_ACCESS_TOKEN: supabaseToken } })
  const branchEnvironment = parseBranchEnvironment(environmentResult.stdout)
  validateBranchEnvironment(branchEnvironment, branch.project_ref)

  await ensurePreviewUsers({
    previewProjectRef: branch.project_ref,
    supabaseUrl: branchEnvironment.SUPABASE_URL,
    serviceRoleKey: branchEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    testUserPassword,
    environmentKind: 'preview-branch',
    fetchImpl,
  })

  try {
    for (const file of ['supabase/seed.sql', 'supabase/verification/preview_users.sql']) {
      await runCommand('supabase', [
        'db',
        'query',
        '--db-url',
        branchEnvironment.POSTGRES_URL_NON_POOLING,
        '--file',
        file,
      ], { cwd: workdir, env: { SUPABASE_ACCESS_TOKEN: supabaseToken } })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao ligar os perfis ficticios.'
    throw new Error(redactSecrets(message, [
      supabaseToken,
      testUserPassword,
      branchEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      branchEnvironment.POSTGRES_URL_NON_POOLING,
    ]))
  }

  log(`${PREVIEW_USERS.length} contas ficticias e seus perfis estao prontos no banco isolado.`)
  return { projectRef: branch.project_ref, users: PREVIEW_USERS.length }
}

async function main() {
  const sensitiveValues = [
    process.env.GITHUB_TOKEN,
    process.env.SUPABASE_ACCESS_TOKEN,
    process.env.SUPABASE_TEST_USER_PASSWORD,
  ]
  try {
    await provisionPreviewBranchUsers({
      prNumber: process.env.PR_NUMBER,
      gitBranch: process.env.GIT_BRANCH,
      prHeadSha: process.env.PR_HEAD_SHA,
      githubRepository: process.env.GITHUB_REPOSITORY,
      githubToken: process.env.GITHUB_TOKEN,
      supabaseToken: process.env.SUPABASE_ACCESS_TOKEN,
      testUserPassword: process.env.SUPABASE_TEST_USER_PASSWORD,
      workdir: process.env.PROVISION_WORKDIR || process.cwd(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida no banco isolado.'
    console.error(redactSecrets(message, sensitiveValues))
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) await main()
