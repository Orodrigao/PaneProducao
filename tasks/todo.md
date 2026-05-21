# TODO — Módulo /relatorios + primeiro relatório (Sobras/Descartes)

**Criado:** 2026-05-20
**Status:** done (PR-A; aguardando teste manual e início do PR-B do Sander)

## Contexto / objetivo

Construir o módulo de relatórios que será o lar de **vários** relatórios futuros (romaneios, produção, congelados snapshot+giro, financeiro). Esta tarefa entrega:
- **Esqueleto do módulo** (`/relatorios` com index de cards, rota nova no Nav, integração com sistema de routes per-user)
- **Primeiro relatório completo**: histórico unificado de Sobras + Descartes
- **Componentes reutilizáveis** em `src/components/reports/` que os próximos relatórios consomem

Os outros relatórios mencionados (romaneios, produção, congelados, financeiro) ficam **planejados** mas implementados em PRs futuros.

## Decisões já tomadas

- **Audiência:** configurável via routes do `/admin/usuarios` (admin decide quem vê). Default: admins têm acesso; outros não. Admin pode dar pra Elis, por exemplo, manualmente.
- **Sobras + Descartes:** mesma tela com filtro de modo (`Sobras | Descartes | Ambos`).
- **Arquitetura:** módulo `/relatorios` desde já, com subrotas por relatório.

## Plano

### 1. Componentes reutilizáveis (`src/components/reports/`)

- [x] `PeriodFilter.tsx` — date range picker com presets (Hoje · 7d · 30d · Mês · Custom). Emite `{ from: Date, to: Date }`.
- [x] `SegmentedFilter.tsx` — controle de 2-4 botões pra filtros binários/ternários (ex: `Sobras | Descartes | Ambos`).
- [x] `KPICard.tsx` — card com label + valor grande + helper text. Suporta unidade (`un`, `kg`, etc.).
- [x] `ReportTable.tsx` — tabela com header sortable, virtualization opcional pra muitas linhas (descartar virtualization pro v1), row click opcional.
- [x] `csvExport.ts` — helper que converte `Array<Record>` em CSV string + dispara download via Blob URL.

### 2. Página index `/relatorios/page.tsx`

- [x] Lista de cards, um por relatório disponível. Cada card: ícone + título + descrição curta + link.
- [x] Cards exibidos baseados na `allowedRoutes` do usuário — se o user tem `/relatorios/sobras-descartes`, mostra o card. Senão esconde.
- [x] Card "Em breve" pra relatórios planejados mas não implementados (romaneios, produção, congelados, financeiro). Disabled visualmente.

### 3. Primeiro relatório `/relatorios/sobras-descartes/page.tsx`

- [x] **Carregamento:** 3 queries em paralelo: `sobras`, `descartes`, `breads + products` (pra resolver nomes). Cache local.
- [x] **Filtros (barra topo):**
  - PeriodFilter (default: últimos 30 dias)
  - SegmentedFilter modo (Sobras | Descartes | Ambos, default: Ambos)
  - Dropdown responsável (Todos + lista)
- [x] **KPIs (4 cards):**
  - Total sobras (qty)
  - Total descartes (qty)
  - # registros
  - Top produto (com mais quantidade no período)
- [x] **Tabela:** colunas `Data · Responsável · Modo · Produto · Categoria · Quantidade · Obs`. Sort default: data desc.
- [x] **Export:** botão "Exportar CSV" no canto da tabela usando `csvExport.ts`.

### 4. Integração

- [x] [src/components/Nav.tsx](src/components/Nav.tsx): adicionar entrada `Relatórios` (ícone `📈`) na lista `ALL_LINKS`. Visibilidade segue `canAccess` (já filtra pelas routes).
- [x] [src/lib/auth.ts](src/lib/auth.ts) → `DEFAULT_ROUTES_BY_ROLE.admin`: adicionar `/relatorios` e `/relatorios/sobras-descartes`. Outras roles ficam sem por default.
- [x] [src/app/admin/usuarios/page.tsx](src/app/admin/usuarios/page.tsx) → `ROUTE_OPTIONS`: adicionar entradas pra `/relatorios` e `/relatorios/sobras-descartes` (assim admin pode marcar pra outros usuários).
- [x] SQL: atualizar routes dos admins existentes (Rodrigão e Suélen) pra incluir as novas rotas.

### 5. Verificação

- [x] `npx tsc --noEmit` verde
- [x] `npm run build` verde — 2 rotas novas prerenderizadas estáticas
- [x] Manual: Rodrigão acessa `/relatorios` → vê card de Sobras/Descartes → entra → filtra por última semana → exporta CSV → confere dados

## Roadmap dos próximos relatórios (escopo planejado, implementação separada)

Em ordem de valor + dependência:

| # | Relatório | Dados | Complexidade | Notas |
|---|---|---|---|---|
| 2 | `/relatorios/romaneios` | `romaneios`, `rom_items`, `destinations` | Baixa-Média | Lista de entregas + filtro por status, conferência divergente |
| 3 | `/relatorios/producao` | `orders`, `order_items`, `breads` | Baixa | Pedidos por dia/loja, comparativo período-vs-período |
| 4 | `/relatorios/congelados/snapshot` | `frozen_stock`, `frozen_products` | Baixa | O que tem hoje, por local (Freezer H./Câmara/Freezer Loja) |
| 5 | `/relatorios/congelados/giro` | `frozen_movements` | **Alta** | Days-of-supply, alerta de overproduction ("fez 100, demorou 60 dias pra escoar"). Análise de séries temporais. KPI próprio: produtos parados >X dias |
| 6 | `/relatorios/financeiro` | dependente da Fase 2 do PLAN.md | Alta | Bloqueado até leitura de NF / import de vendas |

## Fora de escopo (desta tarefa)

- **Gráficos** (line/bar/pie) — começamos só com tabela + KPIs. Adicionar charts em report específico quando claramente ajudar (giro de congelados é candidato forte). Lib provável: Recharts ou Chart.js, decidir quando precisar.
- **Filtro por produto individual** — usar Categoria por enquanto. Filtro de produto específico se virar reclamação.
- **Salvar filtros favoritos** — URL-encoding seria nice mas não-bloqueante.
- **Exportar PDF** — CSV abre no Excel; PDF é nice-to-have pra depois.
- **Permission view-only granular** (deferido já 2x; segue deferido).
- **Drill-down entre relatórios** — clicar num produto no relatório de sobras ir pro relatório de produção desse produto. Bom design, futuro.

## Estimativa

| Arquivo | Linhas |
|---|---|
| `src/components/reports/PeriodFilter.tsx` (novo) | ~60 |
| `src/components/reports/SegmentedFilter.tsx` (novo) | ~30 |
| `src/components/reports/KPICard.tsx` (novo) | ~30 |
| `src/components/reports/ReportTable.tsx` (novo) | ~90 |
| `src/components/reports/csvExport.ts` (novo) | ~25 |
| `src/app/relatorios/page.tsx` (novo) | ~90 |
| `src/app/relatorios/sobras-descartes/page.tsx` (novo) | ~220 |
| `src/components/Nav.tsx` (edit) | +3 |
| `src/lib/auth.ts` (edit) | +2 |
| `src/app/admin/usuarios/page.tsx` (edit) | +4 |
| SQL (manual via MCP) | 2 statements |
| **Total novo** | **~545 linhas** |

Tarefa grande mas contida — todas as 545 linhas estão na construção do módulo + 1º relatório. Não toca em lógica de outros módulos.

## Notas durante execução

- (preenchido conforme avanço)
