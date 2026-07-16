# AGENTS.md — Pane&Salute ERP

## Missão

Este repositório contém o ERP interno da Pane&Salute.

Pergunta central:

> Para onde vai o dinheiro da Pane&Salute?

Prioridades duráveis:

1. CMV teórico confiável.
2. CMV real por família de insumo e produto.
3. Menos sobras, rupturas e erros de produção.
4. Compras rastreáveis e histórico de preços.
5. Menor dependência operacional do Rodrigo.

As unidades reais são:

- `jc` — Júlio de Castilhos, produção central e loja;
- `ja` — Jardim América;
- `ex` — Exposição.

`PJ` é tipo/canal de pedido, não loja.

## Hierarquia da documentação

Use esta ordem para decidir o que vale:

1. `AGENTS.md` — regras duráveis de trabalho e segurança.
2. `docs/CURRENT_STATE.md` — fase real, riscos e bloqueios atuais.
3. `docs/PLAN.md` — roadmap canônico para chegar ao CMV.
4. `docs/PRD.md` — problema de negócio e requisitos do produto.
5. Documento específico da funcionalidade, somente quando a tarefa exigir.
6. Código, migrations e testes — prova do que foi implementado.

Arquivos com `AUDIT`, `RESULT`, datas no nome ou dentro de
`docs/codex-tasks/` são registros históricos. Eles não definem o estado atual
sozinhos.

Antes de propor uma mudança:

1. rode `git status -sb`;
2. leia este arquivo e `docs/CURRENT_STATE.md`;
3. leia apenas o plano e os documentos relacionados à tarefa;
4. audite o código, migrations e testes relevantes;
5. resuma em 5 a 10 linhas o entendimento.

Não carregue todo o diretório `docs/` por padrão.

## Stack e limites arquiteturais

- Next.js 15 App Router.
- React 19.
- TypeScript strict.
- Supabase/Postgres.
- Vercel.
- `output: 'export'`: app estático, sem API routes, middleware, SSR ou Server
  Actions.
- O frontend acessa Supabase diretamente com chave pública.
- Supabase Auth por e-mail e senha funciona em paralelo ao login legado por
  PIN.
- `app_profiles` é a base do acesso autenticado.
- `app_users`, PIN e fallback em código ainda existem temporariamente e são
  dívida de segurança.

Nunca trate login, menu ou `allowed_routes` como autorização suficiente.
Autorização de dados precisa estar nas policies RLS.

## Fluxo para nova funcionalidade

Nenhuma funcionalidade nova começa pela implementação.

### 1. Descoberta

- Entrevistar Rodrigo e fazer perguntas sobre problema, usuários, exceções,
  frequência, dados e definição de sucesso.
- Auditar o fluxo atual no código e no banco.
- Quando trouxer valor real, pesquisar concorrentes e ferramentas consolidadas.
- Comparar alternativas técnicas, custos, riscos e impacto operacional.
- Registrar o que ficará fora do escopo.

### 2. Plano

- Criar plano detalhado dividido em fases pequenas.
- Cada fase deve ter objetivo, escopo, arquivos prováveis, riscos, critérios de
  aceite, testes e rollback mental.
- Esperar aprovação explícita de Rodrigo antes da primeira implementação.
- Mudança relevante de direção exige nova aprovação.

### 3. Execução por fase

- Começar de branch `codex/<descricao-curta>` criada a partir do
  `origin/main` atualizado.
- Um worktree, uma tarefa e um escopo.
- Se houver alteração local não relacionada, parar e isolar o trabalho.
- Implementar somente a fase aprovada.
- Não refatorar módulos vizinhos por iniciativa própria.
- Não criar abstração sem consumidor real.

### 4. Verificação

Conforme o risco e o escopo:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Além disso:

- testar no navegador o fluxo completo alterado;
- testar pelo menos os perfis e lojas afetados;
- revisar o diff como revisão de código;
- confirmar estados de carregamento, vazio, erro, sucesso e repetição de ação;
- não considerar concluído com teste quebrado.

Documentação pura exige no mínimo:

```bash
git diff --check
```

### 5. Entrega

- Commits pequenos e em português.
- Push somente da branch da tarefa.
- Pull request sempre draft, salvo pedido explícito em contrário.
- Nunca fazer push direto na `main`.
- Informar arquivos alterados, verificações, resultado do navegador e riscos.

## Memória útil

Após uma tarefa bem-sucedida:

- atualize `docs/CURRENT_STATE.md` somente se fase, capacidade ou risco real
  mudou;
- registre em `lessons.md` somente aprendizado não óbvio, generalizável e capaz
  de evitar erro futuro;
- altere `AGENTS.md` somente quando surgir uma regra global e durável;
- atualize `docs/PLAN.md` somente quando roadmap, ordem ou critério de pronto
  mudar.

Não guardar:

- narração da tarefa;
- informação óbvia ao ler o código;
- lista de arquivos alterados;
- estado temporário de branch;
- detalhe já preservado no PR ou commit;
- snapshot chamado de “estado atual” sem data e fonte.

## Segurança obrigatória

Nunca faça sem aprovação explícita de Rodrigo:

- push direto na `main`, force push ou `git reset --hard`;
- escrita em Supabase de produção, incluindo migration, DDL ou DML;
- mudança em `app_users`, usuários Auth, PINs, roles ou rotas de login;
- deploy manual de Edge Function;
- alteração de `.env`, segredos, tokens ou chaves;
- dependência nova de produção;
- exclusão de branch ou worktree.

Nunca versionar:

- service role, senha do banco, tokens ou chaves privadas;
- certificado digital;
- sessão/cookie do CNM;
- export real do CNM, XML ou documento fiscal sem anonimização;
- dados pessoais que não sejam indispensáveis ao funcionamento.

Fixtures devem ser anonimizadas em `test/fixtures/` ou `docs/examples/`.

## Supabase

- Toda tabela em schema exposto deve ter RLS antes de receber dados.
- Grants da Data API e policies RLS são controles diferentes; migrations devem
  tratar ambos explicitamente.
- Não usar policy genérica permissiva para `anon` ou `authenticated`.
- Policies de escrita devem validar o perfil e o escopo da operação.
- `UPDATE` precisa de policy de leitura e de `WITH CHECK`.
- Função crítica precisa de validação de entrada, tratamento de erro e
  privilégio mínimo.
- `SECURITY DEFINER` exige revisão específica, `search_path` seguro e grants
  explícitos.
- Antes de nova informação financeira, concluir o hardening indicado em
  `docs/CURRENT_STATE.md`.

## Código e UX

- TypeScript sem `any` novo.
- Funções pequenas, validações explícitas e nomes de domínio claros.
- Interface mobile-first, visual, rápida e com poucos campos livres.
- Ações críticas ou irreversíveis exigem confirmação.
- Módulos novos usam o padrão `ps-*`.
- Módulos antigos só migram quando a tarefa realmente os tocar.

Se encontrar risco fora do escopo, pare e reporte. Não resolva junto.
