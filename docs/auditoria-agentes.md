# Auditoria de agent-readiness — PaneERP

**Data:** 2026-08-30
**Base observada:** `origin/main` em `eb44f9f` (`fix: a ponte do banco por PR ganha disparo manual (#291)`).
**Natureza:** diagnóstico. Não é regra de trabalho e não substitui
`AGENTS.md` nem `docs/CURRENT_STATE.md`. É um snapshot: o que o
repositório estava mentindo, onde o tempo do agente some, e o que
consertar em que ordem.

**Escopo desta PR:** só este relatório e um apontador curto em
`AGENTS.md`. Nenhum refactor de produto.

---

## Resumo executivo

Os agentes não estão “burros” nem “faltando regra”. O repositório já
tem mais infra de agente do que a maioria dos ERPs: `AGENTS.md` (500
linhas), `lessons.md` (63 lições), skill de funcionalidade nova,
template de PR, trava de ambiente, workflows de banco, 87 arquivos de
teste. O tempo some **depois** da leitura, não antes.

O loop típico é:

1. o agente lê o mapa oficial (`CURRENT_STATE.md`, `AGENTS.md`,
   `AMBIENTE_PREVIEW.md`, um plano em `docs/`);
2. o mapa descreve um mundo de 13 de agosto — ou, no caso do Preview,
   um mundo em que a fila compartilhada ainda é a regra;
3. o código e os commits de 26–30 de agosto já saíram desse mundo
   (`#287`–`#291` entregaram banco isolado por PR; a conferência de
   quantidade enviada do PJ já está no ar);
4. o CI ou o Rodrigo mostram um sintoma (smoke vermelho, tela que
   “sumiu”, permissão que “não pega”);
5. o agente trata o sintoma como bug do produto e abre um PR de
   correção — o mesmo tipo de correção que já foi feita quatro, cinco,
   oito vezes.

Três números resumem o custo:

- **18 dos últimos 40 commits** são `fix:` — o repositório gasta mais
  energia apagando fogo do que abrindo frente.
- **O smoke do Romaneio EX foi “estabilizado” ao menos 8 vezes**
  (PRs `#184`, `#203`, `#239`, `#250`, `#253`, `#261`, `#281` e as
  lições de 21, 23 e 29/08). A causa raiz — teste contra `next dev` +
  cenário fictício amarrado em “hoje” — ainda está no arquivo.
- **`docs/CURRENT_STATE.md` está datado em 2026-08-13** e ainda afirma
  coisas que o próprio repositório já desmentiu (admin sem tela
  financeira; fila única de Preview; “nenhuma linha escrita” no plano
  de quantidade enviada).

O que falta não é mais documento. É **uma fonte de verdade que
acompanhe o merge**, um onboarding de agente que caiba em uma tela, e
o fechamento de três dívidas que reciclam o mesmo bug: permissão em
vários planos, identidade dupla de produto, e o smoke que falha sem
defeito.

---

## Por que os agentes apagam incêndio

Causas verificadas, não palpites.

### 1. O mapa oficial atrasou do território

O ritual de início manda ler `docs/CURRENT_STATE.md` e `lessons.md`
antes de propor qualquer mudança (`AGENTS.md`, hierarquia da
documentação, passos 6–7). Na `main` de 30/08 isso produz premissa
errada:

| O mapa diz | O código / o git diz |
|---|---|
| `CURRENT_STATE.md` linha 3: base `6f483b0`, 2026-08-13 | `HEAD` é `eb44f9f`, 17 dias e dezenas de PRs depois |
| `CURRENT_STATE.md` linhas 115–123: “os perfis admin não enxergam as telas financeiras” | Migration `20260812140704_admin_acessa_telas_financeiras.sql` já aplicou o remendo; `DEFAULT_ROUTES_BY_ROLE.admin` em `src/lib/auth.ts` já inclui `/contas-pagar` e `/financeiro` |
| `CURRENT_STATE.md` não menciona Branching operacional | `#287`–`#291` (29–30/08): “cada PR com migration passa a testar no próprio banco, sem fila” |
| `docs/QUANTIDADE_ENVIADA_PEDIDOS_PJ.md` linhas 6–9: “Aguardando aprovação… Nenhuma linha de código foi escrita” | `src/lib/pjDispatchCheck.ts`, `src/lib/pjOrderDispatchClient.ts`, migration `20260820232802_conferencia_quantidade_enviada_pj.sql` e `#276` já existem |
| `AGENTS.md` linhas 194–201 e `docs/AMBIENTE_PREVIEW.md` linhas 37–54: “não declare a fila extinta” | `scripts/preview-branch-env.mjs` e `.github/workflows/banco-por-pr.yml` já apontam o preview da Vercel para o banco da PR |

Um agente obediente gasta a primeira meia hora **reconstruindo um
estado que não existe**. Depois “conserta” o que o mapa ainda lista
como aberto, ou serializa trabalho por uma fila que o código já
tentou aposentar.

### 2. Há autoridades demais, e elas discordam

Não há conflito entre `CLAUDE.md` e `AGENTS.md`: `CLAUDE.md` só
importa o segundo. O conflito é outro:

