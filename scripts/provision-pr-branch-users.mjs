import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  'POSTGRES_URL',
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
    postgresUrl = new URL(branchEnvironment.POSTGRES_URL)
  } catch {
    postgresUrl = null
  }
  const postgresIsExpected = postgresUrl
    && ['postgres:', 'postgresql:'].includes(postgresUrl.protocol)
    && /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(postgresUrl.hostname.toLowerCase())
    && decodeURIComponent(postgresUrl.username) === `postgres.${expectedProjectRef}`
    && postgresUrl.port === '6543'
    && postgresUrl.pathname === '/postgres'

  if (!postgresIsExpected) {
    throw new Error('A conexao Postgres nao pertence a ramificacao esperada.')
  }
}

export function buildSessionPoolerUrl(branchEnvironment, expectedProjectRef) {
  validateBranchEnvironment(branchEnvironment, expectedProjectRef)
  const sessionUrl = new URL(branchEnvironment.POSTGRES_URL)
  sessionUrl.port = '5432'
  return sessionUrl.toString()
}

export function buildPsqlConnection(branchEnvironment, expectedProjectRef) {
  const sessionUrl = new URL(buildSessionPoolerUrl(branchEnvironment, expectedProjectRef))
  const password = decodeURIComponent(sessionUrl.password)
  const connectTimeout = sessionUrl.searchParams.get('connect_timeout')

  return {
    args: [
      '--host', sessionUrl.hostname,
      '--port', sessionUrl.port,
      '--username', decodeURIComponent(sessionUrl.username),
      '--dbname', sessionUrl.pathname.slice(1),
      '--no-password',
      '--set', 'ON_ERROR_STOP=1',
    ],
    env: {
      PGPASSWORD: password,
      PGSSLMODE: 'require',
      ...(connectTimeout ? { PGCONNECT_TIMEOUT: connectTimeout } : {}),
    },
    secrets: [sessionUrl.toString(), password],
  }
}

export function buildPsqlServerCommand(sql) {
  const source = String(sql ?? '')
  if (/^[\t ]*\\/m.test(source)) {
    throw new Error('O arquivo SQL contem comando local do psql e foi recusado.')
  }
  return `begin;
${source}
commit;`
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

export async function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.inheritEnvironment === false
      ? { ...options.env }
      : { ...process.env, ...options.env },
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
  // Raiz da automacao confiavel, que o workflow sempre traz da main. Separada de
  // propósito da copia da PR.
  trustedRoot = process.cwd(),
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
  const psqlConnection = buildPsqlConnection(branchEnvironment, branch.project_ref)

  await ensurePreviewUsers({
    previewProjectRef: branch.project_ref,
    supabaseUrl: branchEnvironment.SUPABASE_URL,
    serviceRoleKey: branchEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    testUserPassword,
    environmentKind: 'preview-branch',
    fetchImpl,
  })

  try {
    // O SEED vem da PR, de proposito: e a mudanca dela que precisa entrar no
    // banco isolado, senao o preview nao testa o que a PR fez.
    //
    // O ROTEIRO DE CONFERENCIA vem sempre da main, como o resto da automacao.
    // Lido da copia da PR, uma entrega poderia afrouxar a propria conferencia:
    // bastaria enfraquecer esse arquivo no mesmo commit para o check ficar verde
    // sem provar nada. Quem confere nao pode ser escolhido por quem e conferido.
    const arquivos = [
      { caminho: 'supabase/seed.sql', raiz: workdir },
      { caminho: 'supabase/verification/preview_users.sql', raiz: trustedRoot },
    ]
    for (const { caminho: file, raiz } of arquivos) {
      const sql = await readFile(resolve(raiz, file), 'utf8')
      await runCommand('psql', [
        ...psqlConnection.args,
        '--command',
        buildPsqlServerCommand(sql),
      ], {
        cwd: workdir,
        inheritEnvironment: false,
        env: {
          PATH: process.env.PATH,
          LANG: process.env.LANG || 'C.UTF-8',
          ...psqlConnection.env,
        },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao ligar os perfis ficticios.'
    throw new Error(redactSecrets(message, [
      supabaseToken,
      testUserPassword,
      branchEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      branchEnvironment.POSTGRES_URL,
      ...psqlConnection.secrets,
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
      // PROVISION_WORKDIR aponta para a copia da PR. A raiz do processo e sempre
      // a automacao vinda da main, e e dela que sai o roteiro de conferencia.
      trustedRoot: process.cwd(),
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
