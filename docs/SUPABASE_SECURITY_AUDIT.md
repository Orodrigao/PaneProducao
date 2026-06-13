# SUPABASE_SECURITY_AUDIT.md - Auditoria de Seguranca Supabase

**Data:** 2026-06-13
**Escopo:** Sprint 0 - documentacao e plano seguro de correcao
**Status:** auditoria local/documental, sem alteracao de banco, codigo, env, Edge Function ou deploy

## 1. Objetivo da auditoria

Esta auditoria existe para proteger o caminho ate o CMV confiavel da Pane&Salute.

O ERP roda como app estatico, acessa o Supabase diretamente do frontend com chave publica e ainda usa autenticacao custom por PIN/localStorage. Antes de importar XML de compras, vendas CNM, ficha tecnica versionada ou dados financeiros sensiveis, e obrigatorio entender e corrigir os riscos de RLS, policies, autenticacao e Edge Functions.

Objetivos praticos:

- registrar o estado conhecido de seguranca do Supabase a partir dos arquivos locais;
- separar risco confirmado localmente de risco que ainda precisa de inventario live no Supabase;
- definir uma sequencia segura de correcao, sem quebrar a operacao atual;
- impedir entrada de dados financeiros sensiveis antes da protecao minima.

## 2. Fontes e limites desta auditoria

Fontes lidas nesta tarefa:

- `AGENTS.md`, `README.md`, `CLAUDE.md`;
- `docs/PRD.md`, `docs/PLAN.md`, `docs/TASKS.md`;
- `docs/CODEX_PROJECT_COMMAND.md`, `docs/CODEX_FIRST_TASK_PROMPT.md`;
- `docs/CMV_EXECUTION_PLAN.md`, `docs/SALES_IMPORT_CNM.md`, `docs/DESIGN_AUDIT.md`;
- `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/database.types.ts`;
- chamadas locais a Supabase REST, `supabase-js` e Edge Functions;
- `supabase/functions/parse-cotacao/index.ts`.

Limites intencionais:

- nao houve conexao com Supabase remoto;
- nao houve `SELECT` live de `pg_policies`, `pg_tables`, grants ou configuracao de Edge Functions;
- nao houve leitura de `.env.local`;
- nao houve SQL de escrita, migration, deploy, alteracao de codigo ou alteracao de secrets.

Portanto, este documento nao substitui a Fase A de inventario live. Ele define o plano para fazer essa etapa com seguranca.

## 3. Estado atual de seguranca conhecido

### Arquitetura