- `AGENTS.md` — regras de trabalho (500 linhas, mistura lei durável
  com estado de Preview que envelhece).
- `lessons.md` — 63 pares Trap/Rule, cronológicos, sem índice por
  tema. Várias lições descrevem **o mesmo fogo** (smoke EX, seed com
  “hoje”, fuso UTC × padaria, fila do Preview).
- `docs/CURRENT_STATE.md` — deveria ser o único estado datado; está
  17 dias atrás.
- `docs/PLAN.md` — roadmap de 2026-07-21; ainda trata “Segurança vem
  antes de novos dados financeiros” como princípio, enquanto o
  próprio `CURRENT_STATE` já registra a decisão de 11/08 que
  **liberou** dado financeiro novo com gate por fase.
- Planos vivos em `docs/` (`QUANTIDADE_ENVIADA_PEDIDOS_PJ.md`,
  `CONTAS_A_RECEBER.md`, `FINANCEIRO.md`) — alguns já viraram
  histórico e continuam na pasta canônica.
- `docs/history/` — 34 markdowns. A pasta avisa que não define o
  presente; um agente em arqueologia lê mesmo assim.
- `.claude/skills/nova-funcionalidade/SKILL.md` — roteiro útil, mas
  cita ferramenta `AskUserQuestion` que não existe em todo harness, e
  manda coordenar com branches `codex/*` que nesta `main` **não
  existem** (só `main` e `fix/programacao-producao-pj-preview`).
- `tasks/README.md` — “não existe um todo.md global”. A pasta
  `.agents` **não está no repositório**. O que o usuário vê em
  `C:\repos\PaneERP` (worktrees do Claude, anexos, lixo local) está
  no `.gitignore` (`.claude/*`, `.codex-remote-attachments/`) e é
  invisível para o próximo agente de nuvem.

Resultado: o agente “lê as regras” e sai com três versões do Preview,
duas versões do acesso do admin e um plano que diz que a feature
ainda não começou.

### 3. O ritual empurra a consertar, não a estreitar

O preflight tem 10 passos, inclusive `git fetch`, diff contra
`origin/main`, PRs, worktrees, `CURRENT_STATE`, **todas** as lessons,
plano da tarefa, código, migrations e testes — antes de resumir em
5–10 linhas. Isso é correto para mudança de dinheiro. Aplicado a
todo pedido, incluindo texto, o agente começa a sessão **já em modo
auditoria**.

A skill de funcionalidade nova reforça: “Encha-o de perguntas”,
benchmark de mercado, plano em fases, briefing autocontido. Quando o
Rodrigo pede um ajuste (“a aba da EX sumiu no teste”), o harness
classifica como sintoma, abre descoberta, e o caminho estreito
(“o smoke roda contra `next dev` e o Strict Mode remonta a tela”)
compete com um questionário.

`lessons.md` documenta o fogo com precisão cirúrgica — e **não fecha
a causa**. A lição `tela-vazia-nao-e-tela-carregando` (21/08) não
impediu `a-tela-pode-sumir-embaixo-do-teste` (29/08). A lição
`seed-com-hoje-vence-a-meia-noite` (14/08) não impediu
`rerun-navegador-exige-seed-do-dia` de continuar valendo. Gravar sem
mudar o teste ou o seed só ensina o próximo a reconhecer o cadáver.

### 4. O produto concentra risco em poucos arquivos enormes

24 páginas passam de 300 linhas — o próprio `AGENTS.md` manda extrair
acima disso em página **nova**, e não toca as antigas. As que a
operação usa todo dia são as piores:

| Arquivo | Linhas | O que a padaria faz ali |
|---|---|---|
| `src/app/page.tsx` | 1766 | Produção do dia, PJ, Telegram, Geolar |
| `src/app/romaneio/page.tsx` | 1636 | Viagem, conferência, admin, rascunho |
| `src/app/produtos/composicao/page.tsx` | 1451 | Ficha / CMV teórico |
| `src/app/planejamento-producao/page.tsx` | 1090 | Programa a fornada |
| `src/app/pedidos-pj/page.tsx` | 1047 | Pedido que vira cobrança |
| `src/app/sobras/page.tsx` | 976 | Contagem e destino de sobra |

`src/lib/types.ts` tem **12 linhas** (um `BreadOption`). O cliente
Supabase em `src/lib/supabase.ts` é `createClient(url, key)` sem
genérico `Database`. O ESLint marca `no-explicit-any` como **warn**,
não erro. `page.tsx` e `romaneio/page.tsx` ainda têm `sbGet` / `sbPost`
locais com `data: any`, paralelos a `src/lib/supabaseRest.ts`.

Os 60 testes Vitest cobrem bibliotecas extraídas (`romaneioDraft`,
`receivables`, `payables`). As telas de 1.600 linhas quase não têm
teste de comportamento. Quando o smoke quebra, o agente não tem um
teste pequeno que aponte o ramo — entra no monolito.

### 5. A verificação de navegador falha por razões que não são o diff

`.github/workflows/ci.yml` ainda:

- entra no grupo de concorrência `banco-preview-compartilhado`
  (linhas 50–52), o mesmo do workflow que **apaga** o banco;
