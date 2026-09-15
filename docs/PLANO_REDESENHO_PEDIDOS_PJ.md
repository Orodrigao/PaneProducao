# Plano — Fluxo completo de Pedidos PJ

**Referência:** 2026-09-07, código em `c773e430f43ae307febda65f2ea7787e357d8791`.
**Estado:** decisões operacionais consolidadas; fases propostas, ainda sem
aprovação para implementar. Esta revisão é somente documentação.
**Risco da implementação:** alto, por alterar cobrança e autorização de saída.
**Fontes das decisões:** conversa `01a07b68-b201-79c1-977a-ebe41b5651da`
e continuação `01a07db8-46aa-7c53-9880-f99761bb9c4d`, em 07/09.

Este documento atualiza o plano de redesenho existente. As etapas antigas de
busca, lista e envio foram incorporadas ao produto; seu texto anterior permanece
no histórico Git. A regra antiga de a Expedição marcar o pedido como enviado
não define o desenho novo abaixo. A cobrança pelo conferido já implementada
é descrita em [QUANTIDADE_ENVIADA_PEDIDOS_PJ.md](QUANTIDADE_ENVIADA_PEDIDOS_PJ.md).
Os registros datados daquele documento não substituem as decisões de 07/09.

## Problema e resultado esperado

A equipe precisa trocar de tela para entender um pedido. Conferência normal de
peso parece correção de erro, e o pedido pode parecer encerrado enquanto a Elis
ainda precisa agir. Rodrigo quer uma visão que explique o que aconteceu, o que
falta e quem resolve, mantendo o pedido como referência durante todo o fluxo.

A prioridade é concluir o fluxo PJ antes das correções gerais da auditoria.
Encomendas de balcão, abastecimento das lojas e emissão fiscal externa não são
redesenhados nesta frente. PJ é canal de pedido, não unidade; as lojas são
JC, JA e EX. A Expedição tratada neste fluxo é a da JC.

## Decisões confirmadas

1. Elis registra o pedido; a Produção prepara; a Expedição confere unidades e
   pesos reais. Conferir 3,120 kg para um pedido de 3 kg é uma etapa normal.
2. O cadastro mostra a estimativa de valor discretamente, identificada como
   estimativa. A Expedição recebe quantidades e pesos, sem dados financeiros.
   Na revisão, Elis vê pedido, conferido, preços e valor final.
3. A cobrança só nasce quando Elis confirma. Conferência da Expedição não pode
   gerar cobrança automaticamente no fluxo novo.
4. Elis emite a NF no sistema externo, sem integração. No ERP confirma
   manualmente que a NF foi emitida e está disponível para acompanhar o pedido.
   Não exigir número, arquivo ou anexo; o ERP não comprova a emissão externa.
5. A ação de Elis é **Confirmar cobrança e liberar entrega/coleta**. Antes
   dela o pedido pode estar pronto fisicamente, mas permanece bloqueado para
   saída. A Expedição registra a saída em uma ação posterior.
6. Operação e pagamento são situações distintas. Liberado não significa pago;
   saída registrada não comprova recebimento pelo cliente.
7. Uma aba **Pendências** deve mostrar o que falta, responsável e ação. O
   detalhe do pedido concentra a compreensão e as ações da conferência e da
   revisão comercial, respeitando as permissões existentes de cada pessoa.
8. Entregar menos pode encerrar o atendimento sem saldo automático. Exemplo:
   40 brioches pedidos, 38 disponíveis, cobrança de 38 e diferença registrada.
9. Zero não encerra nem cancela automaticamente. Se ainda houver compromisso,
   o mesmo pedido continua pendente ou é reprogramado. A data originalmente
   combinada e o motivo da mudança devem permanecer identificáveis. O
   encerramento sem entrega precisa de decisão expressa, com motivo.
10. Quantidade corrigida depois da liberação, mas antes da saída, bloqueia
    novamente a saída e exige nova revisão da cobrança/NF e liberação de Elis.
11. O prazo de pagamento começa na **data combinada de entrega/coleta**,
    nunca na data em que Elis antecipou a confirmação. Dia 10 + prazo de 7 dias
    resulta em vencimento dia 17. Reprogramação posterior não altera um
    vencimento aceito silenciosamente; sua regra específica ainda será fechada.
12. Se houve pagamento a maior, a rotina informada é devolução por Pix. Com NF
    emitida e cliente recorrente, pode ser proposto crédito para o próximo
    pedido, com aceitação do cliente. Compra única exige o tratamento fiscal
    no sistema externo e correção do valor no ERP. Preservar o pagamento real.