- O app usa Next.js com `output: 'export'`, sem API routes, middleware ou SSR.
- O frontend acessa o Supabase diretamente usando `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `src/lib/supabase.ts` cria um client Supabase unico com a chave publica.
- Parte do app tambem usa `fetch` direto para PostgREST com `apikey` e `Authorization: Bearer <anon>`.

### Autenticacao e autorizacao

- Supabase Auth ainda nao e usado.
- A autenticacao atual fica em `src/lib/auth.ts`.
- Usuarios sao carregados de `app_users` via REST no navegador.
- A sessao e somente o id do usuario salvo em `localStorage`.
- O PIN e usado no cliente, e o cache local guarda usuarios.
- Ha usuarios/PINs de fallback versionados no codigo. Isso reduz resiliencia operacional, mas aumenta risco se o repo/bundle for acessado por pessoa indevida.
- A autorizacao por rota (`allowedRoutes`) protege a UI, mas nao protege os dados no banco se RLS/policies permitirem acesso anonimo.

### RLS e policies

Estado conhecido pelos docs do projeto:

- existem tabelas publicas com RLS desligado e policies permissivas;
- `PLAN.md` e `TASKS.md` citam `anon_all` como policy atual/legada em partes do sistema;
- o app depende de acesso anonimo para varios modulos por ainda nao usar Supabase Auth.

Estado ainda nao confirmado nesta tarefa:

- quais tabelas estao com RLS ligado/desligado;
- quais policies existem em cada tabela;
- quais roles (`anon`, `authenticated`, `service_role`) tem permissao por tabela;
- se existe `force row level security`;
- se existem funcoes `security definer` expostas.

### Inventario local de tabelas

`src/lib/database.types.ts` indica as seguintes tabelas no schema usado pelo app:

- Acesso: `app_users`.
- Catalogo/produtos: `products`, `breads`, `product_components`, `product_prices`, `product_production`, `destinations`.
- Producao e lojas: `orders`, `production_actuals`, `bread_movements`.
- Sobras, descartes e prateleira: `sobras`, `descartes`, `shelf_counts`.
- Estoque congelado: `frozen_products`, `frozen_stock`, `frozen_movements`.
- Estoque de insumos: `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements`.
- Compras/cotacoes: `purchase_lists`, `purchase_items`, `suppliers`, `supplier_products`, `quotations`, `quotation_items`, `quotation_suppliers`, `quotation_responses`, `supplier_orders`, `supplier_order_items`.
- Clientes/PJ/precos: `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides`.
- Romaneio: `romaneios`, `romaneio_items`.

Como o app e estatico e usa chave publica, toda tabela acima deve ser tratada como exposta ate prova em contrario via RLS/policies.

### Edge Functions

Estado local:

- `parse-cotacao` esta versionada em `supabase/functions/parse-cotacao/index.ts`.
- `parse-cotacao` usa `GEMINI_API_KEY` via secret do Supabase, aceita `POST`, habilita CORS amplo e e chamada pelo frontend com chave anon.
- `analisar-desconto` e chamada por `src/app/simulador-desconto/page.tsx`, mas o codigo da function nao aparece versionado em `supabase/functions/`.
- `CLAUDE.md` cita `analisar-desconto` e `parse-cotacao` como Edge Functions existentes.

Risco informado no escopo da Sprint 0:

- `analisar-desconto` esta com `verify_jwt=false`.

Ponto critico: function com custo de IA e `verify_jwt=false` pode ser chamada fora do ERP por qualquer pessoa que descubra a URL, especialmente se tambem aceitar CORS amplo e chave anon publica.

## 4. Riscos principais

### RLS desligado em tabelas publicas

Se RLS estiver desligado em tabela exposta pelo PostgREST, a chave anon pode ler ou escrever conforme grants/policies. Como o frontend publica a chave, qualquer pessoa com acesso ao bundle pode tentar chamadas diretas ao Supabase.

Impacto:

- leitura de dados operacionais, clientes, precos, fornecedores e custos;
- alteracao direta de registros fora da UI;
- contaminacao de dados usados depois no CMV.

### Policies anon permissivas

Policies do tipo `anon_all` ou equivalentes mantem o app funcionando sem Supabase Auth, mas transferem a seguranca para o frontend. Isso nao e suficiente para dados financeiros.

Impacto:

- qualquer usuario anonimo pode executar a acao permitida pela policy;
- roles locais (`admin`, `compras`, `financeiro`) nao tem valor no banco;
- bloqueios por tela podem ser contornados com chamadas REST.

### `app_users` exposta

`src/lib/auth.ts` faz `select=*` em `app_users` pelo navegador e tambem contem funcoes de criacao/atualizacao dessa tabela usando a chave publica.

Impacto:

- exposicao de nomes, roles, rotas, lojas e PINs se a policy permitir leitura anonima;
- alteracao de PIN, role, status ou rotas se a policy permitir escrita anonima;
- tomada de acesso no proprio app;
- impossibilidade de confiar nos logs de usuario enquanto a identidade for client-side.

### Auth por PIN/localStorage

O modelo atual serve para controle operacional simples, mas nao para proteger dados sensiveis.

Impacto:

- PIN e segredo fraco e curto;
- sessao em `localStorage` pode ser manipulada no navegador;
- autorizacao por rota nao impede chamada direta ao banco;
- nao ha identidade forte para policies RLS por usuario.

### Edge Function `analisar-desconto` com `verify_jwt=false`

Essa function e chamada por uma tela de simulacao com IA. Pelo escopo informado, ela esta sem verificacao JWT.

Impacto:

- consumo indevido de creditos/custo de IA;
- abuso por chamadas externas;
- falta de rastreabilidade confiavel por usuario;
- maior risco se a function aceitar payload grande ou sem rate limit.

### Dados financeiros futuros antes de seguranca real

O roadmap preve XML de compras, historico de precos, ficha tecnica, vendas CNM, sobras com custo, CMV e dashboard financeiro. Esses dados tornam o banco muito mais sensivel.

Impacto:

- vazamento de margem, fornecedores, clientes PJ, precos e custos;
- CMV calculado sobre dados alterados indevidamente;
- decisao gerencial baseada em dado contaminado;
- dependencia maior do Rodrigo para corrigir danos manualmente.

## 5. Matriz de risco por area

| Area | Evidencia local | Risco | Severidade | Acao segura |
| --- | --- | --- | --- | --- |
| Autenticacao e `app_users` | `src/lib/auth.ts` le/escreve `app_users` via REST com chave anon; sessao fica em `localStorage`; fallback de PINs existe no codigo | Exposicao ou alteracao de usuarios, PINs, roles e rotas; acesso administrativo contornavel | Critica | Congelar mudancas em usuarios; inventariar policies; remover leitura/escrita anonima; desenhar Supabase Auth/perfis antes de novos dados sensiveis |
| RLS/policies publicas | Docs citam RLS desligado, policies permissivas e `anon_all` | Acesso direto ao banco fora da UI | Critica | Fazer inventario tabela por tabela; classificar sensibilidade; migrar para deny-by-default com policies por role/loja |
| Dados financeiros e CMV | Tabelas de estoque, fornecedores, clientes, precos, pedidos PJ e movimentos ja existem | Vazamento/alteracao de custos, precos, clientes, compras e base futura do CMV | Alta | Nao importar novos dados financeiros antes da protecao minima; priorizar RLS para estoque, compras, clientes e precos |
| Compras e cotacoes | `purchase_*`, `supplier_*`, `quotation_*` sao usados direto do frontend | Manipulacao de lista, cotacao, fornecedor, resposta ou pedido de compra | Alta | Policies por papel (`compras`, `financeiro`, `admin`) e transacoes para fechamento/geracao de pedidos |
| Producao, sobras e romaneio | `orders`, `sobras`, `descartes`, `romaneios`, `bread_movements` sao gravados do frontend | Alteracao de producao, perdas e movimentos que alimentam custo/perdas | Alta | Policies por loja/papel; validar escrita por modulo; logs de alteracao para eventos criticos |
| Estoque de insumos | `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements` sao gravados em multiplas chamadas do frontend | Inconsistencia ou fraude em saldo/custo medio | Alta | Depois do RLS, mover operacoes criticas para RPC/Edge transacional com validacao e logs |
| Clientes PJ e tabelas de preco | `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides` sao acessados do frontend | Exposicao de clientes, descontos e precos negociados | Alta | Restringir leitura/escrita a `admin`/`financeiro`; auditar overrides e alteracoes de preco |
| Edge Functions de IA | `parse-cotacao` versionada; `analisar-desconto` chamada mas nao versionada localmente; risco informado de `verify_jwt=false` | Custo indevido, abuso externo, falta de identidade e limite | Alta | Inventariar functions deployadas; versionar fonte; exigir JWT quando houver Auth; enquanto isso, limitar payload/custo e considerar desabilitar o que nao for essencial |
| Segredos e variaveis | Projeto usa `NEXT_PUBLIC_*`; secrets de IA devem ficar no Supabase; `.env.local` nao foi lida | Chave publica e esperada; segredo privado no client seria incidente | Alta | Auditar repo por secrets; manter service role e senhas fora do repo; rotacionar qualquer segredo que tenha sido exposto |
| Auditoria/logs | Nao ha evidencia local de trilha padronizada para alteracoes sensiveis | Dificuldade de saber quem alterou custo, saldo, preco, usuario ou pedido | Media | Criar estrategia de logs por operacao critica depois de Auth; registrar usuario real, data, origem e payload validado |

## 6. Plano de correcao em fases

### Fase A: documentacao e inventario

Objetivo: saber exatamente o que esta exposto antes de corrigir.

Entregas:

- inventario de tabelas publicas, RLS, force RLS e policies;
- inventario de grants por tabela;
- inventario de functions deployadas e configuracao de JWT;
- inventario de funcoes SQL, especialmente `security definer`;
- matriz tabela/RLS/policy/risco/acao;
- lista de modulos que quebrariam se `anon_all` fosse removida hoje.

Consultas esperadas, somente apos autorizacao para auditoria read-only no Supabase:

```sql
select
  schemaname,
  tablename,
  rowsecurity,
  forcerowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