- espera o job “Reconstruir Preview desta PR” só se a etiqueta
  `precisa-banco-preview` existir;
- confere o cenário da EX pela data de **hoje** em
  `America/Sao_Paulo` (linhas 199–210);
- roda `npm run test:browser` contra o servidor de desenvolvimento.

`test/browser/auth.smoke.spec.ts` linhas 47–70 documentam o
mecanismo: Strict Mode remonta o Romaneio, `setScreen('admin')`
apaga a aba no meio do teste, e o laço reentra **duas** vezes. Isso
não é cobertura de produto — é pacto com um modo de desenvolvimento
que a padaria nunca usa.

Cada vermelho desses ensina o agente a “estabilizar o smoke” em vez
de entregar a tela.

---

## Mapa do projeto (o que é o quê)

### O que o app é

ERP interno da Pane&Salute, três lojas reais (`jc`, `ja`, `ex`).
Next.js 15 App Router, `output: 'export'` — site estático, sem API
route, sem middleware, sem Server Action. O navegador fala com o
Supabase pela chave pública. Autenticação: e-mail e senha;
`app_profiles` decide papel, loja e rotas.

Pergunta do produto: **para onde vai o dinheiro?** CMV, sobras,
compras, cobrança PJ, livro-caixa.

### Pastas que importam

```
src/app/                  telas (uma pasta = uma rota)
src/components/           pedaços reutilizados (Nav, financeiro, PJ)
src/lib/                  regras extraídas + auth + cliente HTTP
src/integrations/cnm/     coletor do PDV (não é importação fechada)
supabase/migrations/      50 arquivos; marco zero = baseline 2026-07-22
supabase/tests/           pgTAP (a verdade do banco)
supabase/seed.sql         1440 linhas de padaria fictícia
test/browser/             smoke Playwright (Chrome, contas de teste)
scripts/                  ponte Vercel↔banco da PR, provisionamento, CNM
.github/workflows/        CI, CI Banco, Banco Preview, Banco por PR
docs/                     cânone + planos de funcionalidade
docs/history/             passado; não consultar como estado
.claude/skills/           só a skill versionada (o resto é local)
```

Não existem no git, apesar do sintoma relatado: pasta `.agents`,
worktrees do Claude, `tasks/` com planos vivos. `tasks/README.md` só
desautoriza um `todo.md` global.

### Fluxo de um agente novo que tenta contribuir

1. Lê `README.md` → `AGENTS.md` → `CURRENT_STATE.md` → `lessons.md`.
2. Copia `.env.example` para `.env.local` (aponta ao projeto Preview
   `tuqzhjsbodoycjbmwuqm`, nunca produção). Sem isso o build recusa
   (`src/lib/environmentSafety.ts` + `next.config.ts`).
3. `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test`,
   `npm run build`. Isso passa na máquina sem Docker e sem senha de
   teste.
4. O que **não** passa na máquina de um agente de nuvem sem setup
   extra:
   - pgTAP (`npx supabase start` + Docker; o atalho
     `supabase test db` é conhecido por falhar — lição 21/08);
   - smoke (`SUPABASE_TEST_USER_PASSWORD` só no GitHub);
   - Preview da Vercel (depende do push da branch).
5. Branch no formato `tipo/descricao-curta` segundo `AGENTS.md`.
   Agentes de nuvem deste harness nascem em `cursor/...`. A lição
   `rename-de-branch-fecha-o-pr` (20/08) já matou o PR `#247` por
   tentar reconciliar os dois nomes **depois** de abrir o PR.
6. PR draft, template com semáforo e roteiro para o Rodrigo. O
   template ainda exige “Banco Preview verde” em toda PR com
   migration — mesmo depois de `#287`.

`scripts/codex-bootstrap.sh` clona, roda `tsc` + test + build e abre
o Codex com o prompt “leia AGENTS.md e não edite nada”. Não cria
worktree, não materializa `.env.local` do jeito que o `AGENTS.md`
descreve como portaria, não avisa da divergência Preview × banco por
PR.

### Dois bancos de teste, um mapa só

Na `main` de 30/08 convivem:

- **PaneERP Preview** (`tuqzhjsbodoycjbmwuqm`) — compartilhado.
  `.env.example`, worktrees, smoke sem etiqueta. Workflow
  `banco-preview.yml` ainda reconstrói se a PR tiver
  `precisa-banco-preview`.
- **Banco isolado por PR** — Supabase Branching +
  `banco-por-pr.yml` + `scripts/preview-branch-env.mjs`. PR com
  migration ganha URL e chave próprias na Vercel.

O código já aceita os dois (`environmentSafety.ts` linhas 4–10). A
documentação de agente ainda fala como se só o primeiro existisse, e
proíbe declarar a fila extinta. Um agente que obedece a
documentação **recusa trabalho paralelo** que o código já permite; um
agente que obedece o código **ignora a lei escrita**. Os dois perdem.

### Módulos da operação (para não se perder)