13. Crédito é raro e nunca ocorreu no PJ, segundo Rodrigo. Adotar o caminho
    mínimo: Elis controla o saldo fora do ERP; no pedido seguinte registra
    abatimento em reais, pedido de origem e justificativa. Sem carteira, saldo
    automático, consumo automático ou extensão para balcão nesta frente.
    Separar abatimento de crédito anterior de desconto comercial; preservar
    valor dos produtos e valor líquido a cobrar. É exceção secundária.

## Jornada pretendida

| Momento | Responsável | Situação/ação visível |
| --- | --- | --- |
| Cadastro | Elis/comercial autorizado | Pedido registrado e entrega combinada |
| Programação | Produção | Programação pendente ou registrada, sem presumir execução pela data |
| Separação | Expedição JC | Conferir quantidades; permitir salvar parte sem concluir |
| Conferência concluída | Elis | Aguardando revisão da cobrança e confirmação da NF; saída bloqueada |
| Revisão confirmada | Expedição JC | Liberado para entrega/coleta; mostrar quem liberou e quando |
| Saída | Expedição JC | Confirmar saída física, distinta da conferência |
| Acompanhamento | Financeiro autorizado | A vencer, parcial, recebido ou vencido, separado da situação operacional |

O pedido não desaparece das pendências porque virou o dia. Uma diferença
explicada de peso não é alerta de erro. Um fato sem evidência aparece como
não registrado, sem inventar horário, autor ou entrega. Pendências resolvidas
ficam no histórico disponível, com a decisão correspondente.

## O que o código atual exige mudar

Leitura de código e migrations versionadas; esta revisão não auditou o banco
live nem executou o fluxo no navegador. Não confundir estas fontes com prova
de produção.

- `src/app/pedidos-pj/page.tsx`: `groupStatus` usa data passada para rotular
  entregue; `loadAll` corta a leitura em 500 linhas de itens. A ficha precisa de
  pedido completo e a busca precisa alcançar pendências fora desse corte.
- `src/lib/pjOrderList.ts`: `organizePjOrders` ainda classifica por data e
  `dispatchedAt`; este carimbo leva a Fechados. Uma única regra deve governar
  lista, busca e atalhos, evitando repetir o defeito corrigido na PR 335.
- `src/components/PjDispatchCheckPanel.tsx` e
  `src/lib/pjOrderDispatchClient.ts`: conferência e confirmação ainda usam o
  contrato antigo de despacho. Quantidade nula e zero têm significados distintos.
- `supabase/migrations/20260820232802_conferencia_quantidade_enviada_pj.sql`:
  `confirm_pj_order_dispatch` chama o motor financeiro, inclusive na repetição.
  Remover só a chamada da tela deixaria a cobrança automática acessível no banco.
- `supabase/migrations/20260903182000_cobranca_pelo_real.sql`: o motor,
  a geração manual e a correção pós-fechamento precisam concordar com o marco
  de aprovação. A correção atual refaz a cobrança e recusa recebimento ativo;
  não resolve por si a correção de pedido pago antes de sair.
- `src/components/PjOrdersToBillPanel.tsx` oferece geração por lote no Contas a
  receber. O caminho novo precisa exigir revisão/liberação e não permitir
  contorno por essa tela ou pela chamada direta ao banco.
- `src/lib/orderCancellation.ts` limita cancelamento às 5h. Portanto, encerrar
  pedido todo zero ou reprogramar depois de iniciado não pode simplesmente
  mandar a pessoa usar a ação atual que já está bloqueada.
- `src/lib/receivables.ts` já relaciona cobrança ao pedido e registra pagamentos
  parciais. Exibir esses dados na ficha exige respeitar a permissão financeira,
  sem carregá-los no navegador da Expedição.

## Fases propostas

### Fase 1 — Ficha clara e pendências com fatos atuais

**Objetivo:** a equipe entende o pedido e sua próxima providência no celular.
**Escopo:** ficha única dentro de Pedidos PJ, leitura de todos os itens do
pedido, busca que não abandone pendências antigas, situação operacional e
financeira separadas, estimativa discreta, responsáveis e histórico existente.
Usar as ações atuais sem prometer que a liberação de Elis já está implantada.
A parte financeira só aparece para quem já pode consultá-la. Não criar novos
fatos de saída/liberação nem alterar geração de cobrança nesta fase.

**Arquivos prováveis:** `src/app/pedidos-pj/page.tsx`,
`src/components/PjOrderListPanel.tsx`, `src/lib/pjOrderList.ts`, componentes
extraídos da ficha em `src/components/` e regras em `src/lib/`, além dos testes
correspondentes. A implementação deve auditar a leitura completa e as policies
antes de escolher consulta direta ou leitura protegida específica. Se exigir
mudança de acesso/schema, apresentar a ampliação antes de executar.

