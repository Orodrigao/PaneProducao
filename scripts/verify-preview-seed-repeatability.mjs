import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FIXED_PLAN_ID = '54000000-0000-4000-8000-000000000002'
const AUTH_PLAN_ID = '54000000-0000-4000-8000-000000000001'
const TEST_ADMIN_ID = '94000000-0000-4000-8000-000000000001'
const HISTORICAL_JC_FIRST_ID = '7fc00000-0000-4000-8000-000000000002'
const HISTORICAL_JC_NEXT_ID = '7fc00000-0000-4000-8000-000000000003'
const HISTORICAL_JC_FIRST_ITEM_ID = '7ec00000-0000-4000-8000-000000000002'
const HISTORICAL_JC_FIRST_LEFTOVER_ID = '7dc00000-0000-4000-8000-000000000002'
const SCHEDULED_PJ_ORDER_ID = '30000000-0000-4000-8000-000000000101'
const SCHEDULED_PJ_ORDER_DELIVERY_OFFSET = 2
const SCHEDULED_PJ_BREAD_ID = 'teste-brioche-pj'
const SCHEDULED_PJ_REQUEST_ID = '58000000-0000-4000-8000-000000000001'
const SCHEDULED_PJ_AUTHOR_ID = '59000000-0000-4000-8000-000000000001'
const BILLED_PJ_ORDER_GROUP_ID = '70000000-0000-4000-8000-000000000001'
const BILLED_PJ_RECEIVABLE_ID = '57000000-0000-4000-8000-000000000001'
const BILLED_PJ_CUSTOMER_ID = '60000000-0000-4000-8000-000000000001'
const REUSE_PLAN_ID = '56000000-0000-4000-8000-000000000001'
const JC_REUSE_ORDER_ID = '30000000-0000-4000-8000-000000000004'
const JC_NEW_ORDER_ID = '30000000-0000-4000-8000-000000000005'

