import { pathToFileURL } from 'node:url'

export const PREVIEW_PROJECT_REF = 'tuqzhjsbodoycjbmwuqm'

export const PREVIEW_USERS = [
  { email: 'rodrigao+teste@gmail.com', displayName: 'Rodrigo Teste' },
  { email: 'rodrigao+teste-vendas-ja@gmail.com', displayName: 'Vendas JA Teste' },
  { email: 'rodrigao+teste-expedicao-jc@gmail.com', displayName: 'Expedicao JC Teste' },
  { email: 'rodrigao+teste-romaneio-ex@gmail.com', displayName: 'Romaneio EX Teste' },
  { email: 'rodrigao+teste-cozinha-jc@gmail.com', displayName: 'Cozinha JC Teste' },
]

const COMMON_WEAK_PASSWORDS = new Set([
  '1234567890',
  '123456789',
  '12345678',
  'senha123',
  'senha1234',
  'senha12345',
  'senha123!',
  'senha1234!',
  'password1',
  'password123',
  'qwerty123',
  'admin123',
])

const SEQUENTIAL_PATTERNS = [
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  'abcdef',
  'qwerty',
  'asdfgh',
]

export function validatePreviewUserEnvironment({
  previewProjectRef,
  supabaseUrl,
  serviceRoleKey,
  testUserPassword,
}) {
  if (previewProjectRef !== PREVIEW_PROJECT_REF) {
    throw new Error('Provisionamento bloqueado: nao e o projeto Preview esperado.')
  }

  let projectRef
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase()
    projectRef = hostname.endsWith('.supabase.co')
      ? hostname.slice(0, -'.supabase.co'.length)
      : null
  } catch {
    projectRef = null
  }

  if (projectRef !== PREVIEW_PROJECT_REF) {
    throw new Error('Provisionamento bloqueado: URL nao pertence ao projeto Preview esperado.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_PREVIEW_SERVICE_ROLE_KEY ausente.')
  }

  const normalizedPassword = typeof testUserPassword === 'string'
    ? testUserPassword.toLowerCase()
    : ''
  const followsPasswordPolicy = typeof testUserPassword === 'string'
    && testUserPassword.length >= 10
    && /[a-z]/.test(testUserPassword)
    && /[A-Z]/.test(testUserPassword)
    && /[0-9]/.test(testUserPassword)
    && /[^A-Za-z0-9]/.test(testUserPassword)
    && !COMMON_WEAK_PASSWORDS.has(normalizedPassword)
    && !normalizedPassword.includes('pane')
    && !normalizedPassword.includes('salute')
    && !/^senha\d*!?$/.test(normalizedPassword)
    && !/^password\d*!?$/.test(normalizedPassword)
    && !/(.)\1{3,}/.test(testUserPassword)
    && !SEQUENTIAL_PATTERNS.some(pattern => normalizedPassword.includes(pattern))

  if (!followsPasswordPolicy) {
    throw new Error('SUPABASE_TEST_USER_PASSWORD nao atende a politica de senha.')
  }
}

async function readJson(response) {
  const body = await response.text()
  return body ? JSON.parse(body) : {}
}

async function assertSuccessful(response, action) {
  if (response.ok) return

  const details = await readJson(response)
  const message = typeof details.message === 'string' ? details.message : response.statusText
  throw new Error(`${action} falhou (${response.status}): ${message}`)
}

export async function ensurePreviewUsers({
  previewProjectRef,
  supabaseUrl,
  serviceRoleKey,
  testUserPassword,
  fetchImpl = fetch,
}) {
  validatePreviewUserEnvironment({
    previewProjectRef,
    supabaseUrl,
    serviceRoleKey,
    testUserPassword,
  })

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  const endpoint = `${supabaseUrl}/auth/v1/admin/users`
  const listResponse = await fetchImpl(`${endpoint}?page=1&per_page=1000`, { headers })
  await assertSuccessful(listResponse, 'Listagem de usuarios de teste')
  const listedUsers = await readJson(listResponse)
  const usersByEmail = new Map(
    (listedUsers.users ?? []).map((user) => [user.email?.toLowerCase(), user]),
  )

  for (const user of PREVIEW_USERS) {
    const existingUser = usersByEmail.get(user.email)
    const response = await fetchImpl(
      existingUser ? `${endpoint}/${existingUser.id}` : endpoint,
      {
        method: existingUser ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({
          email: user.email,
          password: testUserPassword,
          email_confirm: true,
          user_metadata: { display_name: user.displayName, ambiente: 'teste' },
        }),
      },
    )
    await assertSuccessful(response, `Provisionamento de ${user.email}`)
  }
}

async function main() {
  await ensurePreviewUsers({
    previewProjectRef: process.env.PREVIEW_PROJECT_REF,
    supabaseUrl: process.env.PREVIEW_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_PREVIEW_SERVICE_ROLE_KEY,
    testUserPassword: process.env.SUPABASE_TEST_USER_PASSWORD,
  })
  console.log(`${PREVIEW_USERS.length} contas ficticias do Banco Preview estao prontas.`)
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida ao criar contas de teste.')
    process.exitCode = 1
  })
}
