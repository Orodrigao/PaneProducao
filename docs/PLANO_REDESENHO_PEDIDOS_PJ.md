# Plano — Redesenho da lista de Pedidos PJ

**Status:** aprovado por Rodrigo em 2026-07-20. Fase 1 implementada e
verificada; aguardando merge. Fase 2 ainda não aprovada para execução.
**Executor:** Codex, uma fase por conversa e por PR.
**Origem:** a lista atual não permite buscar cliente, mistura pedidos abertos
e antigos e coloca as entregas mais distantes antes das mais urgentes.

## Decisões aprovadas

1. A busca principal é pelo nome do cliente, aceita nome incompleto e ignora
   diferenças de maiúsculas e acentos.
2. A busca procura em pedidos abertos e no histórico ao mesmo tempo.
3. O uso principal da tela é localizar pedidos que ainda precisam passar
   pela operação.
4. A fila principal se chama **Em aberto**, pois o sistema ainda não registra
   o instante em que a produção termina.
5. Um pedido sairá da fila somente quando a Expedição da JC marcar **Enviado**.
6. Na futura visão da Expedição, preços e totais não serão exibidos. Ela verá
   somente cliente, produtos, quantidades, datas e observações.
7. Somente a Expedição da JC poderá confirmar o envio.

## Fase 1 — Organização e busca

**Objetivo:** tornar a localização e a priorização de pedidos claras sem
alterar banco, permissões ou dados salvos.

**Escopo:**

- abrir a tela pela lista, preservando a criação de pedido em uma ação clara;
- busca global pelo nome do cliente;
- separar **Em aberto** de **Histórico**;
- ordenar os abertos pela produção mais próxima;
- dividir os abertos em atrasados, produção de hoje, amanhã e próximas datas;
- mostrar cartões compactos no celular e linhas compactas no computador;
- preservar criação, visualização, edição, adiantamento e cancelamento.

**Regra temporária de histórico:** enquanto a Fase 2 não existe, cancelados e
pedidos com entrega anterior a hoje ficam no histórico. Os demais ficam em
aberto. Essa regra será substituída pelo envio confirmado na Fase 2.

**Fora do escopo:** banco, RLS, acesso da Expedição, confirmação de envio e
alterações em Encomendas.

**Riscos:** esconder um pedido urgente por classificação ou ordem incorreta;
uma busca global não deixar claro se o resultado está aberto ou no histórico;
prejudicar as ações existentes ao reorganizar a página.

**Critérios de aceite:**

- a lista abre por padrão e mostra pedidos abertos antes do histórico;
- produção vencida aparece antes de hoje, amanhã e datas futuras;
- dentro de cada grupo, a produção mais próxima aparece primeiro;
- buscar parte do nome, com ou sem acento, encontra o cliente nas duas listas;
- cada resultado da busca identifica se está em aberto ou no histórico;
- as ações atuais continuam funcionando;
- estados de carregamento, vazio e busca sem resultado são claros;
- `npm run lint`, `npx tsc --noEmit`, `npm test` e `npm run build` passam;
- fluxo completo conferido no navegador em computador e celular.

**Rollback mental:** reverter somente o frontend devolve a lista antiga; não
há migration nem transformação de dados.

## Fase 2 — Envio controlado pela Expedição da JC

**Status:** descoberta concluída, não aprovada para execução.

**Objetivo:** registrar o despacho e mover o pedido para o histórico.

**Escopo previsto:** registro de envio por pedido, ação segura e repetível
**Marcar como enviado**, visão operacional sem valores e acesso restrito à
Expedição da JC. O banco deve permitir somente essa ação, sem liberar edição
de cliente, itens, quantidades, preços ou cancelamento.

**Tratamento dos pedidos antigos:** manter pedidos antigos no histórico sem
inventar horário ou responsável por um envio que nunca foi registrado.

**Gate:** migration, função segura e mudança de acesso exigem plano técnico e
novo OK explícito de Rodrigo antes da implementação e antes da aplicação em
produção.
