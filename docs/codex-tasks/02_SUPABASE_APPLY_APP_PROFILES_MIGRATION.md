# 02 - Apply App Profiles Migration

## Objetivo

Revisar e aplicar, com aprovacao explicita do Rodrigo, a migration local que cria `public.app_profiles` no Supabase.

Esta tarefa transforma a fundacao criada na tarefa 01 em schema real no banco, sem mudar o login atual, sem criar usuarios e sem alterar tabelas de negocio.

## Contexto obrigatorio

Antes de executar, leia:

- `AGENTS.md`
- `docs/codex-tasks/01_SUPABASE_AUTH_PROFILES_FOUNDATION.md`
- `supabase/migrations/20260614120000_create_app_profiles.sql`
- `docs/SUPABASE_RLS_REMEDIATION_PLAN.md`
- `docs/SUPABASE_LIVE_INVENTORY.md`

Confirme em 5 a 10 linhas o que entendeu antes de pedir aprovacao para aplicar qualquer SQL.

## Migration alvo

Arquivo esperado:

```text
supabase/migrations/20260614120000_create_app_profiles.sql
```

O Codex deve confirmar que a migration:

- cria somente `public.app_profiles`;
- cria somente funcao/trigger de `updated_at` relacionada a `app_profiles`;
- habilita RLS e `force row level security` somente em `app_profiles`;
- revoga acesso de `anon`;
- concede apenas `select` para `authenticated`;
- cria policy para usuario autenticado ler apenas o proprio profile;
- nao cria seed;
- nao cria usuario Supabase Auth;
- nao copia PIN;
- nao altera `app_users`;
- nao altera tabelas de negocio.

## Escopo permitido

Pode:

- revisar o SQL local;
- consultar o historico remoto de migrations;
- consultar metadados do Supabase com `SELECT` para verificar existencia de tabela, RLS, grants e policies;
- aplicar a migration alvo somente apos aprovacao explicita do Rodrigo;
- documentar o resultado da aplicacao;
- atualizar este arquivo ou docs diretamente relacionados, se houver divergencia real encontrada.

## Proibido

Nao pode:

- aplicar migration sem aprovacao explicita;
- executar SQL solto de escrita em producao;
- alterar `app_users`, PINs, roles, rotas ou login;
- criar ou convidar usuarios no Supabase Auth;
- inserir dados em `app_profiles`;
- alterar `src/`;
- alterar `.env`, secrets, tokens ou chaves;
- alterar `products`, `stock_*`, `customers`, `price_*`, `sobras`, `descartes`, `orders`, `purchase_*` ou qualquer tabela de negocio;
- remover policies existentes fora de `app_profiles`;
- mexer em Edge Functions;
- commitar sem autorizacao.

## Passo a passo esperado

### 1. Preparacao local

Rodar:

```bash
git status -sb
sed -n '1,220p' supabase/migrations/20260614120000_create_app_profiles.sql
```

Conferir se ha alteracoes locais nao relacionadas. Se houver, nao reverter; apenas reportar.

### 2. Checagem remota somente leitura

Usar apenas comandos de leitura ou Supabase MCP com `SELECT`.

Checar:

- se a migration ja aparece no historico remoto;
- se `public.app_profiles` ja existe;
- se existem policies/grants conflitantes para `app_profiles`.

Consultas sugeridas:

```sql
select to_regclass('public.app_profiles') as app_profiles_regclass;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'app_profiles';

select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'app_profiles'
order by grantee, privilege_type;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'app_profiles'
order by policyname;
```

### 3. Pedido de aprovacao

Antes de aplicar, mostrar ao Rodrigo:

- arquivo exato da migration;
- resumo do que sera criado;
- confirmacao de que nenhuma tabela de negocio sera alterada;
- resultado das checagens remotas;
- rollback conceitual.

Pergunta obrigatoria:

```text
Rodrigo, posso aplicar a migration supabase/migrations/20260614120000_create_app_profiles.sql no Supabase de producao agora?
```

So prosseguir se a resposta for claramente positiva.

### 4. Aplicacao

Aplicar somente a migration alvo.

Se usar Supabase MCP, usar `apply_migration` com o conteudo exato do arquivo local e nome consistente com a migration.

Nao aplicar outras migrations junto.

### 5. Validacao pos-aplicacao

Depois de aplicar, rodar novamente as consultas de leitura da etapa 2.

Resultado esperado:

- `public.app_profiles` existe;
- RLS ligado;
- `force_rls` ligado;
- `anon` sem grants;
- `authenticated` com `SELECT`;
- policy `app_profiles_select_own` existe para `authenticated`;
- nenhuma linha em `app_profiles`, salvo se ja existia por acao externa;
- app atual continua dependendo de `app_users` e nao de `app_profiles`.

Consulta extra sugerida:

```sql
select count(*) as app_profiles_count
from public.app_profiles;
```

### 6. Validacao local

Como esta tarefa nao deve alterar frontend, rodar no minimo:

```bash
git diff --check
git status -sb
git diff --stat
```

Se algum arquivo de codigo for alterado por necessidade aprovada, rodar tambem:

```bash
npm test
npx tsc --noEmit
npm run build
```

## Rollback conceitual

Rollback so pode ser feito com nova aprovacao explicita do Rodrigo.

Se a migration quebrar algo inesperado, nao rodar `drop table` automaticamente. Reportar primeiro e propor um rollback pequeno, por exemplo:

```sql
drop table if exists public.app_profiles cascade;
drop function if exists public.set_app_profiles_updated_at();
```

Esse rollback so e aceitavel se `app_profiles` ainda nao tiver dados reais e se Rodrigo aprovar.

## Criterios de sucesso

- Migration aplicada uma unica vez, com aprovacao explicita.
- `app_profiles` existe com RLS forte e sem acesso anonimo.
- Nenhuma tabela de negocio foi alterada.
- `app_users` e login atual continuam intactos.
- Nenhum segredo foi lido, exibido ou versionado.
- Resultado documentado em portugues simples.

## Entrega

Nao fazer commit sem autorizacao.

Ao final, mostrar:

- aprovacao recebida antes da aplicacao;
- arquivos alterados;
- SQL/migration aplicada;
- resultado das consultas pos-aplicacao;
- validacoes executadas;
- `git status -sb`;
- `git diff --stat`;
- riscos e proximos passos.