```sql
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
order by tablename, policyname;
```

```sql
select
  routine_schema,
  routine_name,
  security_type
from information_schema.routines
where routine_schema = 'public'
order by routine_name;
```

Nao fazer nesta fase:

- nao aplicar migration;
- nao alterar `app_users`;
- nao trocar auth;
- nao remover policy em producao;
- nao deployar Edge Function.

### Fase B: proteger funcoes e segredos

Objetivo: reduzir risco de abuso externo e vazamento antes de mexer no modelo completo de auth/RLS.

Entregas:

- confirmar lista real de Edge Functions deployadas;
- confirmar se `analisar-desconto` esta com `verify_jwt=false`;
- trazer o codigo de `analisar-desconto` para o repo ou documentar por que sera removida/desativada;
- revisar CORS, metodo permitido, tamanho maximo de payload, validacao de entrada e mensagens de erro;
- garantir que secrets de IA ficam somente em Supabase Edge Functions Secrets;
- revisar custo/limite no provedor de IA usado pelas functions;
- decidir se functions de IA ficam temporariamente desabilitadas ate Auth real.

Observacao: enquanto o app nao usa Supabase Auth, `verify_jwt=true` pode quebrar chamadas existentes. Por isso, a decisao segura nao e simplesmente ligar JWT em producao sem plano. Para function com custo de IA, a opcao mais segura pode ser desativar temporariamente ou limitar fortemente ate a Fase C.

