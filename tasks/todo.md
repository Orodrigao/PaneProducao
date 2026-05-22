# TODO — PR-B3: app_users.store + /sobras unifica auth + descarte de pão move estoque

**Criado:** 2026-05-21
**Status:** done (PR-B3 código pronto; aguardando teste manual; PR-B4 do estoque-por-loja é o próximo)

## Contexto / objetivo

Hoje `/sobras` tem seletor interno paralelo (mesmo bug do / e /romaneio), `responsible` é string editável, e descarte não move estoque. Esta PR fecha 3 lacunas de uma vez:

1. Adiciona **loja física** a cada usuário (jc/ja/ex/null)
2. Refactor do `/sobras` pra usar PIN global (anti-impersonation)
3. Descarte de **pão** (`product_source='bread'`) gera `bread_movements` (-N na loja do usuário)

Descarte de produtos não-pão (catálogo) continua só registrado em `descartes`. Stock infra pra catálogo fica pra PR futura quando o catalog production tiver fluxo.

## Decisões já tomadas

- ✅ Refactor /sobras incluído (vale o custo extra pra ter loja confiável)
- ✅ Só pão move estoque por enquanto
- ✅ Mapeamento de loja:
  - **EX:** Marselle + novo user "Atendente EX"
  - **JA:** novo user "Cléo" (atendente JA + motorista JC)
  - **JC:** Liara, Samuel, Rose, Fran, Geolar, Sander, Gustavo, Elis
  - **NULL:** Rodrigão, Suélen (admins, sem loja física)

## Plano

### 1. Schema + dados via SQL

- [x] `ALTER TABLE app_users ADD COLUMN store text` (nullable)
- [x] INSERT user `atendente_ex`: role='expedicao', pin='1010', routes=`['/sobras', '/estoque-congelado']`, store='ex'
- [x] INSERT user `cleo`: role='expedicao', pin='2020', routes=`['/romaneio', '/sobras', '/estoque-congelado']`, store='ja'
- [x] UPDATE store=`ex` em marselle
- [x] UPDATE store=`jc` em liara, samuel, rose, fran, geolar, sander, gustavo, elis
- [x] Rodrigão/Suélen ficam com store=NULL (admins)

### 2. Backend ([src/lib/auth.ts](src/lib/auth.ts))

- [x] Interface `AppUser` ganha `store?: string | null`
- [x] Interface `SBUser` ganha `store?: string | null`
- [x] `fetchUsersFromSupabase` mapeia `store` do DB
- [x] `createUserInSupabase` aceita `store` opcional no body
- [x] `updateUserInSupabase` aceita `store` no Partial

### 3. UI admin/usuarios ([src/app/admin/usuarios/page.tsx](src/app/admin/usuarios/page.tsx))

- [x] EditUserModal: dropdown de loja (`jc | ja | ex | (sem loja)`)
- [x] NewUserModal: mesmo dropdown
- [x] handleEdit e handleCreate passam `store` no payload

### 4. Refactor /sobras ([src/app/sobras/page.tsx](src/app/sobras/page.tsx))

- [x] Remover constante `USERS = ['Suélen','Liara',...]`
- [x] Remover tela de selector de usuário
- [x] Usar `getCurrentUser()` do auth global; `responsible` agora vem do `user.displayName`
- [x] Tela inicial vai direto pra selector de modo (Sobras / Descartes)
- [x] AuthGuard já protege a rota (não precisa re-check)

### 5. Movimento de estoque no descarte de pão

- [x] No `save()` do /sobras quando `mode === 'descarte'`:
  - Buscar `user.store` do user logado
  - Se store está set E item.product_source === 'bread' E quantity > 0:
    - Após insert em `descartes`, gera `bread_movements`: `quantity: -N`, `location: store`, `movement_type: 'descarte_loja'`, `reference_type: 'descarte'`, `reference_id: <descarte.id>`
  - Se store é null (admin/Sander/Rodrigão registrando teste): pula movement, registra apenas em `descartes`. Log no console.
  - Items de catálogo: continuam só em `descartes`, sem movement.

### 6. Bonus: Cléo no romaneio ([src/app/romaneio/page.tsx](src/app/romaneio/page.tsx))

- [x] No useEffect de auto-resolve, adicionar `else if (globalUser.id === 'cleo') internalRole = 'cleo'` antes do fallback expedicao→gustavo. Permite Cléo logar e marcar romaneios como enviado (papel dela).

### 7. Verificação

- [x] `npx tsc --noEmit` verde
- [x] `npm run build` verde
- [x] SQL: confirmar coluna `store` populada nos usuários certos
- [x] Teste manual eu rodo via SQL (criar descarte de pão como user da JC, verificar movement em location='jc')

## Fora de escopo

- **Catalog stock** (cookies, bolos, focaccias): descartes desses produtos ainda só são registrados, não movem estoque. Fica pra PR futura quando criar `catalog_movements`.
- **Sobras** continuam não movendo estoque (decisão do usuário: sobras podem ser reaproveitadas).
- **PR-B4** (tela de saldo por loja): próximo.
- **PR-B5** (sub-locais tipo EX-Freezer-1..4): futuro, fora desta sequência.

## Estimativa

| Item | Linhas |
|---|---|
| SQL (ALTER + 2 INSERT + UPDATEs) | ~12 statements |
| auth.ts | +15 |
| admin/usuarios EditUserModal+NewUserModal | +30 |
| sobras refactor + movement logic | ~80 (remove +50 / adiciona +130) |
| romaneio (Cléo mapping) | +1 |
| **Total** | **~125 linhas** |

## Notas durante execução

- (preenchido conforme avanço)