| Rota | Quem usa | Risco se o agente mexer sem ler |
|---|---|---|
| `/` Produção | JC, Geolar | Telegram com token `NEXT_PUBLIC_`; identidade pão; 1766 linhas |
| `/romaneio` | Expedição, lojas | Dinheiro (Buck), permissão granular, smoke mais caro do repo |
| `/pedidos-pj` | Elis + Expedição | Vira cobrança; conferência de quantidade já existe |
| `/contas-receber`, `/contas-pagar`, `/financeiro` | Elis; admin no código, nem sempre no banco | RLS + RPC `SECURITY DEFINER`; admin não herda rota de permissão |
| `/sobras` | Lojas + Central | Fechar contagem ≠ dar destino (lição 27/08) |
| `/planejamento-producao` | Produção | PR aberta `#286` nesta área — não sobrepor |
| `/compras`, `/cotacoes` | Pausadas (`src/lib/features.ts`) | Código vivo, menu escondido; não “consertar” a pausa |
| `/produtos`, `/produtos/composicao` | CMV teórico | Identidade dupla bread/product |

`PJ` não é loja. `role === 'romaneio'` existe em TypeScript
(`src/lib/auth.ts` linha 7) e **não** na constraint do banco
(`app_profiles_role_check` no baseline, só
admin/financeiro/producao/compras/estoque/expedicao/vendas). Criar
usuário com esse papel quebra no insert e passa no tipo.

---

## Problemas ranqueados

Ordem = custo de tempo de agente, não gravidade de segurança.
Esforço: **P** (uma sessão), **M** (duas ou três), **G** (projeto
próprio). Impacto: quanto o próximo agente deixa de arqueologizar.

### 1. Estado oficial mentindo — o amplificador de todos os outros

**Família:** A (docs/regras)
**Esforço:** P · **Impacto:** alto

**O que acontece.** O agente lê `CURRENT_STATE.md` e trata como fato.
Ele “reabre” o acesso financeiro do admin, serializa PRs por uma fila
que o código já furou, ou recomeça a descoberta da quantidade
enviada. Cada um desses já custou PR de verdade.

**Evidência.**

- `docs/CURRENT_STATE.md` linhas 1–8 (data 13/08, base `6f483b0`)
  versus `git log -1 --oneline` = `eb44f9f` de 30/08.
- Mesmo arquivo, linhas 115–123, versus
  `supabase/migrations/20260812140704_admin_acessa_telas_financeiras.sql`
  (o próprio SQL avisa: “a causa continua aberta e registrada em
  CURRENT_STATE” — o remendo foi o sintoma, o mapa nunca foi
  atualizado).
- `docs/QUANTIDADE_ENVIADA_PEDIDOS_PJ.md` linhas 6–9 versus
  `src/lib/pjDispatchCheck.ts` e `#276`.
- `docs/PLAN.md` linha 3: “Atualizado em 2026-07-21”.

**Caminho.** Reescrever `CURRENT_STATE.md` contra a `main` de hoje:
fase, capacidades, bloqueios, Preview. Uma sessão. Mover
`QUANTIDADE_ENVIADA_PEDIDOS_PJ.md` para `docs/history/` **ou** trocar
o status das primeiras 10 linhas para “fases 1–N incorporadas, falta
X”. Datar `PLAN.md` e riscar o princípio que a decisão de 11/08
substituiu.

**Não mexer.** Não reescrever `CONTAS_A_RECEBER.md` nem
`FINANCEIRO.md` nesta passagem — são planos longos; só o **status no
topo** e o `CURRENT_STATE`.

### 2. Três textos descrevem o Preview de agosto; o código é de 30/08

**Família:** A + B
**Esforço:** P · **Impacto:** alto

**O que acontece.** Agente A lê `AGENTS.md` e espera a etiqueta /
fila. Agente B lê `banco-por-pr.yml` e abre PR com migration em
paralelo. O smoke de A cai com `invalid_credentials` ou valor
fantasma (lições 12/08, 20/08, 21/08). Ninguém tem um parágrafo
único que diga: “PR sem migration → Preview compartilhado; PR com
migration → banco próprio; o smoke do CI ainda lê o compartilhado”.

**Evidência.**

- `AGENTS.md` linhas 168–201 e 228 (`Banco Preview` obrigatório).
- `docs/AMBIENTE_PREVIEW.md` linhas 7–10 e 37–54 (Preview = um
  projeto; fila vigente).
- `.github/PULL_REQUEST_TEMPLATE.md` linha 19.
- Contraponto: `.github/workflows/banco-por-pr.yml` linhas 1–12;
  `scripts/preview-branch-env.mjs` linhas 3–18;
  commit `7efd3be` / `#287`.

**Caminho.** Um único bloco, copiado para `AGENTS.md` (seção Deploy),
`AMBIENTE_PREVIEW.md` (substituir a seção “Banco compartilhado
durante a transição”) e o checkbox do template. Texto proposto, em
substância: o compartilhado existe e alimenta smoke/worktree; o
isolado existe e alimenta o preview da Vercel quando há migration;
a etiqueta só reconstrói o compartilhado; **não** serializar trabalho
só porque o mapa antigo pedia.

**Não mexer.** Não apagar `banco-preview.yml` nesta passagem. Não
declarar a fila “morta” no CI de navegador — ele ainda usa o
compartilhado (`ci.yml` linhas 44–52).

