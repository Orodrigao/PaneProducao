# TODO — PR-C5: Fechar Encomendas

**Objetivo:** completar o módulo `/encomendas` com as peças que faltam para uso operacional real: status de retirada/cancelamento, acesso para o role `vendas`, e limpeza da lista. O núcleo funcional (criar, editar, toggle balcão/produção, cupom) já está entregue.

**Estado atual:**
- `/encomendas/page.tsx` — criação, edição, toggle balcão/produção, cupom térmico, aviso do dia ✅
- Sem coluna `status` em `orders` (confirmado via database.types.ts)
- Acesso: só `admin` + `financeiro` (vendas não consegue registrar encomenda no balcão)
- Lista filtra por `delivery_date >= hoje` — encomendas passadas somem silenciosamente

---

## Fase A — Schema: coluna `status` em `orders`

- [ ] **A1** — Migration:
  ```sql
  ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS enc_status text
      CHECK (enc_status IN ('pendente','entregue','cancelada'))
      DEFAULT 'pendente';
  ```
  Nome `enc_status` (não `status`) para não colidir com outros `status` text livres
  que possam existir ou serem adicionados futuramente em outros `order_type`.
  Sem retroativos — nulls e rows antigas ficam `pendente` pelo default.
- [ ] **A2** — Regenerar `database.types.ts` via `supabase gen types`.
- [ ] **A3** — Atualizar interface `OrderRow` em `encomendas/page.tsx` para incluir
  `enc_status: string | null`.

**Saída da Fase A:** banco pronto, tipos corretos. UI ainda sem mudança visível.

---

## Fase B — UI: status na lista + ações no modal

- [ ] **B1** — `groupStatus()` incorpora `enc_status`:
  - `entregue` → chip verde-sage "entregue", borda sage
  - `cancelada` → chip berry "cancelada", borda berry, card com opacidade reduzida
  - `pendente` lógica atual (agendada/pra hoje/atrasada) inalterada

- [ ] **B2** — Lista: por padrão mostra só `pendente` nos próximos N dias (comportamento
  atual). Adicionar toggle "📋 Ver histórico" que amplia a query para incluir
  `entregue` e `cancelada` dos últimos 30 dias (sem paginação por ora).

- [ ] **B3** — Modal de visualização: dois novos botões abaixo do toggle balcão/produção:
  - **"✅ Marcar retirada"** — `UPDATE enc_status='entregue'` nas linhas do grupo;
    fecha o modal e atualiza a lista local (remove do view default).
  - **"🗑 Cancelar encomenda"** — com confirm "Cancelar esta encomenda?" →
    `UPDATE enc_status='cancelada'`; fecha modal.
  - Ambos desabilitados se `enc_status` já for `entregue` ou `cancelada`.
  - Botão "Editar" fica oculto quando `enc_status != 'pendente'` (não faz sentido
    editar o que já saiu).

- [ ] **B4** — Aviso do dia no topo (`encomendasHoje`) filtra só `enc_status='pendente'`
  para não contar entregues que ainda estão dentro da janela de hoje.

**Saída da Fase B:** operação completa. Atendente registra retirada ou cancela sem
perder o histórico.

---

## Fase C — Acesso: role `vendas`

- [ ] **C1** — Em `src/lib/auth.ts`, adicionar `/encomendas` ao array
  `DEFAULT_ROUTES_BY_ROLE.vendas`.
  ```ts
  vendas: ['/', '/sobras', '/romaneio', '/encomendas'],
  ```
- [ ] **C2** — Atualizar fallback `USERS_FALLBACK` do usuário `vendas1` para refletir
  a nova rota (mesmo array).
- [ ] **C3** — Não há restrição de escrita por role dentro da tela —
  `vendas` pode criar, editar e marcar retirada. Isso é o comportamento desejado
  (atendente no balcão precisa das três ações).

**Saída da Fase C:** atendente de vendas consegue registrar e fechar encomendas.

---

## Fora de escopo (decidir depois)

- **Relatório de encomendas** em `/relatorios` — valor real quando o volume crescer.
  Por ora, a lista com histórico (B2) já dá visibilidade suficiente.
- **Filtro `is_special` no catálogo** — o spec original dizia "pode usar", não
  "filtrar só". Catálogo atual (todos os ativos) funciona. Não mudar sem validar
  se o usuário quer restringir.
- **Needs_production em database.types.ts** — a coluna existe no banco mas sumiu
  na última geração dos tipos. Fase A2 deve consertar ao regenerar.

---

## Validação antes de codar

1. Confirmar nome `enc_status` ou prefere simplesmente `status` (se não há risco de
   conflito com PJ/forno)?
2. Role `vendas` acessa `/encomendas` somente leitura ou criação também? (plano assume
   criação — confirmar com Rodrigão se faz sentido operacional)
