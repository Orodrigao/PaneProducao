# 03 — Plano de usuários reais para app_profiles

## Objetivo

Definir como serão planejados os perfis reais do ERP antes de qualquer inserção no banco.

Esta tarefa é apenas documental. Ela não migra login, não cria usuários, não insere dados e não altera código.

## Contexto obrigatório

- `public.app_profiles` já foi criada no Supabase.
- A aplicação da migration foi documentada em `docs/SUPABASE_APP_PROFILES_APPLY_RESULT.md`.
- A tabela está vazia.
- O login atual ainda usa `app_users`/PIN/localStorage.
- Ainda não vamos migrar login.
- Ainda não vamos criar usuários no Supabase Auth.
- Ainda não vamos inserir dados reais em `app_profiles`.

## Escopo permitido

Pode:

- criar ou editar documentação em `docs/`;
- planejar pessoas, roles, lojas e escopos;
- descrever estratégias futuras de criação de profiles;
- listar critérios de aprovação antes de qualquer dado real;
- rodar validações locais de documentação.

## Proibido

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
- criar usuários reais;
- fazer commit sem autorização.

## Separação conceitual obrigatória

Antes de qualquer cadastro real, separar claramente os conceitos abaixo:

| Conceito | Exemplo |
|---|---|
| Usuário real | Rodrigo, Suélen, colaborador específico |
| Role | admin, financeiro, producao, compras, estoque, expedicao, vendas |
| Loja/local | jc, ex, ja, pj ou null/global |
| Setor | padaria, cozinha, loja, expedição, administrativo |

Reforço obrigatório: setor não é usuário.

Um usuário real é uma pessoa específica que acessará o ERP. Role é o tipo de permissão dessa pessoa. Loja/local indica o escopo principal de atuação. Setor descreve uma área operacional da empresa, mas não identifica uma pessoa e não deve ser usado como login, profile ou dono de sessão.

## Pessoas e perfis a definir

Preencher esta tabela somente após validação do Rodrigo. Os exemplos abaixo são fictícios e servem apenas para mostrar o formato esperado; não são dados reais e não devem ser inseridos no Supabase.

| Pessoa | Email futuro Supabase Auth | Role | Loja principal | Escopo | Observações |
|---|---|---|---|---|---|
| Exemplo Fictício 1 | exemplo.admin@pane.test | admin | null/global | Todas as lojas | Exemplo de perfil global. Não inserir. |
| Exemplo Fictício 2 | exemplo.producao@pane.test | producao | jc | Produção central | Exemplo de pessoa da produção. Não inserir. |
| Exemplo Fictício 3 | exemplo.vendas@pane.test | vendas | ex | Loja específica | Exemplo de pessoa de loja. Não inserir. |

Tabela limpa para decisão futura:

| Pessoa | Email futuro Supabase Auth | Role | Loja principal | Escopo | Observações |
|---|---|---|---|---|---|
| A definir | A definir | A definir | A definir | A definir | A definir |

## Roles iniciais sugeridas

Roles existentes:

- `admin`
- `financeiro`
- `producao`
- `compras`
- `estoque`
- `expedicao`
- `vendas`

Descrição inicial de acesso futuro:

| Role | Acesso futuro esperado |
|---|---|
| `admin` | Acesso geral ao ERP, gestão de permissões, cadastros críticos, relatórios e configurações. Deve ser restrita a poucas pessoas aprovadas. |
| `financeiro` | Contas, relatórios financeiros, clientes PJ, tabelas de preço, importações financeiras e análises de CMV quando existirem. |
| `producao` | Pedidos de produção, forno, fichas operacionais e registros ligados à produção diária. |
| `compras` | Listas de compra, fornecedores, cotações, entradas de compra e histórico de preços conforme o módulo evoluir. |
| `estoque` | Saldos, entradas, saídas, inventário, movimentações e conferências físicas de estoque. |
| `expedicao` | Romaneio, estoque congelado, separação, transferências e controles ligados ao canal PJ/expedição. |
| `vendas` | Operação de loja, registros de venda/importação quando aplicável, sobras, descartes e consultas operacionais da loja. |

Essas descrições são planejamento inicial. A autorização real deve ser traduzida em policies, validações e rotas em tarefa futura, sem depender apenas da UI.

## Lojas/escopo

Escopos conhecidos:

