# 01 — Supabase Auth Profiles Foundation

## Objetivo

Criar a fundação para perfis reais de usuários no Supabase, usando `app_profiles` em paralelo ao `app_users`.

Esta tarefa prepara o caminho para Auth/RLS real, mas não altera o login atual e não mexe nas tabelas de negócio.

## Regra importante

Setores não são usuários.

Separar:

| Conceito | Exemplo |
|---|---|
| Usuário real | Rodrigo, Suélen, Elis, Geolar, Fran, Gustavo |
| Role/perfil | admin, financeiro, producao, compras, estoque, expedicao, vendas |
| Setor | padaria, cozinha, loja, expedicao, administrativo |
| Loja/local | jc, ex, ja, pj |

## Escopo permitido

Pode:

- criar uma migration para a tabela `app_profiles`;
- criar documentação curta, se necessário;
- preparar estrutura para vínculo futuro com `auth.users`;
- criar RLS somente para `app_profiles`;
- criar constraints básicas de role/store;
- rodar validações locais;
- mostrar `git status -sb` e `git diff --stat`.

## Proibido

Não pode:

- alterar o login atual;
- apagar ou modificar `app_users`;
- criar usuários reais;
- criar seed com nomes reais;
- mexer em `products`, `stock_*`, `customers`, `sobras`, `descartes` ou outras tabelas de negócio;
- aplicar RLS em tabelas de negócio;
- executar SQL diretamente em produção;
- alterar `.env`;
- alterar `package.json` ou `package-lock.json`;
- alterar `src/` sem autorização explícita;
- commitar sem autorização.

## Modelo conceitual de `app_profiles`

Campos esperados:

| Campo | Tipo conceitual | Observação |
|---|---|---|
| `user_id` | uuid | vínculo futuro com `auth.users.id` |
| `display_name` | text | nome exibido no ERP |
| `role` | text | papel operacional |
| `store` | text/null | loja principal ou null para escopo global |
| `active` | boolean | bloqueia acesso sem apagar histórico |
| `allowed_routes` | jsonb/null | apoio para UI, não substitui RLS |
| `created_at` | timestamptz | auditoria |
| `updated_at` | timestamptz | auditoria |

## Roles permitidas

```text
admin
financeiro
producao
compras
estoque
expedicao
vendas
```

## Stores permitidas

```text
jc
ex
ja
pj
null
```

## Regras de segurança

- `service_role` nunca pode ir para o frontend.
- Não depender de `user_metadata` editável para autorização.
- Usuário autenticado pode ler o próprio profile.
- Admin poderá gerenciar profiles em etapa futura.
- Nenhum usuário anônimo deve ler profiles.
- PIN não deve ser armazenado em claro em `app_profiles`.
- `allowed_routes` ajuda a UI, mas RLS deve proteger o banco.

## Resultado esperado

Criar uma migration segura e isolada para `app_profiles`, sem afetar a operação atual.

O app deve continuar funcionando como antes após essa tarefa.

## Validação

Ao final, rodar:

```bash
git status -sb
git diff --stat
```

Se houver código/migration, rodar também:

```bash
npm test
npx tsc --noEmit
npm run build
```

## Entrega

Não fazer commit sem autorização.

Mostrar:

- arquivos criados;
- arquivos alterados;
- riscos;
- validações executadas;
- próximos passos.