### Fase C: desenhar auth/RLS real

Objetivo: substituir autorizacao client-side por identidade confiavel no banco.

Decisoes que precisam ser aprovadas antes de implementar:

- usar Supabase Auth como fonte de identidade;
- separar perfil/role/loja em uma tabela propria, por exemplo `app_profiles`, sem expor PIN;
- mapear roles atuais (`admin`, `financeiro`, `compras`, `producao`, `estoque`, `romaneio`, `expedicao`) para policies de banco;
- definir escopo por loja quando aplicavel (`jc`, `ja`, `ex`, `pj`);
- decidir transicao dos usuarios atuais sem quebrar operacao das lojas;
- decidir se o PIN continua apenas como UX local complementar ou se sera removido.

Resultado esperado:

- modelo de identidade aprovado;
- policies desenhadas antes de serem aplicadas;
- plano de migracao com rollback;
- nenhuma dependencia de `localStorage` para permitir acesso a dado sensivel.

### Fase D: aplicar RLS com baixo risco

Objetivo: ativar protecao real sem paralisar a operacao.

Sequencia sugerida:

1. Criar migrations pequenas e revisaveis, nunca SQL solto em producao.
2. Comecar por tabelas menos criticas para validar padrao.
3. Proteger `app_users`/perfil antes de qualquer dado financeiro novo.
4. Proteger tabelas financeiras e de custo antes de XML, CNM e ficha tecnica.
5. Aplicar policies por modulo e papel, com `with check` para escrita.
6. Evitar policies amplas para `anon`; se uma policy anon temporaria for inevitavel, registrar prazo e motivo.
7. Testar cada modulo depois de cada grupo de policies.

