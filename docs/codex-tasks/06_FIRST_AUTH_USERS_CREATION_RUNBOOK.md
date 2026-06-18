# 06 — Runbook da primeira leva de usuários Supabase Auth

## Objetivo

Documentar o procedimento seguro para a primeira criação futura de usuários Supabase Auth da Pane&Salute.

Esta tarefa é apenas documental. Ela não cria usuários, não insere linhas em `public.app_profiles`, não executa SQL, não usa Supabase MCP, não altera login, não altera `app_users` e não altera `src/`.

## Contexto obrigatório

- O app em produção ainda usa login custom por `app_users`/PIN/localStorage.
- Supabase Auth ainda não é usado pelo app.
- `public.app_profiles` já existe no Supabase.
- `public.app_profiles` está vazia.
- `public.app_profiles` está com RLS habilitado e forçado.
- `anon` não tem acesso a `app_profiles`.
- `authenticated` pode ler somente o próprio profile.
- `store` aceita somente `null`, `jc`, `ex` e `ja`.
- `null` representa escopo global.
- `PJ` é canal/tipo de pedido, não loja.
- A criação de usuários Auth e a inserção de profiles são etapas separadas.

## Fontes usadas

- `docs/APP_PROFILES_REAL_USERS_MATRIX.md`
- `docs/codex-tasks/04_APP_PROFILES_SAFE_CREATION_STRATEGY.md`
- `docs/codex-tasks/05_FIRST_AUTH_USERS_AND_PROFILES_PLAN.md`
- `docs/SUPABASE_APP_PROFILES_APPLY_RESULT.md`
- `docs/SUPABASE_REMOVE_PJ_STORE_APPLY_RESULT.md`
- `Lista-emails-usuarios.docx`, enviado por Rodrigo como referência de e-mails

## Decisões consideradas neste runbook

- Rodrigo informou que os usuários Geolar e Exposição estão definidos.
- Geolar será planejado com `producao1@paneesalute.com.br`.
- O usuário da Exposição será planejado com `producao2@paneesalute.com.br`.
- Antes de qualquer criação real, confirmar o `display_name` final do usuário da Exposição se o rótulo atual ainda for “Atendente EX”.
- `expedicao@paneesalute.com.br` permanece e-mail setorial, não usuário Auth individual nesta etapa.
- Nenhuma senha deve ser registrada em documento, chat, commit ou repositório.
- Nenhum profile deve ser criado antes de existir o UUID correspondente em `auth.users`.

## Primeira leva planejada

Esta lista serve para revisão e aprovação antes de qualquer criação real.

| Pessoa / usuário | E-mail Auth planejado | Role planejada | Store planejada | Observação |
| --- | --- | --- | --- | --- |
| Rodrigo | `rodrigao@gmail.com` | `admin` | `null` | Admin principal |
| Suélen | `dra.suelen.oliveira@gmail.com` | `admin` | `null` | Admin |
| Elis | `financeiro@paneesalute.com.br` | `financeiro` | `null` | Escopo global aprovado |
| Geolar | `producao1@paneesalute.com.br` | `producao` | `jc` | Definido por Rodrigo para planejamento |
| Sander | `forno@paneesalute.com.br` | `producao` | `jc` | Produção / forno |
| Fran | `cozinha@paneesalute.com.br` | `producao` | `jc` | Produção / cozinha |
| Brian | `expedicao1@paneesalute.com.br` | `expedicao` | `jc` | Expedição |
| Gustavo | `expedicao2@paneesalute.com.br` | `expedicao` | `jc` | Expedição |
| Liara | `atendiment@paneesalute.com.br` | `vendas` | `jc` | Atendimento JC |
| Samuca | `atendimento2@paneesalute.com.br` | `vendas` | `jc` | Atendimento JC |
| Cleo | `atendimento3@paneesalute.com.br` | `vendas` | `ja` | Atendimento JA |
| Usuário Exposição | `producao2@paneesalute.com.br` | `vendas` | `ex` | Confirmar `display_name` final antes da criação real |
| Marselle | `borges@paneesalute.com.br` | `vendas` | `ex` | Manter como `vendas`; não criar `gerente_loja` agora |

## Fora da primeira leva

