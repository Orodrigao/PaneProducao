# Regras de banco — Supabase, migrations e RLS

Regra de trabalho acionada pela tabela de gatilhos do `AGENTS.md`: leia antes de
tocar `supabase/` (migration, seed, teste de banco, configuração) ou de
consultar o banco de produção.
Vale tanto quanto o `AGENTS.md`; em conflito, vale o `AGENTS.md`.

## Banco em produção e bancos de teste

A Action `Banco (migrations)` é o único caminho do schema até produção.

- `supabase/migrations/` é a única história do schema. O marco zero é o
  baseline `20260722190516_remote_schema.sql` — foto fiel de produção em
  2026-07-22. O que veio antes está em
  `docs/history/migrations-pre-baseline/` e nunca é reaplicado.
- Migration viaja dentro do PR, junto do código que depende dela. O CI
  ensaia a história completa do schema num banco local descartável (workflow
  `CI Banco`); só depois do merge a Action aplica em produção com
  `supabase db push`.
- **Banco de teste por PR, no ar desde 2026-08-30 (PRs #287 a #291).** PR que
  mexe em `supabase/` ganha do Supabase um banco isolado, construído com as
  migrations e o seed fictício da própria branch. O workflow `Banco por PR`
  aponta o preview da Vercel para esse banco e manda refazer o deploy; o
  workflow `Usuarios do Banco por PR` cria nele as contas fictícias. Fechar a
  PR apaga o banco e as variáveis daquela branch. A regra de decisão vive em
  `scripts/preview-branch-env.mjs`, testada no `npm test` de toda PR.
- PR que não mexe em `supabase/` não ganha banco próprio e não precisa: segue
  no `PaneERP Preview` compartilhado, que espelha a `main`. Quem mantém esse
  espelho é o job `Restaurar Banco Preview para a main`, disparado a cada push
  na `main` e ao fechar PR sem merge. Nunca copie dados reais de produção para
  lá.
- **Não existe mais fila nem etiqueta:** duas PRs com migration convivem sem
  se atropelar. A etiqueta `precisa-banco-preview`, o job `Reconstruir Preview
  desta PR` e a espera dela no `ci.yml` foram removidos do código.
- O link da Vercel só vale para teste depois que a Vercel estiver verde. PR que
  mexe em `supabase/` espera também `Banco por PR` **e** `Usuarios do Banco por
  PR`: o primeiro aponta o preview para o banco certo, o segundo cria as contas
  fictícias lá dentro. Sem o segundo, o link abre num banco sem ninguém para
  logar.
- O ensaio descartável do `CI Banco` prova a história completa do schema, mas
  **não roda em toda PR**: ele só dispara quando a PR toca
  `supabase/migrations/`, `supabase/tests/`, `supabase/tests-local/`,
  `supabase/seed.sql`, `supabase/config.toml`, o verificador de repetição do
  seed (`scripts/verify-preview-seed-repeatability.mjs` e seu teste) ou o
  próprio `.github/workflows/ci-banco.yml` — a lista vale pelo que está no
  workflow. Quando dispara, é ele quem precisa estar verde. O
  banco por PR não o substitui, e o Docker que ele usa segue de pé; trocar esse
  ensaio precisa de prova própria.
- Site e banco atualizam de forma independente no mesmo merge. Toda
  migration precisa conviver tanto com a versão do site que está no ar
  quanto com a que está entrando. Mudança destrutiva (remover ou renomear
  coluna/tabela em uso) é sempre em duas fases, em PRs separados: primeiro
  o site para de usar, depois o banco remove.
- O projeto Supabase (`PanePedidosLojas`) é compartilhado com o sistema
  ControlePizza. Este repositório é o único dono da história de migrations
  do projeto — o baseline inclui os objetos do ControlePizza por isso.
  Nenhum outro repositório ou agente aplica schema neste banco; mudança
  para o ControlePizza entra por PR aqui, identificada como tal.
- Aplicar migration manualmente em produção — CLI local, MCP ou SQL Editor —
  é proibido, mesmo "só dessa vez". Foi exatamente isso que fez repo e banco
  contarem histórias diferentes até 2026-07-22.
- MCP do Supabase no desktop é ferramenta de leitura (consultar dados,
  conferir policies). Escrita de schema por MCP: nunca.
- Estado real do banco: `supabase migration list` (com o projeto linkado) ou
  auditoria live somente leitura — nunca deduzido de arquivo local.

Se o preview de uma PR sem migration falhar depois de um período sem uso,
confira primeiro se o projeto `PaneERP Preview` foi pausado antes de
investigar a funcionalidade.

## Migrations

- Criar com `supabase migration new <descricao>` (gera o timestamp correto).
  Nunca criar arquivo com timestamp anterior ao último já aplicado.
- A migration entra no mesmo PR do código que depende dela e é aplicada em
  produção pela Action após o merge (ver acima).
- Migration é só ida: correção de migration já mergeada é uma migration
  nova, nunca edição da antiga.

## Regras de schema e RLS

- Toda tabela em schema exposto deve ter RLS antes de receber dados.
- Grants da Data API e policies RLS são controles diferentes; migrations
  devem tratar ambos explicitamente.
- Não usar policy genérica permissiva para `anon` ou `authenticated`.
- Policies de escrita devem validar o perfil e o escopo da operação.
- `UPDATE` precisa de policy de leitura e de `WITH CHECK`.
- Função crítica precisa de validação de entrada, tratamento de erro e
  privilégio mínimo.
- `SECURITY DEFINER` exige revisão específica, `search_path` seguro e grants
  explícitos.
- Antes de nova informação financeira, concluir o hardening indicado em
  `docs/CURRENT_STATE.md`.
- Não deduza o estado de produção pelas migrations locais; tarefa de
  segurança compara migration, resultado documentado, código cliente e
  auditoria live somente leitura.
