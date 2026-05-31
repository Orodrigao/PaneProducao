# CLAUDE.md — Pane & Salute ERP

> 🧠 **Antes de qualquer trabalho nesta sessão, ler estes arquivos se existirem:**
> 1. **[agent-rules.md](agent-rules.md)** — 12 regras de como opero neste projeto (Plan Mode, verificação, simplicidade, etc.)
> 2. **[lessons.md](lessons.md)** — log append-only de erros que cometi em sessões anteriores (não repetir)
> 3. **[tasks/todo.md](tasks/todo.md)** — plano da tarefa atual, se houver uma em curso
>
> **Workflow:** usuário pegou erro novo → apêndo entrada em `lessons.md`. Tarefa multi-step → escrevo plano em `tasks/todo.md` antes de codar, valido com o usuário.

ERP interno de uma padaria artesanal com 3 lojas em Caxias do Sul (RS). O sistema responde à pergunta "para onde vai o dinheiro?" — não substitui o PDV fiscal (CNM), complementa.

- **Produto, escopo, usuários, módulos:** [docs/PRD.md](docs/PRD.md)
- **Plano técnico, fases, schema do banco:** [docs/PLAN.md](docs/PLAN.md)
- **Tarefas ativas e backlog:** [docs/TASKS.md](docs/TASKS.md)
- **Setup de infra (tokens, MCPs, deploy):** [_GUIA_INFRA.md](_GUIA_INFRA.md) *(local-only, não no GitHub)*

"O que falta?" / "qual o roadmap?" → PLAN/TASKS. "Por quê existimos?" → PRD. Este arquivo só explica como o código está organizado e onde mora o que.

## Stack

- **Next.js 15.5** (App Router) + **React 19** + **TypeScript strict**
- **`output: 'export'`** — site é gerado estático. Sem API routes, sem middleware, sem SSR.
- **Tailwind CSS 3.4** + ESLint (`next lint`) — adoção mista: módulos novos usam classes Tailwind, módulos antigos ainda usam inline styles. Coexistem.
- **`@supabase/supabase-js` 2.49** + tipos gerados em `src/lib/database.types.ts` via `supabase gen types`.
- **Supabase** (Postgres + Storage) — projeto cloud `gohluceldchoitihrimw`. Auth nativo do Supabase **NÃO** é usado.
- **Vercel** hospeda o build — `pane-producao.vercel.app`, auto-deploy do push em `main`.
- **Repo:** `Orodrigao/PaneProducao` (default branch: `main`)
- Node ≥ 20 (atual: 24).

## Localização canônica e ambiente

- **Diretório:** `C:\repos\PaneProducao` (Git Bash: `/c/repos/PaneProducao`). **NUNCA dentro de OneDrive** — o sync do OneDrive corrompe `.git/` (perde `objects/`, `refs/`). Um clone antigo em `OneDrive\Área de Trabalho\...\AppPaneERP` foi abandonado por essa razão; se reaparecer, é lixo.
- **Shell padrão do Claude Code aqui:** **MSYS / Git Bash** (`MINGW64`). PowerShell disponível por outra ferramenta. WSL 2 (Ubuntu) também está instalado e usável para tarefas Linux-puras, mas não é onde rodam os comandos por padrão.

## Mapa do repositório

| Pasta/arquivo | O quê |
|---|---|
| `src/app/` | App Router — uma pasta por módulo (`compras/`, `estoque/`, `romaneio/`, etc.) |
| `src/components/` | Componentes compartilhados — hoje só `AuthGuard.tsx` e `Nav.tsx` |
| `src/lib/` | `auth.ts`, `supabase.ts`, `utils.ts`, `quotations.ts` (helpers de cotação), `database.types.ts` (gerado) |
| `docs/` | PRD, PLAN, TASKS — fonte da verdade do produto |
| `supabase/functions/` | Edge Functions (Deno): `analisar-desconto`, `parse-cotacao`. Deploy via Supabase MCP. `tsconfig` exclui essa pasta (globals do Deno). |
| `supabase/` | `.temp/` (metadata do `supabase link`) — sem migrations locais (ver seção Supabase) |
| `_GUIA_INFRA.md` | Setup de CLIs, tokens, MCPs — local-only, ainda não versionado |

`node_modules/`, `.next/`, `out/`, `.env*`, `tsconfig.tsbuildinfo` estão no `.gitignore`.

## Onde mora cada coisa

- **Path alias:** `@/*` → `./src/*`.
- **Componente compartilhado entre 2+ módulos:** `src/components/`.
- **Componente, hook, helper usado por 1 módulo só:** dentro de `src/app/<modulo>/`. Não promover antes de ter um segundo consumidor.
- **Lógica de domínio compartilhada** (auth, cliente Supabase, formatadores): `src/lib/`.
- **Tipos do banco:** importar de `@/lib/database.types`. Regenerar com `supabase gen types typescript --linked > src/lib/database.types.ts` quando o schema mudar.
- **Estilos:** variáveis CSS globais em `src/app/globals.css`. Em módulo novo, usar Tailwind classes; manter inline styles dos módulos antigos sem refatorar a esmo.