### 3. `lessons.md` cresce; a causa não fecha

**Família:** A
**Esforço:** P · **Impacto:** alto

**O que acontece.** O preflight manda ler 63 lições. As úteis para a
tarefa de hoje estão no meio. Várias são o mesmo mecanismo com data
nova (seed×relógio, Preview×smoke, identidade de produto). O agente
grava a 64ª em vez de mudar o teste ou o seed.

**Evidência.** Família smoke EX: lições 21/08, 23/08, 29/08 (três no
mesmo dia) + commits `#184`, `#203`, `#250`, `#261`, `#281`. Família
relógio: 12/08 `rerun-navegador`, 14/08 `seed-com-hoje`, 14/08
`data-do-servidor`, 20/08 `fuso-do-teste`, 20/08
`janela-de-relatorio`. A regra de 14/08 já dizia “nunca em hoje”; o
smoke em `ci.yml` linhas 199–201 ainda consulta
`record_date=eq.$HOJE`.

**Caminho.** Não apagar lições. Acrescentar no topo um **índice por
armadilha** (8–12 âncoras: Preview, smoke, fuso, seed, permissão,
identidade, migration `create or replace`, dinheiro com vírgula).
No preflight do `AGENTS.md`, trocar “leia lessons.md” por “leia o
índice; abra a lição do tema da tarefa”. Lição nova só entra se a
causa tiver dono (arquivo + mudança), não só narrativa.

**Não mexer.** Não resumir as 63 em prosa nova. O valor está no par
Trap/Rule curto.

### 4. Smoke do Romaneio EX como máquina de retrabalho

**Família:** B
**Esforço:** M · **Impacto:** alto

**O que acontece.** Push na `main` ou PR “só de docs” fica vermelho.
O agente assume regressão, aumenta timeout, reentra no clique, troca
o localizador. Quatro famílias de causa já foram medidas e
**continuam no arquivo**: tela remonta no Strict Mode
(`romaneio/page.tsx` linha 736 `setScreen('admin')`); localizador
preso ao nome que ganha “•”; orçamento menor que as quatro idas ao
banco; cenário da EX que só existe enquanto a reposição fictícia do
**dia** está aberta.

**Evidência.** `test/browser/auth.smoke.spec.ts` linhas 17–80 (o
próprio teste explica o pacto). `ci.yml` linhas 152–210 e 44–52.
Lição 29/08: a reconstrução tinha **terminado 3s antes** e o cenário
passou na pré-checagem — ainda assim a aba sumiu.

**Caminho, nesta ordem.**

1. Rodar o smoke contra `next start` (modo produção, sem Strict Mode
   extra) **ou** extrair a carga inicial do Romaneio para não chamar
   `setScreen('admin')` numa montagem atrasada. Uma mudança. Medir se
   as duas mensagens de 27–28/08 desaparecem.
2. Desamarrar o cenário EX de `hoje`: data fixa relativa
   (`private.data_na_padaria() - 1` etc.), como a lição de 14/08 já
   manda para o PJ.
3. Só então enxugar o laço de reentrada. Não começar pelo laço.

**Não mexer.** Não “estabilizar” de novo com espera maior. Não
apagar o smoke — ele é a única rede que pega perfil × loja.

### 5. Quatro listas de acesso que não se atualizam juntas

**Família:** C (com um pedaço A)
**Esforço:** M · **Impacto:** alto

**O que acontece.** Tela nova nasce com RLS e permissão granular. O
admin não vê o link. Ou o contrário: a marcação está na tela de
usuários e a RPC recusa (lição 27/08, `register_bread_leftovers`).
O agente “conserta a permissão” no lugar errado. A classe se
repete a cada módulo financeiro.

**Evidência.**

- `src/lib/auth.ts` linhas 56–62: `if (role === 'admin') return
  baseRoutes` — permissão granular **não acrescenta rota** ao admin.
- `DEFAULT_ROUTES_BY_ROLE.admin` (linhas 31–32) tem `/contas-pagar` e
  `/financeiro`, **não tem** `/contas-receber`. O Nav tem o link
  (`src/components/Nav.tsx` linha 47). Em produção o admin só vê se
  `allowed_routes` no banco já tiver a rota — o mesmo buraco da
  migration de 12/08, agora na terceira tela.
- Seed do admin de teste usa `["/", "*"]` (`supabase/seed.sql` linha
  414). `canAccess` trata `*` como coringa (`auth.ts` linhas 478–484).
  Preview ≠ produção: no Preview o admin vê tudo; no mapa de 13/08
  ele não via financeiro. Agente que testa no Preview “prova” o
  contrário do que o Rodrigo vê no celular.
- Constraint do banco sem `romaneio`; TypeScript com `romaneio`
  (`CURRENT_STATE.md` linhas 132–133 — este item ainda é fato).

**Caminho.**

1. Decisão do Rodrigo: admin vê **todas** as telas ou só as da lista
   gravada? (já está implícito no seed de teste × produção.)
2. Se admin vê tudo: `resolveAllowedRoutes` para admin passa a unir
   `DEFAULT_ROUTES_BY_ROLE.admin` com as rotas do Nav, e o seed de
   produção deixa de ser lista congelada. Uma função, um teste que
   quebra quando o Nav ganha href novo.
