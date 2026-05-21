# TODO — PR-B: Módulo /forno (Sander confirma produção) + infra de stock

**Criado:** 2026-05-20
**Status:** done (PR-B; aguardando teste manual; PR-B2 do romaneio é o próximo)

## Contexto / objetivo

Sander (e Geolar/admin) confirma todo dia **o que efetivamente foi assado** + **o que foi perdido no processo** (queimou, fora do padrão, etc). Cada confirmação alimenta o estoque "central" de pães. Esta PR estabelece a infra de stock e captura no forno.

PR seguintes consomem essa infra:
- **PR-B2:** `/romaneio` enviado → debita central, credita loja destino
- **PR-B3:** `/sobras` descarte → debita loja (precisa `app_users.store`)
- **PR-B4:** Tela de visibilidade de estoque por loja
- **PR-B5:** Sub-locais (freezers nomeados por loja: EX-Freezer-1..4, JA-Freezer-1)

PR-C (`/relatorios/producao`) consome `production_actuals` pra comparativo pedido × realizado.

## Decisões já tomadas

- ✅ PRs sequenciais (B, B2, B3, ...)
- ✅ Pães PJ incluídos no /forno (orders.is_pj=true com pj_delivery_date=hoje)
- ✅ Descarte no forno tem motivo (Queimou / Fora do padrão / Outros)
- ✅ Cada usuário tem loja física (definir no PR-B3 via `app_users.store`)
- ✅ Stock por loja (cada loja é independente — definir no PR-B2/B3)
- ✅ EX tem 4 freezers; JA tem 1 (definir nomes no PR-B5)

## Plano (PR-B atual)

### 1. Schema (Supabase via MCP)

- [x] **`production_actuals`** — registro do que Sander confirmou (audit + UNIQUE por dia+pão)
  ```sql
  CREATE TABLE production_actuals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_date date NOT NULL,
    bread_id text NOT NULL REFERENCES breads(id),
    quantity_baked numeric NOT NULL DEFAULT 0,
    quantity_loss numeric NOT NULL DEFAULT 0,
    loss_reason text,
    recorded_by text NOT NULL,
    obs text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (bread_id, record_date)
  );
  CREATE INDEX idx_prod_actuals_date ON production_actuals(record_date);
  ```

- [x] **`bread_movements`** — log de TODAS as movimentações de pão (forno+, romaneio-, descarte-, ajuste)
  ```sql
  CREATE TABLE bread_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_type text NOT NULL,
      -- 'forno_entrada': +N em central (PR-B)
      -- 'forno_descarte': -N em central (PR-B)
      -- 'romaneio_envio': -N em central + +N em loja (PR-B2)
      -- 'descarte_loja': -N em loja (PR-B3)
      -- 'ajuste': +/-N manual (futuro)
    bread_id text NOT NULL,
    location text NOT NULL, -- 'central' | 'jc' | 'ja' | 'ex' | 'pj'
    quantity numeric NOT NULL, -- positive=entrada, negative=saída
    reference_id text, -- id do registro de origem (production_actuals.id, etc)
    reference_type text,
    recorded_by text NOT NULL,
    obs text,
    created_at timestamptz DEFAULT now()
  );
  CREATE INDEX idx_bread_mov_location_bread ON bread_movements(location, bread_id);
  CREATE INDEX idx_bread_mov_date ON bread_movements(created_at DESC);
  ```

### 2. Módulo `/forno/page.tsx`

- [x] Date picker no topo (default hoje; permite últimos 7 dias)
- [x] Carrega:
  - Pães regulares com `orders.quantity > 0` na data (sum por bread_id)
  - Pães PJ com `orders.pj_delivery_date = data` e quantity > 0
  - `production_actuals` existentes pra essa data (pra pré-preencher)
- [x] Linha por pão:
  - Nome do pão (+ badge "PJ" se for is_pj)
  - **Planejado:** soma `orders.quantity` na data
  - **Assado:** input numérico (-/+ buttons + número), pré-preenchido com planejado OU com production_actuals.quantity_baked se já registrado
  - **+ Registrar descarte** (collapsed por default; expande pra mostrar input qtd + select de motivo)
- [x] Botão **"💾 Salvar produção do dia"**:
  - Upsert em `production_actuals` (uma linha por pão)
  - Insert em `bread_movements`: 1 `forno_entrada` (quantity=+baked) + 1 `forno_descarte` (quantity=-loss) por pão com valores > 0
  - Idempotência: deletar `bread_movements` antigos da data antes de inserir os novos (re-save substitui)
- [x] Toast de sucesso/erro
- [x] Header: nome do usuário logado (recorded_by)

### 3. Nav + permissões

- [x] [src/components/Nav.tsx](src/components/Nav.tsx): adicionar `/forno` com ícone 🔥
- [x] [src/lib/auth.ts](src/lib/auth.ts) `DEFAULT_ROUTES_BY_ROLE.producao`: incluir `/forno`
- [x] [src/app/admin/usuarios/page.tsx](src/app/admin/usuarios/page.tsx) `ROUTE_OPTIONS`: adicionar `/forno`
- [x] SQL: ativar Sander + setar routes (`/forno` + talvez `/` para ver pedidos pra contextualizar)
- [x] SQL: adicionar `/forno` às routes de Geolar e admins (Rodrigão/Suélen)

### 4. Verificação

- [x] `npx tsc --noEmit` verde
- [x] `npm run build` verde — `/forno` prerenderizada
- [x] SQL: confirmar tabelas criadas + indexes
- [x] Teste manual (Rodrigão admin):
  - Abre `/forno`
  - Vê pães do dia com planejado correto
  - Ajusta "Assado" + adiciona "Descarte" com motivo
  - Salva
  - Recarrega → valores persistem
  - SQL via MCP: confere `production_actuals` (1 linha por pão) e `bread_movements` (forno_entrada + forno_descarte)
  - Re-save com valores diferentes → bread_movements substituído (idempotente)

## Fora de escopo (PR-B)

- **Per-loja stock** (PR-B2/B3): forno só alimenta `central`. Lojas têm stock próprio que romaneio/descarte mexem.
- **Per-user loja mapping** (PR-B3): `app_users.store` ainda não existe; vem com sobras/descartes.
- **Freezers nomeados** (PR-B5): EX-Freezer1..4, JA-Freezer1.
- **Tela de visibilidade de estoque** (PR-B4): saber "quanto tem onde" agora. PR-B só GRAVA, não LÊ saldo.
- **Múltiplos turnos** (manhã/tarde): 1 registro por pão por dia. Re-save substitui.
- **Relatório de produção** (PR-C): pedido × realizado. Próximo.
- **Alerta automático de divergência** ("planejado 50, assado 10 — confirma?"): UX nice-to-have, futuro.
- **Edit histórico granular**: date picker permite voltar 7 dias, mais que isso só via SQL.

## Estimativa

| Item | Linhas |
|---|---|
| Migration SQL (2 tabelas + indexes) | ~30 |
| `src/app/forno/page.tsx` (novo) | ~280 |
| `src/components/Nav.tsx` (+1 link) | +1 |
| `src/lib/auth.ts` (+1 entrada DEFAULT_ROUTES) | +1 |
| `src/app/admin/usuarios/page.tsx` (+1 ROUTE_OPTIONS) | +1 |
| SQL: ativar Sander + UPDATE routes Sander/Geolar/admins | 1 statement |
| **Total** | **~315 linhas** |

## Notas durante execução

- (preenchido conforme avanço)