## Comunicação entre módulos

Módulos **não importam código uns dos outros**. Se duas pastas precisam da mesma função, promovê-la para `src/lib/`. Conexão entre módulos é via **dados no banco** (ex: `stock_movements` referencia `orders` por `reference_id`), não via import.

## UX visual-first

A equipe operacional tem letramento variado. Toda tela prioriza **ícones grandes, fotos de produto e botões grossos** sobre campos de texto. Antes de adicionar um input, pergunte: "isso poderia ser uma escolha visual entre opções pré-existentes?". Padrão de nav: `Nav.tsx`, barra fixa inferior com emoji + label.

## Comandos do dia a dia

```bash
npm run dev              # Next dev server em :3000
npm run build            # build estático (gera ./out)
npm run lint             # next lint (ESLint config do Next default)
npx tsc --noEmit         # typecheck

# Supabase (CLI já linkado em supabase/.temp/)
supabase gen types typescript --linked > src/lib/database.types.ts
supabase migration list  # ver histórico de migrations da remote
```

`supabase db pull` **NÃO funciona aqui sem Docker Desktop instalado** (CLI usa container Postgres pra pg_dump). Workflow oficial: schema fica no Supabase Cloud, edições via dashboard SQL Editor **ou** via Supabase MCP do Claude (preferido — versionável, auditável). Se um dia precisar puxar schema local, instale Docker Desktop.

**Deploy:** push em `main` → auto-deploy Vercel. Sem `vercel deploy` manual (token antigo `vcp_5SoB...` que ficava no `deploy.bat` foi removido; verificar revogação na dashboard).

## Supabase

- **Cloud-only para schema.** Projeto `gohluceldchoitihrimw`. URL: `https://gohluceldchoitihrimw.supabase.co`.
- **Cliente JS:** instância única em [src/lib/supabase.ts](src/lib/supabase.ts). Toda query nova importa daqui.
- **Tipos gerados:** `src/lib/database.types.ts`. Regenerar quando schema mudar.
- **Edições de schema:** SQL Editor do dashboard **ou** Supabase MCP (`mcp__a25c5e8e-...__execute_sql`, `apply_migration`).
- **Edge Functions:** em `supabase/functions/<nome>/index.ts` (Deno). Deploy via Supabase MCP (`deploy_edge_function`). Chamadas do client via `fetch(${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/<nome>)` com header `apikey` + `Authorization: Bearer <anon>`. Secrets (ex: `GEMINI_API_KEY`) ficam em Project Settings → Edge Functions → Secrets, **nunca no client**. Hoje: `analisar-desconto` (simulador), `parse-cotacao` (extração de respostas de cotação via Gemini Flash).

**Regra de ouro:** **toda tabela nova precisa de RLS habilitada antes de receber dados.** O app usa a chave publishable (anon-equivalente) — sem RLS, qualquer cliente lê tudo.

## Configuração e segredos

