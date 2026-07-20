# 05 — Plano da primeira leva de usuários Auth e profiles

## Objetivo

Planejar a primeira criação futura de usuários Supabase Auth e profiles em `public.app_profiles`, sem executar nada nesta tarefa.

Esta tarefa é apenas documental. Não criar usuários, não inserir profiles e não alterar login.

## Contexto obrigatório

- `public.app_profiles` já existe no Supabase.
- `app_profiles` está vazia.
- RLS está habilitado e forçado.
- `anon` não tem acesso.
- `authenticated` só pode ler o próprio profile.
- `store` aceita apenas `null`, `jc`, `ex`, `ja`.
- `null` representa escopo global.
- `PJ` é canal/tipo de pedido, não loja.
- O login atual ainda usa `app_users`/PIN/localStorage.
- Ainda não vamos migrar o login.
- A matriz está em `docs/APP_PROFILES_REAL_USERS_MATRIX.md`.
- A estratégia segura está em `docs/codex-tasks/04_APP_PROFILES_SAFE_CREATION_STRATEGY.md`.

## Pessoas com e-mail confirmado

| Pessoa   | E-mail                                                                | Role planejada | Store planejada | Observações                                                    |
| -------- | --------------------------------------------------------------------- | -------------- | --------------- | -------------------------------------------------------------- |
| Rodrigo  | [rodrigao@gmail.com](mailto:rodrigao@gmail.com)                       | admin          | null/global     | Admin principal                                                |
| Suélen   | [dra.suelen.oliveira@gmail.com](mailto:dra.suelen.oliveira@gmail.com) | admin          | null/global     | Admin                                                          |
| Elis     | [financeiro@paneesalute.com.br](mailto:financeiro@paneesalute.com.br) | financeiro     | null/global     | Escopo global aprovado                                         |
| Brian    | [expedicao1pane@gmail.com](mailto:expedicao1pane@gmail.com)           | expedicao      | jc              | Expedição; acesso a romaneio, congelados, estoque e Pedidos PJ |
| Gustavo  | [expedicao2pane@gmail.com](mailto:expedicao2pane@gmail.com)           | expedicao      | jc              | Expedição; acesso a romaneio, congelados e Pedidos PJ          |
| Marselle | [borges@paneesalute.com.br](mailto:borges@paneesalute.com.br)         | vendas         | ex              | Gerente EX; manter como vendas por enquanto                    |

`null/global` significa `store = null` em `public.app_profiles`. Esse valor representa escopo global, não ausência de permissão.

## Pessoas ainda pendentes

Pessoas pendentes, sem bloquear a primeira leva:

- Geolar;
- Sander;
- Fran;
- Liara;
- Samuca;
- Cleo;
- pessoa real do Atendimento EX.

Essas pessoas ficam para etapa futura porque ainda não têm e-mail confirmado ou ainda precisam ser definidas. Atendimento EX não deve ser criado como usuário compartilhado; deve ser substituído por uma pessoa real com e-mail próprio.

## Sequência futura segura

Planejar, sem executar:

1. Confirmar novamente a lista final com Rodrigo.
2. Criar usuários no Supabase Auth em tarefa separada.
3. Não definir senha em texto aberto.
4. Não versionar senha, token ou secret.
5. Coletar os `auth.users.id` gerados.
6. Criar profiles em `public.app_profiles` vinculando cada `user_id`.
7. Validar que cada usuário autenticado só lê o próprio profile.
8. Não alterar login atual.
9. Documentar resultado.

## Relação entre Auth e app_profiles

- `auth.users` identifica o usuário real no Supabase Auth.
- `public.app_profiles.user_id` referencia `auth.users.id`.
- Não dá para inserir profile válido sem usuário Auth correspondente.
- O profile não deve armazenar senha, PIN ou segredo.
- `role`, `store`, `active` e `allowed_routes` são dados de autorização/apoio operacional.

## Estratégia recomendada para a primeira leva

- Não usar painel administrativo ainda.
- Não usar usuário compartilhado.
- Não criar roles novas agora.
- Criar somente usuários com e-mail confirmado.
- Criar usuários Auth em tarefa própria.
- Criar profiles em tarefa posterior, depois de obter os UUIDs.
- Manter login atual funcionando em paralelo.
- Não migrar telas nem permissões de negócio ainda.

## Riscos

- Criar usuário com e-mail errado.
- Criar profile antes do usuário Auth existir.
- Criar admin demais.
- Confundir `store = null` com ausência de permissão.
- Confundir PJ com loja.
- Alterar login cedo demais.
- Versionar dados sensíveis.
- Usar service_role no frontend.

## Ponto de parada obrigatório

O Codex deve parar antes de qualquer ação que:

- crie usuário no Supabase Auth;
- insira profile em `app_profiles`;
- execute SQL;
- use Supabase MCP;
- aplique migration;
- altere login;
- altere `app_users`;
- altere `src/`;
- leia ou altere secrets.

Só prosseguir com aprovação explícita do Rodrigo em tarefa futura.

## Escopo permitido nesta tarefa

Pode:

- criar ou editar documentação em `docs/`;
- atualizar `docs/codex-tasks/README.md`;
- rodar validações locais de documentação.

Não pode:

- executar Supabase MCP;
- executar SQL;
- executar `supabase db push`;
- executar `supabase migration up`;
- executar `psql`;
- alterar `.env`;
- alterar `src/`;
- alterar migrations;
- alterar `app_users`;
- inserir dados em `app_profiles`;
- criar usuários no Supabase Auth;
- alterar login;
- fazer commit sem autorização.

## Validação local

Como esta tarefa é apenas documentação, rodar no mínimo:

```bash
git diff --check
git status -sb
git diff --stat
```

Não rodar Supabase MCP, SQL, `supabase db push`, `supabase migration up` ou `psql`.

## Entrega esperada

Ao final, mostrar:

- arquivos criados;
- arquivos alterados;
- `git status -sb`;
- `git diff --stat`;
- confirmação de que nenhuma ação remota foi executada;
- confirmação de que nenhum usuário foi criado;
- confirmação de que nenhum profile foi inserido;
- confirmação de que o login atual não foi alterado.

Não fazer commit sem autorização.