**Aceite:** pedido atrasado não vira entregue pelo calendário; nenhuma ficha
exibe só parte dos itens; busca abre o pedido certo; Financeiro vê quantidades
e cobrança conforme acesso; Expedição não recebe valores. Informação financeira
indisponível não aparece como zero ou sem dívida. Reabrir/recarregar preserva
contexto e a pessoa consegue reconhecer o que ainda pertence ao fluxo antigo.

**Riscos:** exposição financeira, agrupamento incorreto e promessa de etapa
inexistente. **Reversão:** reverter a mudança de interface, preservando dados.
**Teste:** celular, busca antiga, lista além de 500 itens, pedido incompleto,
atrasado, cancelado, conferido e com cobrança parcial; perfis da matriz abaixo.

### Fase 2 — Preparar e provar as regras em ambiente de teste

**Objetivo:** separar os marcos sem permitir cobrança ou saída indevida.
**Escopo:** desenho e implementação aditiva dos registros de conferência final,
revisão/NF/liberação e saída, vinculados à versão dos itens aprovada. Provar as
transações em preview antes da ativação. Nenhuma versão parcialmente publicada
pode mudar a rotina silenciosamente. A preparação não autoriza ativar em produção.

**Arquivos/objetos prováveis:** novas migrations e testes pgTAP; `orders`,
`receivables`, eventos financeiros e permissões PJ; funções de conferência,
cobrança, correção e filas. Definir a forma dos novos registros após auditoria
live somente leitura. Não reutilizar `dispatched_at` histórico como prova de
liberação por Elis ou de saída física. Não alterar migrations já integradas.

**Regras indispensáveis:** ações protegidas no banco; grants e RLS explícitos;
escrita por funções que validem perfil/escopo; `SECURITY DEFINER` com caminho
seguro; mesma versão de itens na cobrança e liberação; duplo toque e tentativas
concorrentes não duplicam; falha não grava metade da operação. Pedidos antigos
já cobrados preservam cobrança e pagamentos, sem inventar eventos. Definir corte
explícito e tratamento dos pedidos em andamento antes da ativação.

**Aceite/testes:** perfil permitido e bloqueado no banco e navegador; tentativa
direta de contorno, conexão interrompida e repetida, dois celulares, correção
durante revisão, legado com cobrança e recebimento. Provar também site antigo
com banco novo e site novo diante de contrato ainda antigo. Recurso não disponível
fica indisponível com mensagem, sem cair silenciosamente no envio antigo.

**Riscos:** dupla cobrança, liberação de versão vencida, mistura entre legado e
fluxo novo. **Reversão:** antes de ativar, manter o fluxo novo inativo e preservar
colunas aditivas. Correção de migration integrada é outra migration.

### Fase 3 — Ativar a jornada completa, com saídas para as exceções

**Objetivo:** conferência da Expedição, confirmação de Elis e saída funcionam
como etapas distintas na rotina real.
**Dependência:** fase 2 provada e decisões pendentes abaixo encerradas. Preparação
e ativação podem ficar na mesma PR se separar aumentar o risco de meio fluxo;
a ativação em produção continua exigindo aprovação própria.

**Escopo:** adaptar a ficha e filas para concluir conferência, revisar preços e
prazo, confirmar NF e cobrança, liberar e registrar saída. Retirar a geração
automática antiga e impedir contorno pela geração em lote ou correção.
Correção depois da liberação invalida a aprovação anterior. A saída exige
aprovação válida para a versão corrente, com cobrança vigente. Recomendação de
integridade: cancelar/alterar a cobrança ou preço aprovado também invalida a
liberação; submeter essa regra na aprovação desta fase.

Incluir pedido menor encerrado, zero pendente, reprogramação no mesmo pedido e
encerramento sem entrega com motivo. Nenhum desses caminhos pode depender de
um botão bloqueado pelo prazo antigo de cancelamento. Preservar programação e
identificar necessidade de revisão da Produção, sem duplicar demanda ou apagar
produção já executada. Não criar saldo automático para entregar em outra viagem.

**Arquivos prováveis:** página e componentes PJ, `PjOrdersToBillPanel.tsx`,
clientes de conferência/cobrança, regras de lista/valor e migrations novas da
fase, com testes de interface e banco. Revalidar cálculo de relatório PJ e
vencimentos para não tratar abatimento anterior como redução da venda corrente.

**Aceite:** o ciclo do pedido normal e do pedido 40/38 termina sem troca
injustificada de tela; zero não sai nem some; atraso mantém o pedido; Expedição
não confirma saída antes de Elis; correção invalida a liberação; repetição não
duplica cobrança; cobrança e parcelas preservam a data combinada aprovada.

**Riscos:** travar a operação na virada e permitir saída sem documentação.
**Reversão:** suspender novas transições com mensagem clara, preservar os fatos
já registrados e corrigir por PR compatível. Não voltar ao site antigo se ele
puder ignorar os novos bloqueios. Definir o procedimento exato na PR de ativação.