Prioridade de aplicacao:

- `app_users` e tabelas de perfil/acesso;
- `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides`;
- `suppliers`, `supplier_products`, `quotation_*`, `supplier_order_*`;
- `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements`;
- `orders`, `sobras`, `descartes`, `romaneios`, `bread_movements`;
- catalogos compartilhados (`products`, `breads`, `product_components`) com leitura controlada e escrita restrita.

### Fase E: validar modulo por modulo

Objetivo: provar que a seguranca foi aplicada e que o app continua funcionando para cada perfil.

Validacoes minimas:

- usuario sem login nao acessa dados protegidos;
- usuario de uma role nao executa acao de outra role;
- usuario de loja nao acessa/escreve dados de outra loja quando houver escopo de loja;
- admin/financeiro continuam com acesso necessario;
- chamadas REST diretas com anon sao negadas nas tabelas sensiveis;
- Edge Functions rejeitam chamadas sem credencial adequada ou fora do formato esperado;
- operacoes criticas geram log suficiente para auditoria.

Modulos para smoke test:

- login e navegacao por role;
- admin de usuarios;
- compras/cotacoes;
- estoque de insumos;
- clientes/PJ/tabelas de preco;
- producao/forno;
- sobras/descartes;
- romaneio;
- relatorios.

## 7. O que nao deve ser feito agora

- Nao criar dashboard de CMV antes de ficha tecnica, vendas CNM e seguranca minima.
- Nao importar XML real, venda CNM real ou dados financeiros sensiveis antes da Sprint 0.
- Nao mexer em `app_users`, PINs, roles ou rotas sem plano e aprovacao explicita.
- Nao aplicar SQL de escrita em producao sem diff, plano, rollback e aprovacao.
- Nao criar migrations de RLS grandes misturando varias areas sem revisao.
- Nao manter `anon_all` como solucao definitiva.
- Nao esconder inseguranca no frontend com mais checagens de UI; RLS precisa proteger o banco.
- Nao colocar service role, senha do banco, token de IA ou qualquer segredo em `NEXT_PUBLIC_*`.
- Nao deployar Edge Function manualmente nesta sprint documental.
- Nao adicionar dados reais de exemplo no repo; usar apenas fixtures anonimizadas quando necessario.
- Nao fazer redesign, DRE completo, automacao pesada de WhatsApp ou IA explicando CMV antes da base segura.

## 8. Criterios para liberar a proxima sprint

A proxima sprint de CMV so deve ser liberada quando estes criterios forem atendidos:

- inventario live de RLS/policies/grants concluido e documentado;
- cada tabela publica classificada por sensibilidade, modulo, dono e acao corretiva;
- `app_users` ou sua substituta protegida contra leitura/escrita anonima;
- modelo de Supabase Auth/perfis/roles aprovado pelo Rodrigo;
- Edge Functions inventariadas, com decisao explicita para `analisar-desconto` e `parse-cotacao`;
- nenhuma function com custo de IA exposta sem controle aceitavel;
- plano de migrations pequenas aprovado, com ordem de aplicacao e rollback;
- criterios de teste por role e por modulo definidos;
- confirmado que novos dados financeiros sensiveis nao entrarao antes da protecao minima;
- Rodrigo entende, em portugues simples, quais riscos foram aceitos temporariamente e por quanto tempo.

## 9. Proximo PR recomendado

Criar um PR pequeno de inventario live, ainda sem correcao de schema:

- executar apenas consultas `SELECT` de auditoria no Supabase;
- preencher uma matriz tabela/RLS/policies/risco/acao;
- listar Edge Functions deployadas e status de `verify_jwt`;
- apontar exatamente quais modulos quebram se o acesso anonimo for removido hoje.

Somente depois desse inventario deve nascer o primeiro PR de correcao real de RLS/Auth.
