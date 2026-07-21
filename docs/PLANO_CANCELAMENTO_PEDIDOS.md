# Plano — Cancelamento de pedidos (PJ e Encomendas)

**Status:** aprovado por Rodrigo em 2026-07-20. Aguardando execução.
**Executor:** Codex (uma fase por conversa/PR). Revisão técnica de cada PR
antes do teste do Rodrigo.
**Origem:** Elis sentiu falta de um botão para cancelar pedido — hoje há
Editar, mas não há Cancelar em Pedidos PJ nem em Encomendas.
**Vigência:** mover para `docs/history/` quando as fases 1 e 2 estiverem na
`main`.

---

## Decisões aprovadas (não rediscutir durante a execução)

1. **Cancelar, nunca apagar.** O pedido cancelado permanece no banco e na
   lista com selo "cancelado"; sai de todas as contas operacionais.
2. **Identidade do pedido.** Nova coluna `order_group_id` (uuid) amarra as
   linhas de um mesmo pedido. Corrige o risco de cancelar/editar dois
   pedidos fundidos.
3. **Trava de horário.** Cancelamento permitido **até as 5h da manhã do dia
   de produção** do pedido (produção começa às 6h; cancelar depois só gera
   sobra disfarçada). Encomenda sem produção (`needs_production = false`) ou
   sem `production_date`: vale 5h do dia da **entrega**.
4. **Depois das 5h:** botão desabilitado com mensagem de caminho de
   resolução: "Produção deste pedido já iniciou. Cancelamento encerrou às
   5h de [data]. Fale com o Rodrigo." (lição `sobras-pendentes-sem-saida`:
   bloqueio sempre aponta a saída). Cancelamento real tardio vira sobra e é
   tratado no fluxo de Sobras existente.
5. **Quem cancela = quem edita hoje** (nenhuma mudança de RLS): admin e
   financeiro cancelam PJ e encomendas; vendas cancela só encomendas. Já
   coberto pela policy `orders_update_authenticated_profiles`
   (migration `20260624151146`).
6. **Motivo obrigatório**, texto curto de uma linha.
7. **Escopo:** somente `order_type` `pj` e `encomenda`. Os pedidos diários
   de loja (tela raiz, delete-and-replace por `store + order_date`) ficam
   fora.
8. **Trava só na interface** (relógio do dispositivo). Reforço no banco
   (trigger/RLS) é risco alto e só entra se a prática mostrar necessidade.

## Fatos da auditoria (2026-07-20) — leia antes de codar

- `orders` guarda **uma linha por item**; "o pedido" não existe como
  registro. As telas agrupam por chave
  `customer_id|pj_client + order_date + delivery_date`
  ([pedidos-pj/page.tsx:269](../src/app/pedidos-pj/page.tsx), agrupamento
  análogo em encomendas). Dois pedidos do mesmo cliente com as mesmas datas
  aparecem fundidos — o **Editar atual já sofre disso**.
- O Editar atual **insere as linhas novas e depois apaga as antigas** por
  lista de ids (`pedidos-pj/page.tsx:230-232`, `encomendas/page.tsx:181-184`).
  Manter essa ordem; a fase 1 só troca a forma de identificar o grupo.
- **Consumidores de `orders` que precisam ignorar cancelados (fase 2).**
  Esquecer um deles = pão assado para pedido cancelado:
  1. `src/app/forno/page.tsx` — 3 queries (loja, PJ, encomenda);
  2. `src/app/page.tsx` (tela raiz) — 3 leituras via `sbGet` REST
     (linhas ~169, ~240, ~241); a sintaxe REST é `cancelled_at=is.null`;
  3. `src/app/romaneio/page.tsx` — `buildDraftForDest` (~linha 462, também
     `sbGet`); lição `romaneio-lista-vem-do-pedido` se aplica;
  4. `src/app/sobras/page.tsx` e `src/app/sobras/pendencias/page.tsx`;
  5. `src/app/relatorios/pj/page.tsx` — cancelado sai do faturamento.
  As listas de `pedidos-pj` e `encomendas` **continuam mostrando**
  cancelados (com selo) — não filtrar lá.
- RLS de `orders`: migration `20260624151146`. UPDATE já cobre os perfis da
  decisão 5. Não mexer em policies neste plano.
- `src/lib/database.types.ts` está obsoleto e não é usado pelo cliente
  Supabase — não tentar regenerar nesta tarefa.

---

## Fase 1 — Identidade do pedido (`order_group_id`)

**Objetivo:** cada pedido PJ/encomenda passa a ter etiqueta única; listas e
Editar param de fundir pedidos distintos. Nenhuma mudança visual além da
separação correta.

**Escopo / arquivos prováveis:**

- 1 migration nova em `supabase/migrations/`:
  - `alter table public.orders add column order_group_id uuid,
    add column cancelled_at timestamptz, add column cancelled_by text,
    add column cancel_reason text;` (as 3 colunas de cancelamento já nascem
    aqui para não tocar produção duas vezes);
  - índice em `order_group_id`;
  - backfill: um uuid por grupo existente com `order_type in
    ('pj','encomenda')`, agrupando pela chave legada
    (`coalesce(customer_id::text, pj_client, '') + order_date +
    coalesce(delivery_date, '')` — para PJ; encomendas incluem
    `walkin_name`). Pedidos legados fundidos permanecem fundidos: não há
    como separar retroativamente o que nunca foi distinguido. Sem
    `not null` (pedidos diários de loja ficam com `null`).