const AUTH_FIXTURE_SQL = `
do $proof$
begin
  if exists (
    select 1 from auth.users
    where id = '${TEST_ADMIN_ID}' or lower(email) = 'rodrigao+teste@gmail.com'
  ) then
    raise exception 'A fixture Auth da prova ja existe no banco local.';
  end if;
end
$proof$;

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
);
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

  if (select count(*) from public.romaneios where id in ('${HISTORICAL_JC_FIRST_ID}', '${HISTORICAL_JC_NEXT_ID}')) <> 2 then
    raise exception 'A prova exige o par de romaneios historicos antes da virada do dia.';
  end if;

  if not exists (
    select 1 from public.orders
    where id = '${SCHEDULED_PJ_ORDER_ID}' and order_type = 'pj'
  ) then
    raise exception 'A prova exige o pedido PJ ficticio antes da virada do dia.';
  end if;
end
$proof$;

update public.production_plans
set production_date = case id
  when '${AUTH_PLAN_ID}' then date '2000-01-01'
  when '${FIXED_PLAN_ID}' then date '2000-01-02'
end
where id in ('${AUTH_PLAN_ID}', '${FIXED_PLAN_ID}');

-- Simula o estado deixado pela execucao de ontem. A segunda fixture ocupa a
-- data que a primeira tentara usar hoje, reproduzindo a colisao real.
update public.romaneios
set record_date = (now() at time zone 'America/Sao_Paulo')::date - 8
where id = '${HISTORICAL_JC_FIRST_ID}';

update public.romaneios
set record_date = (now() at time zone 'America/Sao_Paulo')::date - 7
where id = '${HISTORICAL_JC_NEXT_ID}';

-- O outro lado da virada: o pedido PJ ficou com a data de ontem e a Producao
-- ja programou essa linha para o forno. A ordem importa, porque a trava
-- guard_scheduled_pj_order_changes so passa a proibir a alteracao depois de
-- existir programacao; invertendo os dois comandos, a fixture nao nasce.
update public.orders
set order_date = order_date - 1,
    delivery_date = delivery_date - 1,
    pj_delivery_date = pj_delivery_date - 1
where id = '${SCHEDULED_PJ_ORDER_ID}';

insert into public.pj_production_schedules (
  order_id, production_date, bread_id, scheduled_quantity,
  frozen_quantity, request_id, created_by, created_by_name
) values (
  '${SCHEDULED_PJ_ORDER_ID}',
  (now() at time zone 'America/Sao_Paulo')::date,
  '${SCHEDULED_PJ_BREAD_ID}', 12, 0,
  '${SCHEDULED_PJ_REQUEST_ID}', '${SCHEDULED_PJ_AUTHOR_ID}',
  '[TESTE] Producao programou antes da virada'
);

-- A segunda porta: alguem confirmou o envio, e isso gerou cobranca. A partir
-- daqui guard_billed_pj_order_changes barra qualquer mudanca de data no pedido.
-- Vem depois do recuo das datas pelo mesmo motivo da programacao: antes da
-- cobranca existir, o recuo ainda e permitido.
insert into public.receivables (
  id, request_id, customer_id, origin, origin_ref, finance_category_id,
  description, invoice_date, original_due_date, due_date, amount, status, created_by
)
select
  '${BILLED_PJ_RECEIVABLE_ID}', '${BILLED_PJ_RECEIVABLE_ID}',
  '${BILLED_PJ_CUSTOMER_ID}', 'pedido_pj', '${BILLED_PJ_ORDER_GROUP_ID}',
  (select id from public.finance_categories order by id limit 1),
  '[TESTE] cobranca gerada pela confirmacao de envio antes da virada',
  (now() at time zone 'America/Sao_Paulo')::date,
  (now() at time zone 'America/Sao_Paulo')::date + 7,
  (now() at time zone 'America/Sao_Paulo')::date + 7,
  403.20, 'aberta', '${TEST_ADMIN_ID}';

-- Terceira porta: o par ficticio da JC na chave unica de loja, pao e data.
-- Ontem o ...0005 ficou com a data de ontem e o ...0004 foi parar exatamente na
-- data de hoje, que e a que o ...0005 vai pedir agora. O ...0005 recua primeiro
-- porque, sem soltar a data, o proprio comando seguinte ja bateria na chave.
update public.orders
set order_date = order_date - 1
where id = '${JC_NEW_ORDER_ID}';

update public.orders
set order_date = (now() at time zone 'America/Sao_Paulo')::date
where id = '${JC_REUSE_ORDER_ID}';

-- Quarta porta: o plano de reaproveitamento tem id fixo e data movel. Basta a
-- data-alvo mudar para o upsert tentar inserir o mesmo id de novo.
update public.bread_reuse_plans
set target_production_date = target_production_date - 1
where id = '${REUSE_PLAN_ID}';
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

  if not exists (
    select 1 from public.romaneios
    where id = '${HISTORICAL_JC_FIRST_ID}'
      and record_date = (now() at time zone 'America/Sao_Paulo')::date - 7
  ) or not exists (
    select 1 from public.romaneios
    where id = '${HISTORICAL_JC_NEXT_ID}'
      and record_date = (now() at time zone 'America/Sao_Paulo')::date - 6
  ) then
    raise exception 'O historico ficticio nao foi recriado nas datas de hoje.';
  end if;

  if not exists (
    select 1 from public.romaneio_items
    where id = '${HISTORICAL_JC_FIRST_ITEM_ID}'
      and romaneio_id = '${HISTORICAL_JC_FIRST_ID}'
      and product_id = 'teste-historico'
      and qty_sent = 20
  ) then
    raise exception 'O item do historico ficticio nao foi recriado.';
  end if;

  if not exists (
    select 1 from public.sobras
    where id = '${HISTORICAL_JC_FIRST_LEFTOVER_ID}'
      and record_date = (now() at time zone 'America/Sao_Paulo')::date - 7
      and product_id = 'teste-historico'
      and store = 'jc'
      and quantity = 4
  ) then
    raise exception 'A sobra do historico ficticio nao foi recriada.';
  end if;

  if not exists (
    select 1 from public.orders
    where id = '${SCHEDULED_PJ_ORDER_ID}'
      and order_date = (now() at time zone 'America/Sao_Paulo')::date
      and delivery_date = (now() at time zone 'America/Sao_Paulo')::date
        + ${SCHEDULED_PJ_ORDER_DELIVERY_OFFSET}
      and pj_delivery_date = (now() at time zone 'America/Sao_Paulo')::date
        + ${SCHEDULED_PJ_ORDER_DELIVERY_OFFSET}
  ) then
    raise exception 'O pedido PJ ja programado nao voltou para as datas de hoje.';
  end if;

  if exists (
    select 1 from public.pj_production_schedules
    where order_id = '${SCHEDULED_PJ_ORDER_ID}'
  ) then
    raise exception 'A programacao ficticia do forno sobreviveu a reaplicacao do seed.';
  end if;

  if not exists (
    select 1 from public.receivables
    where id = '${BILLED_PJ_RECEIVABLE_ID}'
      and status = 'cancelada'
      and cancelled_at is not null
  ) then
    raise exception 'A cobranca ficticia do pedido PJ nao foi cancelada pela reaplicacao do seed.';
  end if;

  if not exists (
    select 1 from public.orders
    where id = '${JC_NEW_ORDER_ID}'
      and order_date = (now() at time zone 'America/Sao_Paulo')::date
  ) then
    raise exception 'O pedido novo da JC nao voltou para a data de hoje.';
  end if;

  if not exists (
    select 1 from public.orders
    where id = '${JC_REUSE_ORDER_ID}'
      and order_date > (now() at time zone 'America/Sao_Paulo')::date
  ) then
    raise exception 'O pedido reaproveitado da JC nao saiu da data de hoje.';
  end if;

  if (select count(*) from public.bread_reuse_plans where id = '${REUSE_PLAN_ID}') <> 1 then
    raise exception 'O plano de reaproveitamento ficticio nao sobreviveu inteiro a reaplicacao.';
  end if;

  if not exists (
    select 1 from public.bread_reuse_plans
    where id = '${REUSE_PLAN_ID}'
      and target_production_date > (now() at time zone 'America/Sao_Paulo')::date
  ) then
    raise exception 'O plano de reaproveitamento nao voltou para a data-alvo de hoje.';
  end if;
end
$proof$;
`,
    runProcess,
  })
  await runLocalPsql({
    containerName,
    sql: `
-- A cobranca ficticia sai antes da conta Auth: receivables.created_by aponta
-- para auth.users com "on delete no action", entao a ordem inversa travaria a
-- limpeza. Os eventos dela saem em cascata.
delete from public.receivables where id = '${BILLED_PJ_RECEIVABLE_ID}';

delete from public.production_plan_items where plan_id = '${AUTH_PLAN_ID}';
delete from public.production_plans where id = '${AUTH_PLAN_ID}';
delete from public.bread_reuse_plans where id = '56000000-0000-4000-8000-000000000001';
delete from public.app_user_permissions where user_id = '${TEST_ADMIN_ID}';
delete from public.app_profiles where user_id = '${TEST_ADMIN_ID}';
delete from auth.users
where id = '${TEST_ADMIN_ID}' and lower(email) = 'rodrigao+teste@gmail.com';

do $proof$
begin
  if exists (select 1 from public.receivables where id = '${BILLED_PJ_RECEIVABLE_ID}')
    or exists (select 1 from auth.users where id = '${TEST_ADMIN_ID}')
    or exists (select 1 from public.production_plans where id = '${AUTH_PLAN_ID}')
    or exists (select 1 from public.production_plan_items where plan_id = '${AUTH_PLAN_ID}')
    or exists (select 1 from public.bread_reuse_plans where id = '56000000-0000-4000-8000-000000000001')
    or exists (select 1 from public.app_profiles where user_id = '${TEST_ADMIN_ID}')
    or exists (select 1 from public.app_user_permissions where user_id = '${TEST_ADMIN_ID}') then
    raise exception 'A fixture Auth nao foi removida depois da prova.';
  end if;
end
$proof$;
`,
    runProcess,
  })

  console.log('Os planos e o historico do seed foram reaplicados depois da virada ficticia do dia.')
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  await verifyPreviewSeedRepeatability().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha ao reaplicar o seed local.')
    process.exitCode = 1
  })
}