## Exceção mínima de crédito e devolução

Não criar carteira de créditos nem módulo de adiantamentos PJ. A frequência
relatada não justifica esse custo. Planejar a aplicação manual de abatimento
com justificativa e referência ao pedido anterior. Elis controla a existência
e o saldo externamente; o ERP não promete impedir reutilização entre pedidos.
Mesmo assim, repetir a mesma operação por falha de rede não pode duplicá-la.

O valor dos produtos, o abatimento anterior e o líquido a receber devem aparecer
separados. Exemplo fictício: R$ 200 em produtos, R$ 20 de crédito anterior,
R$ 180 a cobrar. Não registrar os R$ 20 como nova entrada de Pix nem como perda
por desconto comercial. Limitar o abatimento ao total cobrável; restante, se
houver, continua sob controle externo de Elis. A operação guarda autor e data. Antes de habilitar abatimento, resolver o caso de crédito igual ao total: há produtos para sair, mas líquido zero. Não confundir com nenhum produto entregue nem inventar Pix para quitar. O motor atual recusa cobrança zero; a representação de quitação por crédito anterior exige prova própria, sem criar carteira automática.

Correção de pedido já pago deve preservar entrada real, valor corrigido e
destino da diferença (Pix devolvido ou crédito aceito). Não representar devolução
real como se o recebimento original nunca tivesse acontecido. O encaixe mínimo
nos registros financeiros será auditado antes de estimar/implementar essa parte.
Não adiar uma proteção necessária à correção de pedido pago para depois da
ativação; se não houver solução segura aprovada, essa correção permanece
bloqueada com orientação explícita e responsável, sem liberar saída inválida.

## Pontos a fechar antes da ativação, sem bloquear a fase 1

- Quem substitui Elis quando ausente: usar pessoa autorizada por permissão,
  não amarrar a regra ao nome ou liberar todo administrador por suposição.
- Reprogramação: qual nova data foi acordada e se muda o vencimento ainda não
  confirmado; cobrança já confirmada nunca muda silenciosamente.
- Cancelamento depois de produção iniciada: responsável pela decisão e destino
  do produto. Encerrar o compromisso não pode apagar produção/estoque.
- Como registrar a correção rara com Pix devolvido ou crédito aceito usando os
  controles financeiros existentes, com o menor escopo possível.
- Recusa/devolução após saída e várias viagens não foram fechadas na entrevista;
  não inventar recebimento do cliente nem complementos automáticos. Preservar
  fatos e indicar tratamento humano até haver plano próprio.

## Verificação e roteiro de aceite

Toda fase implementada exige lint, tipos, testes e build, nessa sequência:
`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
Executar código gerado no ambiente isolado exigido pela portaria. A PR de
consolidação deste documento exige revisão factual e `git diff --check`;
não constitui teste da funcionalidade proposta.

| Perfil/escopo | Prova esperada |
| --- | --- |
| Financeiro JC autorizado | Ficha financeira, revisão e ação permitida na fase correspondente |
| Expedição JC autorizada | Quantidades sem valores; conferir e sair só com liberação válida |
| Admin com/sem permissão financeira | Leitura e ações respeitam os acessos reais, sem passe livre novo |
| Vendas JA e EX sem permissão PJ | Acesso/ação bloqueados; chamadas diretas também |
| Expedição fora da JC ou sem concessão | Não pode executar as ações reservadas à Expedição JC |

Conferir carregamento, vazio, erro, sucesso, recarga, sessão expirada e repetição.
Migrations exigem `CI Banco`, `Banco por PR`, `Usuarios do Banco por PR` e Vercel
verdes antes do teste. Criar cenários fictícios próprios, sem consumir fixtures
compartilhadas de outros testes. Não usar dados reais no preview.

Roteiro da primeira fase para Rodrigo no celular: abrir o preview identificado
pela PR, entrar como Financeiro JC e localizar pedido atrasado e pedido com
pagamento parcial; conferir responsável, itens e valores; entrar como Expedição
JC e conferir ausência de valores; usar Vendas JA/EX bloqueado. O link e os
nomes dos cenários serão fornecidos na PR que implementar a fase, não inventados
nesta documentação.

## Revisão do plano

A revisão independente preliminar apontou pagamento antes da saída, zero sem
saída operacional, invalidação por alteração de cobrança, vencimentos, viagens
parciais e substituição de Elis. Os pontos foram incorporados como critérios ou
decisões pendentes explícitas. O crédito automático foi descartado por decisão
de Rodrigo, pela raridade do caso. A simplificação não autoriza apagar histórico
financeiro. O plano final passa por nova leitura independente antes da entrega.