- `src/app/pedidos-pj/page.tsx` e `src/app/encomendas/page.tsx`:
  - ao salvar pedido novo: `crypto.randomUUID()` único para todas as linhas;
  - agrupamento da lista: por `order_group_id` quando presente; fallback na
    chave legada para linhas antigas sem etiqueta;
  - Editar: preservar o `order_group_id` do grupo (as linhas novas herdam a
    etiqueta); manter insert-antes-de-delete.

**Riscos:** migration em produção (aditiva, reversível — colunas novas, sem
apagar nada). Código deve funcionar com mistura de linhas com e sem
etiqueta.

**Rollback mental:** colunas novas ignoradas pelo código antigo; reverter o
frontend basta para voltar ao comportamento atual.

**Critérios de aceite:**

- dois pedidos novos, mesmo cliente, mesma entrega, mesmo dia → dois cartões
  separados; editar um não altera o outro;
- pedidos antigos continuam aparecendo e editáveis como antes;
- `npm run lint && npx tsc --noEmit && npm test && npm run build` verdes;
  fluxo completo testado no navegador.

**Gate:** a migration **só é aplicada em produção com OK explícito do
Rodrigo**, pedido em linguagem leiga no PR.

**Roteiro de teste (Rodrigo, celular):**

1. Em Pedidos PJ, crie dois pedidos para o mesmo cliente com a mesma data de
   entrega. Confira: dois cartões separados na Lista.
2. Edite um deles (mude quantidade). Confira que o outro não mudou.
3. Abra um pedido antigo (anterior à mudança) e confira que abre e edita
   normal.
4. Repita 1–2 em Encomendas.

---

## Fase 2 — Botão Cancelar com trava de 5h

**Objetivo:** cancelar mantendo histórico, com a trava da decisão 3.

**Ordem interna obrigatória:** primeiro os filtros nos 5 consumidores
(inofensivo enquanto nada está cancelado), depois o botão. Nunca deve
existir versão em que um pedido cancelado ainda conta no Forno.

**Escopo / arquivos prováveis:** os 5 consumidores listados na auditoria +
`pedidos-pj/page.tsx` + `encomendas/page.tsx`.

**Comportamento:**

- Botão "Cancelar pedido" no modal de visualização das duas telas.
- Habilitado enquanto `agora < 05:00 do dia de produção` (fallback entrega,
  decisão 3). Depois: desabilitado com a mensagem da decisão 4.
- Confirmação explícita + campo de motivo obrigatório.
- Ação: `update` das linhas do grupo com `cancelled_at = now()`,
  `cancelled_by` (displayName do usuário logado), `cancel_reason`.
  Sem delete.
- Grupo cancelado na lista: selo "cancelado", visual riscado/acinzentado,
  modal somente leitura (sem Editar, Adiantar ou toggle de produção).
- Consumidores: excluir `cancelled_at is null` em todas as queries listadas.

**Critérios de aceite:**

- pedido cancelado some do Forno, tela raiz, Romaneio, Sobras e Relatório
  PJ; permanece na lista de origem com selo, itens, valores e motivo;
- pedido com produção hoje, depois das 5h: botão desabilitado com mensagem;
- matriz de perfis testada no navegador: vendas cancela encomenda e **não**
  cancela PJ; admin cancela ambos (regra do AGENTS.md: mínimo um perfil que
  pode E um que não pode);
- estados de carregamento, erro e repetição de ação (duplo toque no
  Cancelar não pode dar erro nem duplo registro);
- comandos de verificação verdes.

**Roteiro de teste (Rodrigo, celular):**

1. Crie um pedido PJ de teste com produção amanhã. Veja a quantidade
   aparecer no Forno de amanhã.
2. Cancele o pedido (informe um motivo). Confira que sumiu do Forno, da tela
   inicial e da lista do Romaneio, mas continua na lista de Pedidos PJ com
   selo "cancelado" e o motivo visível.
3. Entre como **vendas** (perfil da Elis): cancele uma encomenda de teste;
   confira que em Pedidos PJ não existe botão de cancelar habilitado.
4. Pegue um pedido cuja produção é hoje (depois das 5h): o botão deve estar
   desabilitado com a mensagem explicando o horário.
5. Confira no Relatório PJ que o pedido cancelado não soma no faturamento.

---

## Fase 3 — Refinos (não aprovada ainda; decidir após uso real)

Candidatos: linha própria de cancelamentos no Relatório PJ; exceção de
admin para cancelamento tardio integrada ao fluxo de Sobras; reforço da
trava no banco. Nenhum item desta fase entra sem novo plano aprovado.

---

## Regras de processo para o executor

- Branch `codex/<descricao-curta>` a partir de `origin/main` atualizado; uma
  fase por branch/PR; PR sempre **draft**; commits pequenos em português.
- Seguir integralmente `AGENTS.md` (verificação, matriz perfil × loja,
  template de PR, entrega com roteiro de teste em linguagem leiga).
- Migration em produção, mudança de RLS ou dependência nova: **parar e
  pedir OK explícito ao Rodrigo**.
- Risco fora do escopo encontrado no caminho: reportar, não resolver junto.