3. Se admin vê a lista: aí sim migration de dado para `/contas-receber`,
   igual à de 12/08, **e** o `CURRENT_STATE` para de dizer que ele
   não vê financeiro.
4. Teste de invariante: `DEFAULT_ROUTES_BY_ROLE` ∪ Nav ⊇ rotas
   financeiras. Já existe a semente em `src/components/Nav.test.ts`.

**Não mexer.** Não unificar `allowed_routes` com
`app_user_permissions` em todos os módulos antigos neste passo —
é o projeto de permissão, risco alto, fase própria. Não “corrigir”
o role `romaneio` no banco sem decidir se o papel existe de verdade.

### 6. Telas monolito + cliente Supabase sem tipo

**Família:** C
**Esforço:** G se for “quebrar as páginas”; **P** se for só o tipo
**Impacto:** alto no dia a dia, baixo se tentar fatiar tudo agora

**O que acontece.** Mudança de uma linha em `romaneio/page.tsx` exige
ler 1.600. O `from('qualquer_coisa')` não reclama coluna inexistente.
`any` passa no lint. O agente introduz o quinto `sbPost` local. O
teste da lib verde não cobre o `setScreen`.

**Evidência.** Contagens desta auditoria: 24 `page.tsx` > 300 linhas;
`src/lib/types.ts` com 12 linhas; `createClient` sem `Database` em
`src/lib/supabase.ts` linha 11; `no-explicit-any: warn` em
`.eslintrc.json`; `sbGet`/`sbPost` duplicados em `page.tsx` 114–131 e
`romaneio/page.tsx` 293–303.

**Caminho.**

1. Gerar `src/lib/database.types.ts` (`supabase gen types`) e passar
   ao `createClient`. Não reescrever páginas. O ganho é o
   autocompletar e o erro de coluna no próximo `select`.
2. Promover `no-explicit-any` a error **só em `src/lib/`** (onde já
   há disciplina). Páginas antigas ficam no warn.
3. Extrair tela **somente quando a tarefa já a toca** — a regra do
   `AGENTS.md` está certa; o que falta é não abrir “refactor do
   Romaneio” como tarefa de agente.

**Não mexer.** Não fatiar `page.tsx` nem `romaneio/page.tsx` nesta
frente de agent-readiness. Não criar um `types.ts` de domínio
completo à mão.

### 7. Identidade dupla pão legado × produto unificado

**Família:** C
**Esforço:** G · **Impacto:** alto em dinheiro, médio em tempo de
agente (já tem ponte)

**O que acontece.** Romaneio grava `source: bread`. Preço mora no
`product` ligado por `legacy_bread_id`. Match cru = “produto sem
preço” = cobrança da EX travada ou inflada. Lição 21/07: “já causou
3+ bugs”. A ponte `src/lib/productIdentity.ts` mitiga; cada tela nova
precisa lembrar.

**Evidência.** `docs/PLAN.md` linhas 54–68 (projeto transversal
aprovado, sem data). Usos atuais: `tabelas-preco/page.tsx`,
`relatorios/romaneios/page.tsx`, `romaneioBilling.ts`. Testes em
`productIdentity.test.ts` e `catalog.test.ts`.

**Caminho.** Não unificar agora. No onboarding do agente: “tela que
cruza operação com preço **obrigatoriamente** passa por
`productIdentity.ts`; `source:id` cru em código novo é bug”. Quando
houver frente sem urgência financeira, retomar o projeto do PLAN em
fases — é risco alto de dado.

**Não mexer.** Não converter histórico `bread` nesta auditoria. Não
criar uma segunda ponte.

### 8. A mesma regra em TypeScript e em SQL

**Família:** C
**Esforço:** M (quando a regra mudar) · **Impacto:** médio

**O que acontece.** Conta da Buck: `src/lib/romaneioBilling.ts` e
`private.calcular_cobranca_buck`. O `CURRENT_STATE` (linhas 225–226)
já assume a dívida. Agente altera um lado. Tela e banco discordam;
a geração recusa ou cobra o número errado.

Há uma irmã mais barata e mais frequente: **fuso**. Código novo usa
`current_date` / `new Date()`. Lições 14/08 e 20/08. A convenção
já existe: `private.data_na_padaria()`.

**Caminho.** No índice de lessons, âncora “regra em dois lugares” e
âncora “data da padaria”. Quando a Buck mudar, um PR que altere os
dois arquivos e os dois testes (`romaneioBilling.test.ts`,
`cobranca_semanal_buck.test.sql`). Para data: um grep no CI ou um
teste de invariante que falhe se migration nova chamar `current_date`
fora de comentário — só se a 65ª lição de fuso aparecer.

**Não mexer.** Não fundir as duas implementações da Buck “por
limpeza”.

### 9. Setup do agente novo: o loop quebra antes do código

**Família:** B
**Esforço:** P · **Impacto:** médio

