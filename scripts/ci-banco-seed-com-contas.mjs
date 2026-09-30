import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PREVIEW_USERS } from './provision-preview-users.mjs'
import { buildServerOnlySql, defaultRunProcess, readProjectId } from './verify-preview-seed-repeatability.mjs'

/**
 * Aplica no banco local do CI Banco o seed como o Banco Preview da main aplica
 * antes do pgTAP: contas ficticias no Auth, seed de novo por cima delas e
 * perfis conferidos. Sem as contas, o seed pula toda fixture que
 * depende de um perfil (financeiro, expedicao...) e o pgTAP da PR passa num
 * banco mais vazio que o da main. Foi assim que a PR 468 entrou verde e
 * quebrou o Banco Preview.
 *
 * So fala com o container local do `supabase db start` (nome vindo do
 * project_id do config.toml); nunca com projeto remoto.
 */

// Hash bcrypt fixo e publico, o mesmo dos testes de banco. A conta so existe
// no banco descartavel do CI, e o seed so procura o e-mail: nenhum segredo e
// necessario para ligar os perfis. A API do Auth nao e usada, entao nao ha
// auth.identities; o pgTAP nao testa login.
const LOCAL_PASSWORD_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW'

const SAFE_EMAIL = /^[a-z0-9.+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
const SAFE_DISPLAY_NAME = /^[A-Za-z0-9 ]+$/

export function buildAccountsSql(users = PREVIEW_USERS) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('Lista de contas ficticias vazia.')
  }
  const rows = users.map(({ email, displayName }) => {
    if (typeof email !== 'string' || !SAFE_EMAIL.test(email)) {
      throw new Error(`E-mail de conta ficticia recusado: ${JSON.stringify(email)}.`)
    }
    if (typeof displayName !== 'string' || !SAFE_DISPLAY_NAME.test(displayName)) {
      throw new Error(`Nome de conta ficticia recusado: ${JSON.stringify(displayName)}.`)
    }
    return `  ('${email}', '${displayName}')`
  })

  return `
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', account.email, '${LOCAL_PASSWORD_HASH}',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', account.display_name, 'ambiente', 'teste'),
  false
from (values
${rows.join(',\n')}
) as account(email, display_name)
where not exists (
  select 1 from auth.users existing where lower(existing.email) = account.email
);
`
}

export async function seedWithAccounts({
  workdir = process.cwd(),
  readFileImpl = readFile,
  runProcess = defaultRunProcess,
} = {}) {
  const config = await readFileImpl(resolve(workdir, 'supabase/config.toml'), 'utf8')
  const seed = await readFileImpl(resolve(workdir, 'supabase/seed.sql'), 'utf8')
  const verification = await readFileImpl(resolve(workdir, 'supabase/verification/preview_users.sql'), 'utf8')
  const containerName = `supabase_db_${readProjectId(config)}`

  const run = (sql) => runProcess('docker', [
    'exec', '-i', containerName,
    'psql', '--username', 'postgres', '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--file', '-',
  ], { input: buildServerOnlySql(sql) })

  // Mesma ordem do Banco Preview: contas, seed por cima, conferencia dos perfis.
  await run(buildAccountsSql())
  await run(seed)
  await run(verification)

  console.log(`${PREVIEW_USERS.length} contas ficticias criadas, seed reaplicado e perfis conferidos, como no Banco Preview.`)
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  await seedWithAccounts().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha ao aplicar o seed com as contas ficticias.')
    process.exitCode = 1
  })
}
