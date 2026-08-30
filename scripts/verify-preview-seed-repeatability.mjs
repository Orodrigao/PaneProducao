import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FIXED_PLAN_ID = '54000000-0000-4000-8000-000000000002'
const AUTH_PLAN_ID = '54000000-0000-4000-8000-000000000001'
const TEST_ADMIN_ID = '94000000-0000-4000-8000-000000000001'

const AUTH_FIXTURE_SQL = `
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '${TEST_ADMIN_ID}', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'rodrigao+teste@gmail.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
)
on conflict (id) do update set
  email = excluded.email,
  updated_at = excluded.updated_at;
`

export function readProjectId(config) {
  const match = String(config ?? '').match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/m)
  if (!match) throw new Error('project_id local ausente ou invalido em supabase/config.toml.')
  return match[1]
}

export function buildServerOnlySql(sql) {
  const source = String(sql ?? '')
  if (source.includes('\\')) {
    throw new Error('O arquivo SQL contem comando local do psql e foi recusado.')
  }
  return `begin;\n${source}\ncommit;`
}

export function defaultRunProcess(command, args, { input }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(stderr || stdout || `docker terminou com codigo ${code}.`))
    })
    child.stdin.end(input)
  })
}

async function runLocalPsql({ containerName, sql, runProcess }) {
  await runProcess('docker', [
    'exec', '-i', containerName,
    'psql', '--username', 'postgres', '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--file', '-',
  ], { input: buildServerOnlySql(sql) })
}

export async function verifyPreviewSeedRepeatability({
  workdir = process.cwd(),
  readFileImpl = readFile,
  runProcess = defaultRunProcess,
} = {}) {
  const config = await readFileImpl(resolve(workdir, 'supabase/config.toml'), 'utf8')
  const seed = await readFileImpl(resolve(workdir, 'supabase/seed.sql'), 'utf8')
  const containerName = `supabase_db_${readProjectId(config)}`

  await runLocalPsql({ containerName, sql: AUTH_FIXTURE_SQL, runProcess })
  await runLocalPsql({ containerName, sql: seed, runProcess })
  await runLocalPsql({
    containerName,
    sql: `
do $proof$
begin
  if (select count(*) from public.production_plans where id in ('${AUTH_PLAN_ID}', '${FIXED_PLAN_ID}')) <> 2 then
    raise exception 'A prova exige os dois planos ficticios antes da virada do dia.';
  end if;
end
$proof$;

update public.production_plans
set production_date = case id
  when '${AUTH_PLAN_ID}' then date '2000-01-01'
  when '${FIXED_PLAN_ID}' then date '2000-01-02'
end
where id in ('${AUTH_PLAN_ID}', '${FIXED_PLAN_ID}');
`,
    runProcess,
  })
  await runLocalPsql({ containerName, sql: seed, runProcess })
  await runLocalPsql({
    containerName,
    sql: `
do $proof$
begin
  if not exists (
    select 1
    from public.production_plans
    where id = '${FIXED_PLAN_ID}'
      and production_date = (now() at time zone 'America/Sao_Paulo')::date
  ) then
    raise exception 'O plano diario nao voltou para hoje.';
  end if;

  if not exists (
    select 1
    from public.production_plans
    where id = '${AUTH_PLAN_ID}'
      and production_date = (
        (now() at time zone 'America/Sao_Paulo')::date
        + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
            when 0 then 1 when 1 then 1 when 2 then 1 when 3 then 1
            when 4 then 2 when 5 then 1 when 6 then 2
          end::integer
      )
  ) then
    raise exception 'O plano ligado ao Auth nao voltou para a data programada.';
  end if;

  if not exists (
    select 1 from public.production_plan_items
    where id = '55000000-0000-4000-8000-000000000001' and plan_id = '${AUTH_PLAN_ID}'
  ) or not exists (
    select 1 from public.production_plan_items
    where id = '55000000-0000-4000-8000-000000000002' and plan_id = '${FIXED_PLAN_ID}'
  ) then
    raise exception 'A reaplicacao perdeu o vinculo entre item e plano.';
  end if;
end
$proof$;
`,
    runProcess,
  })

  console.log('Os dois planos do seed foram reaplicados depois da virada ficticia do dia.')
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  await verifyPreviewSeedRepeatability().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha ao reaplicar o seed local.')
    process.exitCode = 1
  })
}