**O que acontece.** Agente de nuvem ou worktree novo: sem
`.env.local` o build recusa (bom). Sem Docker o pgTAP não roda; a
lição 21/08 ensina o `docker exec` porque `supabase test db` mente.
Sem o secret, o smoke local é skip silencioso (`auth.smoke.spec.ts`
linha 34) — o agente acha que testou. Convenção de branch diverge
(`feat/...` vs `cursor/...` vs `claude/...`) e renomear fecha o PR.

**Evidência.** `scripts/codex-bootstrap.sh` não copia `.env.example`.
`AGENTS.md` “Nascimento de um worktree” descreve uma portaria que
não está neste repositório (é processo da máquina do Rodrigo).
Lição `rename-de-branch-fecha-o-pr`. `.gitignore` esconde `.claude/*`
e anexos — o lixo local não viaja, o próximo agente não herda
contexto e também não herda o estrago, o que é bom; o que é ruim é
a **expectativa** de que `.agents` e worktrees existam no git.

**Caminho.** Uma página de 30 linhas no `README` ou no topo do
`AGENTS.md`: o que roda sem secret, o que só o CI prova, “não
renomeie branch de PR aberto”, “não existe `.agents` versionado”.
Fazer o bootstrap copiar `.env.example` se `.env.local` não existir.

**Não mexer.** Não versionar senha de teste. Não criar pasta
`.agents` “para organizar”.

### 10. Preflight e skill dimensionados para funcionalidade nova, aplicados a tudo

**Família:** A
**Esforço:** P · **Impacto:** médio

**O que acontece.** Ajuste de texto e hotfix de smoke entram no
mesmo funil de 10 passos + entrevista. O agente descobre, planeja e
“não começa pelo código” num pedido que era “o rótulo está
undefined”. Enquanto isso, a frente real (PR `#286`, planejamento
PJ) fica sem dono claro.

**Evidência.** `AGENTS.md` “Na dúvida entre dois níveis, use o mais
alto” + “funcionalidade nova nunca é risco baixo”. Skill linhas
1–3: usar SEMPRE que o pedido parecer novo, mesmo pequeno. PR
aberta `#286` (`fix/programacao-producao-pj-preview`) — um agente
que não olha `gh pr list` pisa em cima.

**Caminho.** No `AGENTS.md`, uma tabela de 6 linhas: texto/docs →
executa; comportamento de tela já usada → plano de 5 linhas e OK;
Auth/RLS/migration/dinheiro → fases. Skill só dispara quando o
pedido **cria** capacidade, não quando conserta a existente. O
preflight curto (status, fetch, PRs abertas, `CURRENT_STATE` se a
data for de hoje, índice de lessons) vira o padrão; o de 10 passos
fica para risco alto.

**Não mexer.** Não enfraquecer o gate de dinheiro. Não apagar a
skill.

---

## Plano curto para deixar o repo agent-friendly

Passos sequenciais. Cada um cabe numa conversa e termina com o
Rodrigo podendo dizer sim/não no preview — ou, nos passos só de
texto, com `git diff --check`. Calendário é da agenda dele, não
desta lista.

### Passo 1 — Atualizar o mapa (A, P)

Reescrever `docs/CURRENT_STATE.md` contra `origin/main` de hoje.
Status no topo de `QUANTIDADE_ENVIADA_PEDIDOS_PJ.md` (ou mover a
`docs/history/`). Uma linha em `PLAN.md` com a data e o princípio
financeiro já substituído. Critério: um agente que ler só o
`CURRENT_STATE` não afirma mais que admin não vê financeiro nem que
a quantidade enviada “não foi escrita”.

### Passo 2 — Um parágrafo só sobre Preview (A, P)

Substituir o bloco defasado em `AGENTS.md`, `AMBIENTE_PREVIEW.md` e
no template de PR pelo texto único do problema 2. Critério: as três
cópias passam num diff mental; checkbox deixa de exigir Banco
Preview em PR sem etiqueta.

### Passo 3 — Índice de lições + preflight curto (A, P)

Topo de `lessons.md` com 8–12 âncoras. `AGENTS.md` aponta o índice,
não o arquivo inteiro. Tabela risco baixo/médio/alto no início da
parceria. Critério: onboarding do agente cabe em uma tela
(`README` + 20 linhas novas no `AGENTS.md` + este relatório).

### Passo 4 — Bootstrap que não mente (B, P)

`codex-bootstrap` copia `.env.example`. README lista o que o CI
prova e a máquina não. Frase explícita: pasta `.agents` e worktrees
do Claude não viajam no git. Critério: agente novo em worktree
limpo roda lint/tipos/test/build sem inventar env.

### Passo 5 — Smoke sem Strict Mode (B, M)

Uma PR: Playwright contra `next start`, ou carga do Romaneio que não
reseta a tela. Não mexer no laço. Critério: reproduzir o mecanismo
da lição 29/08 em laboratório e ver a aba **não** sumir.

### Passo 6 — Seed da EX sem “hoje” (B, P)

Depois do passo 5. Cenário da reposição com data relativa. Pré-checagem
do `ci.yml` usa a mesma data. Critério: rerun no dia seguinte não
pede reconstruir o Preview só por virar a meia-noite.

### Passo 7 — Admin × rotas financeiras (C, P depois de decisão)