| E-mail | Motivo |
| --- | --- |
| `expedicao@paneesalute.com.br` | E-mail setorial da expedição; não usar como login compartilhado nesta etapa |

## Método seguro recomendado

O método recomendado para a primeira criação real é separar em duas tarefas:

1. Criar somente usuários Supabase Auth.
2. Em outra tarefa, depois de registrar os UUIDs, criar os respectivos `app_profiles`.

Para a criação dos usuários Auth, escolher previamente um método aprovado por Rodrigo:

- Supabase Dashboard;
- Supabase Admin API;
- script administrativo controlado;
- outro método documentado e aprovado.

Não usar painel administrativo do ERP nesta fase. O painel só deve existir depois que Supabase Auth, RLS, auditoria e critérios de admin estiverem maduros.

## Passo a passo futuro — criação de usuários Auth

Não executar estes passos neste PR.

1. Confirmar com Rodrigo a lista final de usuários da primeira leva.
2. Confirmar que cada e-mail representa uma pessoa ou usuário operacional aprovado, sem compartilhamento indevido.
3. Definir se haverá convite por e-mail ou senha temporária.
4. Garantir que nenhuma senha será escrita em arquivo, chat, commit ou repositório.
5. Confirmar o projeto Supabase alvo: `PanePedidosLojas`, ref `gohluceldchoitihrimw`.
6. Criar os usuários Auth pelo método aprovado.
7. Registrar o resultado em documento próprio, sem secrets e sem senha.
8. Parar antes de inserir qualquer linha em `public.app_profiles`.

## Registro dos UUIDs

Após criar usuários Auth, registrar em uma etapa separada:

| E-mail | `auth.users.id` | `created_at` | Método usado | Observação |
| --- | --- | --- | --- | --- |
| A preencher após criação real | A preencher após criação real | A preencher após criação real | A preencher após criação real | Não registrar senha |

Regras:

- Não inventar UUID.
- Não criar profile sem UUID confirmado.
- Não registrar `SUPABASE_SERVICE_ROLE_KEY`, senha do banco, token ou senha temporária.
- Se algum usuário já existir, documentar o fato e capturar o UUID existente com método aprovado.

## Passo a passo futuro — criação de app_profiles

Não executar estes passos neste PR.

1. Revisar os UUIDs capturados em `auth.users`.
2. Revisar `display_name`, `role`, `store`, `active` e `allowed_routes`.
3. Criar plano ou diff separado para inserir profiles.
4. Pedir aprovação explícita de Rodrigo antes de qualquer SQL, migration, script ou MCP de escrita.
5. Inserir profiles apenas para usuários Auth já existentes.
6. Validar que cada usuário autenticado só lê o próprio profile.
7. Documentar resultado e rollback conceitual.

## Pontos de parada obrigatórios

Antes de qualquer uma das ações abaixo, o Codex deve parar e pedir aprovação explícita:

- criar usuário no Supabase Auth;
- enviar convite de Auth;
- definir senha temporária;
- inserir profile em `public.app_profiles`;
- executar SQL;
- aplicar migration;
- usar Supabase MCP de escrita;
- usar `psql`;
- rodar `supabase db push`;
- rodar `supabase migration up`;
- alterar `.env`, secrets, tokens ou chaves;
- alterar login;
- mexer em `app_users`;
- alterar `src/`;
- alterar RLS ou policies.

Modelo obrigatório de pergunta:

```text
Rodrigo, posso executar esta ação agora? Ela vai alterar [descrever exatamente o que será alterado]. Confirma?
```

Respostas como “pode ver”, “analisa”, “testa” ou “confere” não autorizam escrita.

## O que este runbook não faz

- Não cria usuários Supabase Auth.
- Não insere `app_profiles`.
- Não altera o login atual.
- Não mexe em `app_users`.
- Não altera permissões ativas no frontend.
- Não altera `src/`.
- Não executa SQL.
- Não aplica migration.
- Não usa Supabase MCP.
- Não lê nem altera secrets.
- Não dispara convite ou e-mail.

## Validação deste PR documental

Como esta tarefa é apenas documentação, validar com:

```bash
git diff --check
git status -sb
git diff --stat
```

Não rodar Supabase CLI, SQL, MCP, `psql`, `supabase db push` ou `supabase migration up` nesta tarefa.
