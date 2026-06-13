# AGENTS.md — PaneProducao / Pane&Salute ERP

## Identidade do projeto

Este repositório é o ERP interno da Pane&Salute, padaria artesanal premium de Caxias do Sul com três lojas confirmadas:

- Júlio de Castilhos — produção centralizada e loja.
- Exposição — loja atendida por produção da Júlio.
- Jardim América — loja atendida por produção da Júlio.

Dono do produto: Rodrigo Gomes.

Pergunta central do ERP:

> Para onde vai o dinheiro da Pane&Salute?

Prioridade estratégica atual:

1. Chegar ao CMV teórico confiável.
2. Evoluir para CMV real por família de insumo/produto.
3. Reduzir sobras e erros de produção.
4. Organizar compras e histórico de preços.
5. Reduzir dependência operacional do Rodrigo.

## Stack atual

- Next.js 15 App Router.
- React 19.
- TypeScript strict.
- Supabase/Postgres.
- Vercel.
- `output: 'export'`: app estático, sem API routes, sem middleware e sem SSR.
- Supabase Auth ainda não é usado; existe auth custom por PIN/localStorage.

## Arquivos que devem ser lidos antes de qualquer tarefa

Antes de editar qualquer arquivo, leia:

1. `README.md`
2. `CLAUDE.md` — legado útil; não é mais o comando principal, mas contém decisões históricas.
3. `docs/PRD.md`
4. `docs/PLAN.md`
5. `docs/TASKS.md`
6. `docs/CODEX_PROJECT_COMMAND.md`, se existir.
7. `docs/CMV_EXECUTION_PLAN.md`, se existir.
8. `docs/SALES_IMPORT_CNM.md`, se existir.
9. `docs/DESIGN_AUDIT.md`, se existir.

Depois disso, resuma em 5 a 10 linhas o que entendeu antes de propor mudança.

## Regras de segurança — obrigatórias

Nunca faça sem aprovação explícita do Rodrigo:

- `git push` direto na `main`.
- `git reset --hard`.
- `git push --force`.
- `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `ALTER`, `INSERT` ou `apply_migration` em Supabase de produção.
- Mudança em `app_users`, PINs, roles ou rotas de login.
- Deploy manual de Edge Function.
- Alteração de `.env`, segredos, tokens ou chaves.
- Introdução de dependência nova de produção.

Nunca coloque no repositório:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD`
- tokens do GitHub, Vercel, Supabase, Telegram, WhatsApp ou OpenAI
- certificado digital
- exports reais do CNM com dados sensíveis
- XML real sem anonimização

Se precisar de dados de exemplo, crie fixtures anonimizadas em `test/fixtures/` ou `docs/examples/`.

## Supabase

O projeto usa Supabase diretamente no frontend com chave pública. Isso exige cuidado máximo com RLS.

Regra atual:

- Pode executar SELECTs de auditoria quando autorizado.
- Não aplique SQL de escrita diretamente em produção sem plano, diff e aprovação.
- Toda tabela nova em schema exposto deve ter RLS antes de receber dados.
- Toda função transacional crítica deve ter validação de entrada e log de erro.
- Funções `security definer` não devem ficar expostas sem revisão.

Problema conhecido:

- Existem tabelas públicas com RLS desligado e policies permissivas. Tratar segurança como Sprint 0 antes de colocar dados financeiros sensíveis.

## Roadmap técnico obrigatório

Ordem correta para chegar ao CMV:

1. Segurança Supabase/Auth.
2. Auditoria RLS/policies.
3. Importação XML de compras.
4. Unidade de medida e conversões.
5. Entrada de estoque transacional.
6. Ficha técnica versionada.
7. Importação de vendas CNM.
8. Sobras/descartes com loja, motivo e custo estimado.
9. Registro de ruptura.
10. CMV teórico.
11. CMV real por família.
12. Dashboard do Rodrigo.
13. IA explicando variações e sugerindo ações.

Não criar dashboard de CMV antes de ficha técnica e vendas CNM.

## Git workflow

- Branch por tarefa: `codex/<descricao-curta>`.
- PR sempre em modo draft, salvo pedido explícito do Rodrigo.
- Commits pequenos e em português.
- Nunca misturar documentação, schema e UI no mesmo PR se puder separar.
- Antes de começar: `git status -sb`.
- Ao final: mostrar arquivos alterados, validações executadas e riscos.

## Validação

Antes de entregar alteração de código, rode conforme aplicável:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Se a tarefa for apenas documentação, no mínimo rode:

```bash
git diff --check
```

Não entregue com teste quebrado sem explicar claramente o motivo e sem autorização.

## Padrão de código

- TypeScript sem `any` novo.
- Não refatorar fora do escopo.
- Não criar abstrações prematuras.
- Não mover módulos antigos para o redesign sem necessidade direta da tarefa.
- Preferir funções pequenas, validações explícitas e nomes em português para conceitos visíveis ao usuário.

## Design e UX

A equipe operacional usa celular durante trabalho. Interface deve ser:

- mobile-first;
- visual;
- com botões grandes;
- com poucos campos livres;
- com confirmação para ações críticas;
- clara para uso rápido em loja/produção.

Módulos novos devem usar o padrão `ps-*` do redesign. Módulos antigos só devem ser migrados quando forem tocados por necessidade real.

## Importação de vendas CNM

Como não há integração direta com o PDV, o caminho inicial é:

1. Upload manual de CSV/Excel exportado do Controle Na Mão.
2. Prévia e validação no ERP.
3. Mapeamento `nome no CNM -> produto interno`.
4. Confirmação humana.
5. Bloqueio de duplicidade por loja/data/importação.
6. Evolução futura para pasta/e-mail/RPA/API.

## Forma de trabalhar

Para tarefas complexas:

1. Ler docs.
2. Auditar código relevante.
3. Escrever plano curto.
4. Esperar aprovação do Rodrigo.
5. Fazer mudança mínima.
6. Validar.
7. Entregar resumo claro.

Se encontrar risco fora do escopo, pare e reporte. Não resolva junto.