Perguntar ao Rodrigo (uma pergunta). Implementar o ramo do problema
5. Teste: Nav ganhou `/algo` financeiro → suite vermelha se
`DEFAULT_ROUTES_BY_ROLE.admin` não tiver. Critério: a terceira tela
financeira não repete a migration de 12/08.

### Passo 8 — Tipos gerados do banco (C, P)

`database.types.ts` + genérico no `createClient`. Sem fatiar página.
Critério: `from('tabela_inexistente')` falha no `tsc`.

### Passo 9 — Invariante de convenções baratas (C, P)

Teste ou grep de CI: `current_date` em migration nova; `source:id`
cru fora de `productIdentity`; `Number(` em campo de dinheiro.
Critério: a próxima lição dessas famílias **não nasce**, porque o
CI segura.

### Passo 10 — Só então olhar dívida grande (C, G, sob demanda)

Identidade bread/product, fatiar Romaneio, unificar planos de
permissão. Cada um é funcionalidade nova: skill, fases, OK do
Rodrigo. **Não entram nesta frente.**

---

## O que ignorar de propósito

- **Refatorar `page.tsx` / `romaneio/page.tsx` / composição.** 4.800
  linhas no caminho do pão de todo dia. Extrair sem pedido operacional
  é a forma mais cara de parecer produtivo.
- **Unificar identidade de produto agora.** Aprovado no roadmap, sem
  data, risco alto de dado. A ponte existe. Disciplina > projeto.
- **Hardening GraphQL, ControlePizza, token do Telegram.** Segurança
  real, lista do `CURRENT_STATE`. Não é o que faz o agente girar em
  correção de smoke. Telegram: não replicar `NEXT_PUBLIC_` em código
  novo; retirar o token é tarefa própria.
- **Despausar compras/cotações.** Flag em `src/lib/features.ts`.
  Código legado com `any`. Mexer “porque está feio” reabre módulo
  congelado.
- **Criar `.agents/`, `TODO.md`, segundo `AGENTS.md`, ou “guia do
  agente v2”.** O contrato de arquivos existe justamente para isso
  não nascer. Este relatório já é o mapa; o próximo passo é
  **corrigir as fontes que ele aponta**, não acrescentar uma quarta.
- **Apagar `lessons.md` ou `docs/history/`.** São evidência. O
  problema é lê-los como estado, não existirem.
- **Declarar a fila do Preview morta no job de navegador.** O código
  do smoke ainda senta no banco compartilhado. Mentir para o outro
  lado é o erro que esta auditoria está documentando.
- **Pisar na PR `#286`** (`fix/programacao-producao-pj-preview`).
  Planejamento de produção PJ já tem dono.
- **Aplicar migration na mão, “só para conferir.”** A regra do
  `AGENTS.md` continua. Auditoria live é leitura.

---

## Como esta auditoria foi feita

Preflight na `main` limpa, alinhada com `origin/main` (`eb44f9f`).
Uma PR aberta (`#286`). Sem worktree extra. Leitura de `AGENTS.md`,
`CURRENT_STATE.md`, `lessons.md`, `AMBIENTE_PREVIEW.md`, `PLAN.md`,
planos de PJ, workflows, `auth.ts`, smoke, seed, skill. Contagens
de linhas, `any`, commits `fix:` vs `feat:`, grep de
`legacy_bread_id` e de `/contas-receber`. Não rodei lint/test/build
— mudança só de texto. Não abri o app no navegador. Não auditei
produção ao vivo: o item “admin não vê financeiro” no
`CURRENT_STATE` pode ainda ser verdade **no banco real** mesmo com a
migration versionada; a afirmação desta auditoria é que o
**repositório** já contém o remendo e o mapa não foi atualizado.

---

## TL;DR para o Rodrigo

Os agentes não estão se perdendo por falta de regra. Eles leem um
mapa atrasado, encontram um semáforo que fica vermelho sem a padaria
ter quebrado, e passam o dia “consertando” o mesmo tipo de coisa.

O mapa do projeto (`docs/CURRENT_STATE.md`) parou em 13 de agosto.
De lá para cá o sistema já ganhou banco de teste por PR, conferência
do que a Expedição realmente enviou, e o remendo para você ver as
telas de dinheiro — mas o mapa ainda diz o contrário.

O teste automático do Romaneio da Exposição já foi “estabilizado”
umas oito vezes. Quase nunca era a padaria. Era o teste rodando num
modo de desenvolvimento que remonta a tela sozinho, e um cenário
fictício que some quando vira o dia.

Tem quatro listas dizendo quem pode entrar em cada tela. Elas não
andam juntas. Por isso “a permissão está marcada e mesmo assim não
deixa” volta. A terceira tela de dinheiro (`/contas-receber`) já
nasceu no mesmo buraco da segunda.

Não precisa redesenhar o sistema. Precisa, nesta ordem: atualizar o
mapa; escrever num lugar só como o banco de teste funciona hoje;
parar de mandar o agente ler 63 lições sem índice; fazer o teste do
Romaneio parar de falhar sozinho; e decidir se o admin vê todas as
telas ou só as gravadas. Fatiar as telas enormes e unificar pão
legado com produto fica para quando houver pedido da operação, não
como faxina de agente.