**Cofre central:** `~/.pane-secrets/.secrets` (Windows: `C:\Users\rodri\.pane-secrets\.secrets`). Fora do OneDrive sync, fora do repo. Contém:
- `GITHUB_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN` — CLI tokens
- `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_PASSWORD` — **NUNCA expor no client** (service_role bypassa RLS)
- IDs públicos: `SUPABASE_PROJECT_REF`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`

Para carregar em sessão Bash: `set -a; source ~/.pane-secrets/.secrets; set +a`.

**Repo NÃO deve conter NENHUM segredo.** Se hardcoded, é dívida a pagar. Para client-side, `NEXT_PUBLIC_*` em `.env.local` (gitignored) + variável na Vercel.

## Autenticação

**Custom, NÃO Supabase Auth.** Lógica em [src/lib/auth.ts](src/lib/auth.ts):

- Usuários em tabela `app_users` no Supabase, com fallback hardcoded (`USERS_FALLBACK`) para resiliência.
- Login = `username` + PIN 4 dígitos. Sessão = `localStorage` (`pane_user_id`).
- **6 roles:** `admin | producao | vendas | estoque | compras | romaneio`. Rotas default por role em `DEFAULT_ROUTES_BY_ROLE`.
- **ACL por rota** via `allowedRoutes: string[]`. Pathname matched por igualdade ou prefixo.
- Proteção: `<AuthGuard>` no [src/app/layout.tsx](src/app/layout.tsx) redireciona para `/login`.

PIN trafega em claro no localStorage. OK para o risco do app interno; não copiar pra sistema com dados sensíveis.

## Pontos de entrada

Para entender o app, abrir nesta ordem:

1. [src/app/layout.tsx](src/app/layout.tsx) — shell raiz, `AuthGuard` + `Nav`
2. [src/components/Nav.tsx](src/components/Nav.tsx) — lista canônica de módulos
3. [src/lib/auth.ts](src/lib/auth.ts) — modelo de usuário, roles, ACL
4. [src/app/page.tsx](src/app/page.tsx) — módulo "Pedidos de Produção" (rota `/`), o maior

**Feature de Cotação de compras** (`/compras` admin → `/cotacoes`): fluxo semi-automático lista semanal → cotação → WhatsApp → IA extrai respostas → comparativo → pedido. Mapa: `/compras` (botão "Gerar cotação") → `/cotacoes` (lista) → `/cotacoes/detalhe` (envio + lançar resposta) → `/cotacoes/comparativo` (escolher fornecedor + gerar pedido). Helpers em `src/lib/quotations.ts`; parsing em `supabase/functions/parse-cotacao`. Tabelas: `supplier_products`, `quotations`, `quotation_items`, `quotation_suppliers`, `quotation_responses`, `supplier_orders`, `supplier_order_items`.

## Gotchas

- **Static export, sem servidor.** Não adicione `route.ts`, `middleware.ts`, server actions, `dynamic = 'force-dynamic'`. Tudo client-side, auth incluso.
- **TZ Brasília manual.** [src/app/page.tsx](src/app/page.tsx) tem `nowBrasilia()` (offset `-180` em runtime). Datas vêm UTC do banco; sempre passar pelo helper. Não usar `new Date()` direto para "hoje".
- **Multi-loja sem registry.** As 3 lojas aparecem como string `store` (`jc`, `ja`, `ex`, `pj`). Não há tabela `stores`. Antes de adicionar valor novo, grep pelos existentes.
- **Tailwind misto com inline styles.** Módulos novos (compras, estoque, fornecedores) usam classes; antigos (page raiz, sobras, romaneio) usam inline. Não unificar sem alinhar.
- **Chaves externas em env vars.** Em produção + `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_CHAT_ID`. **Atenção:** `NEXT_PUBLIC_*` são **inlined no bundle JS** no build — qualquer cliente vê os valores. Só usar para chaves seguras pra serem públicas (anon/publishable, tokens com escopo restrito). `SUPABASE_SERVICE_KEY` e `SUPABASE_DB_PASSWORD` ficam só no `.pane-secrets` e **nunca** no client.
- **Telegram notifica em `/compras`** — enviar lista dispara mensagem no bot. Preservar até decidirmos o contrário.
- **`products.kind` (kit/insumo/final) + `is_revenda`.** Duas dimensões ortogonais a `category`. `kind` = o que o produto é; `is_revenda` = comprado pronto pra revender. Kits têm composição em `product_components` (BOM). `/compras` e `/estoque/entrada` só listam `kind='insumo' OR is_revenda=true`. Antes de filtrar produto por tipo, considerar as duas colunas.
- **Baixa em cascata de kit é client-side.** Descartar (`/sobras`) ou enviar via romaneio (`/romaneio`) um produto `kind='kit'` debita os pães-componentes do estoque em `bread_movements` (`reference_type='descarte_kit'`/`'romaneio_kit'`). Só componente-pão cascateia. Sobra **não** baixa (modelo "prateleira"). Cascade só roda pra produto que é kit **agora** (não basta ter rows em `product_components`).
- **Cotação fecha com lock atômico.** `/cotacoes/comparativo` gera pedidos via `UPDATE quotations SET status='closed' WHERE status!='closed'` como guarda contra duplicação (static export não tem transação). Não trocar por insert-primeiro.

## Comandos: auto-aprovar vs sempre confirmar

**Auto** (read-only ou local):
- `npm run dev`, `npm run build`, `npm run lint`, `npx tsc --noEmit`
- `git status`, `git diff`, `git log`, `git branch`
- `supabase gen types`, `supabase migration list`
- Leituras via Supabase MCP: `list_tables`, `execute_sql` com SELECT, `get_logs`, `get_advisors`
- `gh pr view`, `gh pr list`, `gh run list`, `vercel ls`, `vercel inspect`

**Sempre confirmar antes** (efeito além do disco):
- `git push`, `git push --force`, commits diretos em `main`
- `git reset --hard`, deletar branches
- Supabase MCP de escrita: `apply_migration`, `execute_sql` com INSERT/UPDATE/DELETE/ALTER/DROP, `deploy_edge_function`
- Mudanças em `app_users` (afeta login em produção — sem staging)
- Vercel: criar/excluir projeto, mudar domínio, alterar env vars de produção
- Edição de `.env*`, tokens, scripts com segredos

Não há staging — `main` = produção. Cada push é visto pela equipe na hora seguinte.