- `jc`
- `ex`
- `ja`
- `pj`
- `null/global`

Uso esperado:

| Loja/escopo | Quando usar |
|---|---|
| `jc` | Pessoa ou operação ligada principalmente à Júlio de Castilhos, incluindo produção centralizada quando o contexto for local. |
| `ex` | Pessoa ou operação ligada principalmente à loja Exposição. |
| `ja` | Pessoa ou operação ligada principalmente à loja Jardim América. |
| `pj` | Pessoa ou operação ligada principalmente ao canal PJ/expedição, quando fizer sentido separar do restante. |
| `null/global` | Rodrigo, financeiro, admin ou perfis que precisam enxergar mais de uma loja ou atuar de forma transversal. |

Usar loja específica quando a pessoa atua principalmente em um local e seus dados devem ser filtrados por esse local. Usar escopo global quando a pessoa precisa administrar, auditar, consolidar ou comparar dados de múltiplas lojas/canais.

## Critérios antes de inserir qualquer profile

Antes de inserir dados reais em `app_profiles`, exigir:

1. Lista aprovada de pessoas reais.
2. Email confirmado para cada pessoa.
3. Role aprovada.
4. Loja/escopo aprovado.
5. Decisão sobre quem será admin.
6. Estratégia de criação segura.
7. Rollback/documentação.
8. Confirmação de que o login atual não será alterado nessa etapa.

Sem esses critérios, o Codex deve parar e apenas reportar o que falta.

## Estratégias possíveis para criação futura

As opções abaixo são apenas planejamento. Não executar nenhuma delas nesta tarefa.

### 1. Migration controlada com dados mínimos

Descrição: criar uma migration versionada contendo somente profiles aprovados e mínimos.

Prós:

- fica versionada no Git;
- revisão por diff é simples;
- execução é reprodutível;
- rollback conceitual pode ser planejado junto.

Contras:

- dados pessoais entram no histórico do repositório;
- exige muito cuidado para não versionar emails ou nomes antes da aprovação;
- não é ideal para ajustes frequentes de equipe.

Riscos:

- inserir pessoa, role ou loja errada em produção;
- expor dados pessoais no Git;
- aplicar junto com outra migration por engano.

### 2. Script administrativo temporário

Descrição: criar um script local ou administrativo, revisado e removível, para inserir profiles aprovados.

Prós:

- evita deixar dados reais em migration permanente;
- permite validações antes da inserção;
- pode gerar logs locais da execução.

Contras:

- precisa de ambiente seguro para credenciais;
- aumenta risco operacional se o script for reutilizado sem revisão;
- deve ser removido ou isolado depois do uso.

Riscos:

- uso acidental contra o projeto errado;
- credenciais vazarem se forem colocadas no repositório;
- lógica divergente das constraints do banco.

### 3. Edge Function segura

Descrição: criar uma Edge Function protegida para administrar profiles com validações fortes.

Prós:

- centraliza validações no backend;
- pode exigir autenticação forte e auditoria;
- prepara base para administração futura sem acesso direto ao banco.

Contras:

- exige desenho de segurança mais completo;
- precisa de deploy e gestão de secrets;
- é mais complexo que a necessidade inicial.

Riscos:

- expor função administrativa indevidamente;
- falha de autorização permitir alteração de profiles;
- custo de manutenção maior antes do login real estar pronto.

### 4. Painel administrativo futuro

Descrição: construir uma tela de administração para admins criarem e alterarem profiles.

Prós:

- melhor caminho operacional de longo prazo;
- reduz dependência de SQL/manual;
- permite auditoria e confirmações na UI.

Contras:

- depende de login real e autorização segura;
- exige RLS/policies e fluxo de admin bem definidos;
- não deve vir antes da fundação de segurança.

Riscos:

- criar painel antes de proteger corretamente o banco;
- permitir que admin errado conceda permissões críticas;
- confundir `app_users` atual com `app_profiles` futuro.

## Ponto de parada obrigatório

O Codex deve parar antes de qualquer ação que:

- crie usuário no Supabase Auth;
- insira linha em `app_profiles`;
- altere login;
- altere `app_users`;
- altere código em `src/`;
- aplique migration;
- execute SQL remoto.

Só pode prosseguir com aprovação explícita do Rodrigo em tarefa futura.

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
- confirmação de que nenhum dado real foi inserido.

Não fazer commit sem autorização.
