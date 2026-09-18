# Plano — Redesenho da lista de Pedidos PJ

**Status:** Fase 1 concluída. Fase 2 aprovada por Rodrigo em 2026-07-21,
implementada em branch e com a migration aplicada em produção. A matriz do
banco e a matriz no navegador passaram; o frontend está pronto para liberação
após a incorporação do PR. A Fase 2B foi aprovada e implementada na mesma
branch: o checkbox da Tela de Usuários agora controla menu e rota de Pedidos PJ.
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

**Status:** migration aplicada em produção em 2026-07-21. A matriz do banco
passou para Expedição JC e Administrador, e o bloqueio de um perfil de Vendas
passou no navegador. Rodrigo confirmou um envio real no preview e a Expedição
viu o pedido no Histórico, sem valores, com data e responsável corretos.

**Objetivo:** registrar o despacho e mover o pedido para o histórico.

**Escopo previsto:** registro de envio por pedido, ação segura e repetível
**Marcar como enviado**, visão operacional sem valores e acesso restrito à
Expedição da JC. O banco deve permitir somente essa ação, sem liberar edição
de cliente, itens, quantidades, preços ou cancelamento.

**Tratamento dos pedidos antigos:** manter pedidos antigos no histórico sem
inventar horário ou responsável por um envio que nunca foi registrado.

**Fora do escopo:** histórico operacional na tela de Romaneios. A tela atual
continua mostrando os romaneios do dia; o relatório de faturamento permanece
separado.

**Critérios de aceite:**

- somente a Expedição da JC vê e executa **Marcar como enviado**;
- a Expedição recebe cliente, itens, quantidades, datas e observações, sem
  preços, e não consegue contornar essa restrição consultando o Pedido PJ
  diretamente;
- Administração e Financeiro preservam criação, edição, adiantamento,
  cancelamento e valores, mas não confirmam o envio;
- pedido enviado vai imediatamente para o histórico, guarda data e responsável
  e não pode mais ser alterado ou cancelado;
- repetir a confirmação devolve o mesmo envio, sem duplicar ou corromper dados;
- perfis fora da Expedição da JC são bloqueados pela ação protegida do banco.

**Gate:** o OK para implementar e o OK separado para aplicar a migration em
produção foram dados em 2026-07-21. A matriz permitida e bloqueada foi concluída
no banco e no navegador; o frontend está pronto para incorporação.

## Fase 2B — Acesso pela Tela de Usuários

**Status:** aprovada, implementada e validada em 2026-07-21. Testes
automatizados, auditoria somente leitura de produção e matriz no preview
passaram para Expedição JC, Marselle/Vendas EX, Elis/Financeiro e Administrador.
Pronta para incorporação do PR.

**Problema:** a Tela de Usuários já exibe `Acessar Pedidos PJ` e `Confirmar
envio de Pedido PJ`, mas hoje grava somente a permissão granular. Menu e guarda
de rota continuam lendo `allowed_routes`, portanto uma concessão futura pode
deixar o usuário com o checkbox marcado e sem conseguir abrir a tela.

**Escopo proposto:** fazer somente `/pedidos-pj` derivar o acesso da permissão
`pedidos_pj.acessar`, preservando no banco a restrição de confirmação à
Expedição JC. Testar concessão e retirada com Admin, Expedição JC e um perfil
bloqueado. Não exige nova migration nem escrita adicional em produção.

**Resultado:** a sessão autenticada passa a ler a concessão atual do próprio
usuário e reconcilia somente `/pedidos-pj`. Administradores preservam acesso
total. A Tela de Usuários reconhece corretamente as concessões de acesso e de
confirmação de envio da Expedição limitadas à JC; cada checkbox pode ser
retirado sem apagar a outra permissão.
