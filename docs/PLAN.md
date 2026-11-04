# Roadmap canônico do Pane&Salute ERP

**Atualizado em:** 2026-10-23, com o plano mestre aprovado pelo Rodrigo nessa data;
revisto em 2026-10-30 com as frentes concluídas e as aprovadas depois de 23/10.
**Substitui:** o roteiro de 2026-07-21, organizado em fases de 0A a 10.

Este arquivo define a missão, os marcos com data, a ordem das frentes e o critério
de pronto. O que já existe de fato está no código e em
[CURRENT_STATE.md](CURRENT_STATE.md); o desenho de cada frente está no documento
da funcionalidade citado na tabela de frentes.

## Missão

O ERP existe para responder a uma pergunta:

> Para onde vai o dinheiro da Pane&Salute?

A resposta chega em dois marcos. No primeiro, o mês fecha dentro do ERP, sem conta
feita à mão. No segundo, o ERP explica as diferenças entre o que deveria ter sido
gasto e o que foi gasto.

## Princípios

- **O CMV real dos insumos sai do inventário periódico:** estoque inicial mais
  compras menos estoque final, medidos pela contagem semanal. Para apurar o CMV, o
  ERP não depende de baixa contínua nem de saldo em tempo real (decisão de
  22/08/2026): os sistemas anteriores morreram de estoque que entrava pela nota e
  nunca saía. A baixa dos componentes de kit vendido é controle operacional e não
  entra no CMV ([SALES_IMPORT_CNM.md](SALES_IMPORT_CNM.md)). Ficha técnica e
  vendas alimentam o CMV teórico, a formação de preço e a comparação entre teórico
  e real; não são pré-requisito do CMV real.
- **Dado financeiro novo nasce com o gate técnico da fase:** RLS forçada desde a
  criação, escrita somente por função protegida, grants explícitos, idempotência e
  matriz de teste permitido × bloqueado. O endurecimento restante de segurança anda
  em paralelo (decisão de 11/08/2026, registrada em
  [CURRENT_STATE.md](CURRENT_STATE.md)).
- Toda fase é pequena, reversível e validada no navegador.
- Implementação parcial não significa fase concluída.
- Painel não compensa dado incompleto ou sem origem rastreável.
- A IA não decide compra, preço ou produção sozinha: toda recomendação mostra os
  dados usados, a incerteza e a ação humana necessária.
- Prazo não fura verificação: o calendário já conta folga para correções.

## Marco 1, 10/12/2026: o mês fecha dentro do ERP

Novembro de 2026 fecha no ERP sem o Rodrigo fazer conta à mão:

1. **DRE de novembro da JC e da JA**, numa contabilidade só (decisão de
   22/10/2026), gerado pelo ERP, com balcão, iFood, PJ e Buck, CMV e despesas, e com
   os extratos dos bancos conferidos contra o sistema. A EX é cliente, com outro
   CNPJ, e entra como receita da Buck.
2. **CMV real pela contagem, sem contar duas vezes:** o consumo dos insumos da
   contagem semanal sai do inventário; o dos demais, das compras. O mês do CMV de
   novembro vai da contagem de 31/10 à de 28/11, e não do dia 1 ao dia 30: regra
   escrita, não o mês do calendário.
3. **Custo e preço:** os produtos que fazem 80% da venda, pela curva ABC que já
   existe no ERP, com ficha válida e custo salvo; formação de preço completa, com o
   preço sugerido comparado ao praticado em cada canal.
4. **Compras:** toda nota de novembro entra pelo ERP, pelo XML ou à mão nos casos
   fiscais que o XML ainda recusa, com aviso quando um insumo sobe de preço.
5. **Sobras em reais** por semana, pelo custo da ficha.
6. **Nenhuma pendência que impeça o fechamento** na lista de ninguém.

Em 10/12, com o fechamento na mão, o Rodrigo decide se desliga o financeiro do CNM
(fase 5 de [FINANCEIRO.md](FINANCEIRO.md)).

A conciliação de setembro e as correções antigas não travam novembro: se
atrasarem, novembro fecha assim mesmo, com a ressalva escrita.

## Marco 2, até 29/01/2027: explicar as diferenças

Detalhado depois de 10/12. Escopo previsto:

- consumo teórico (venda × ficha) comparado ao consumo real, por família de insumo;
- rotina mensal de 30 minutos para investigar as maiores diferenças;
- painel do dono com esses números.

**Limite assumido:** a ruptura (o que faltou na vitrine) fica fora dos dois
marcos, porque depende de um hábito novo da equipe.

## Calendário do marco 1

| Semana | Foco | O que precisa estar pronto no fim |
| --- | --- | --- |
| 26/10 a 30/10 | Limpar a mesa | Decisões pendentes do Rodrigo respondidas; lançamentos de outubro limpos; produtos prioritários escolhidos pela curva ABC; Tabela Buck fase 3 no ar |
| 03/11 a 06/11 (02/11 é feriado) | Dinheiro entrando certo | Crédito, débito e PIX separados por maquininha no fechamento de caixa e no livro-caixa; revenda sem cadastro entrando pela nota |
| 09/11 a 13/11 | Compras e base do preço | Conferência do mês no Financeiro; aviso de alta de custo; indicadores do preço lendo o peso da ficha; famílias dos insumos contados aprovadas |
| 16/11 a 19/11 (20/11 é feriado) | DRE e sobras | DRE da JC e da JA com o CMV pela contagem; sobras em reais |
| 23/11 a 27/11 | Ensaio, com folga | DRE de outubro fechado no ERP pelo financeiro até 27/11; correções do ensaio |
| 30/11 a 04/12 | Preço e véspera | Formação de preço completa no ar; contas que só existem no CNM conferidas no ERP |
| 07/12 a 09/12 | Fechamento | Novembro fechado no ERP pelo financeiro até 09/12 |
| 10/12 | Entrega | Reunião de entrega e decisão sobre o CNM |

## Frentes de desenvolvimento do marco 1

No máximo três frentes de código ao mesmo tempo, integradas uma por vez. Cada uma
passa por revisão de outra família de modelo, testes, CI e selo da portaria antes
de ir ao ar; os prazos já contam dois dias úteis de folga para correções. A
aprovação de 23/10/2026 autoriza estas frentes até o ar, nessas condições; as
decisões de negócio continuam com o Rodrigo. As frentes que entraram depois de
23/10 têm aprovação própria, registrada na reserva de cada uma, e a conferência do
extrato ainda pede o aval da fase. Quando o teto estiver tomado, a frente seguinte
na ordem da tabela espera outra integrar. Quem conduz cada frente fica registrado
na portaria da equipe de IA, não aqui.

| No ar até | Frente | Depende de | Desenho |
| --- | --- | --- | --- |
| Feito em 29/10 | Correções de cadastro pela tela, sem código: a nota de um insumo contado no cadastro certo e as fichas do croissant e da calabresa puxando a massa em quilo | Acesso do Rodrigo no navegador do app | N/A |
| No ar em 24/10 | Tabela Buck fase 3: o Fechamento EX mostra o que foi cobrado nas semanas já cobradas (PR #525) | Nada | [CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md) |
| 30/10 | Lista dos produtos que fazem 80% da venda, pela curva ABC (lista, sem código) | Vendas da JC importadas | N/A |
| No ar em 24/10 | Segurança: fechar a exposição GraphQL, última pendência da auditoria de julho (PR #523) | Nada | [CURRENT_STATE.md](CURRENT_STATE.md), Riscos ainda abertos |
| 02/11 | Revenda sem cadastro na entrada de NF-e, fases 1 e 2: a tela mostra a recusa real do banco e leva ao cadastro existente (fase 1, no ar em 28/10, PR #531); o item fora do cadastro ganha um tipo (`uso_despesa` ou `revenda`), e a revenda aparece em linha própria no consumo semanal, fora do CMV % (fase 2) | Nada | [COMPRAS_POR_XML.md](COMPRAS_POR_XML.md) |
| 10/11 | Financeiro fase 3: canal 99Food no fechamento de caixa e na Configuração do Sistema; venda do balcão e taxas de cartão, iFood e 99Food no livro-caixa; histórico da Stone corrigido de setembro em diante (PRs #524 e #526, no ar em 25 e 26/10). Falta: crédito, débito e PIX lançados por maquininha no fechamento, cada um com a sua taxa (decisão de 29/10), e depois a conferência do mês | Relatório de um dia de cada maquininha, para os campos copiarem o papel | [FINANCEIRO.md](FINANCEIRO.md) |
| Novembro | Alarme de rotina parada: e-mail diário quando uma rotina do ERP para, com quatro avisos do financeiro (pedido PJ conferido sem liberar, conta recorrente não confirmada, recebimento parado e parcela vencida). A regra no banco está no ar desde 28/10 (PR #533); falta o envio | Nada | N/A |
| 13/11 | Compras fase 3B: aviso quando um insumo sobe de preço na nota | Revenda sem cadastro, fase 2, integrada (mesma tela de importação) | [COMPRAS_POR_XML.md](COMPRAS_POR_XML.md) |
| 13/11 | Formação de preço, passos 0c e 0d: indicadores e Forno lendo o peso da ficha; retirada dos donos tratada nos indicadores | Respostas do Rodrigo sobre as fichas | [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md) |
| 18/11 | Financeiro fase 4: DRE da JC e da JA, com o CMV pela contagem sem contar duas vezes, fechar o mês e exportar | Financeiro fase 3; as fontes de receita PJ e Buck (fases 2 a 4 do Contas a Receber) já estão no ar | [FINANCEIRO.md](FINANCEIRO.md) |
| 19/11 | Sobras em reais pela ficha e consumo semanal por família | Famílias dos insumos contados aprovadas | [CATALOGO_PRODUTOS.md](CATALOGO_PRODUTOS.md) |
| 02/12, se o desenho for aprovado | Conferência do extrato no ERP: o extrato do banco sobe uma vez por semana e cada linha é ligada ao lançamento que parece ser o mesmo; linha sem par fica "a investigar". Sem desenho aprovado a tempo, ou se atrasar, os extratos de novembro são conferidos à mão por roteiro e planilha prontos até 20/11, para o item 1 do marco não ficar descoberto | Financeiro fase 4 no ar; um extrato de amostra de cada banco; desenho e critérios de aceite escritos no FINANCEIRO.md; aval da fase | A desenhar: o [FINANCEIRO.md](FINANCEIRO.md) ainda trata a conciliação bancária como fase futura |
| Quando abrir vaga | Revenda sem cadastro, fases 3 e 4: trocar o tipo pelos Vínculos de NF-e, com prévia e desfazer, e arrumar pela tela a nota que motivou a frente | Revenda sem cadastro, fase 2 | [COMPRAS_POR_XML.md](COMPRAS_POR_XML.md) |
| 04/12 | Formação de preço fase 3: salvar a formação completa; preço sugerido × praticado por canal, com a comissão do aplicativo e o imposto calculados sobre itens e taxa de entrega, mais o custo do motoboy | Passos 0c e 0d; fichas prioritárias conferidas | [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md) |

## O que depende de pessoas

O marco 1 depende de decisões do Rodrigo e de tarefas da equipe da padaria, cada
uma com dono e prazo. Essas listas ficam fora do repositório, na lista de
pendências da equipe de IA (`PENDENCIAS.md`), que também alimenta a cobrança
diária; este roteiro não as copia.

Os hábitos de que o marco 1 depende, sem os quais o número não fecha:

- contagem semanal dos insumos, aos sábados, sem semana pulada; as contagens de
  31/10 e 28/11 delimitam o CMV de novembro;
- fechamento de caixa todo dia, sem buraco: é a venda que entra no CMV;
- arquivo de vendas do PDV subido e produto novo vinculado toda segunda-feira;
- produção e sobras lançadas no ERP todo dia;
- toda nota de compra lançada e conferida, com os vínculos dos itens em dia.

## Riscos do calendário

- O financeiro concentra muitas tarefas em outubro e novembro; se não der conta, o
  fechamento de novembro atrasa.
- Decisão de negócio fora do prazo empurra a frente que depende dela.
- Os prazos supõem nenhum incêndio em produção; havendo, o coordenador avisa no
  dia e mostra o que muda no calendário.

## Fica para depois, de propósito

Fora dos dois marcos:

- painel completo do dono e IA de apoio;
- registro de ruptura;
- unificar as permissões antigas de tela, salvo se alguém perder acesso;
- famílias dos demais insumos (cerca de 280);
- tirar o texto livre do catálogo (fase 4 de
  [CATALOGO_PRODUTOS.md](CATALOGO_PRODUTOS.md));
- relatório de estimado × real dos pedidos PJ;
- identidade única de produto (abaixo);
- contagem de estoque nas outras lojas;
- chatbot de cliente, emissão fiscal própria, visão computacional de vitrine,
  compra automática, automação pesada de WhatsApp e reescrita geral da interface.

**Identidade única de produto** (aprovada para o roteiro em 21/07/2026, sem data).
O mesmo produto tem duas identidades: o cadastro antigo de pães (source `bread`) e
o catálogo unificado (source `product`), ligados por `products.legacy_bread_id`. A
dupla identidade já causou mais de três defeitos, um deles na cobrança da EX. A
ponte `src/lib/productIdentity.ts` é mitigação: cada tela nova precisa lembrar de
usá-la, e preço ou custo pode divergir entre as duas identidades sem aviso. Risco
alto (dados de produção e telas do dia a dia), em fases com aprovação por fase.
Critério de saída: nenhuma escrita nova com source `bread`; a ponte serve só para
ler histórico; nenhum preço ou custo ativo duplicado entre identidades.

## O que aconteceu com as fases de 21/07/2026

Situação em 23/10/2026, na `main` em `7f6273f`, com a linha 0B revista em
30/10/2026. O detalhe e o que vier depois ficam em
[CURRENT_STATE.md](CURRENT_STATE.md) e no código.

| Fase do roteiro antigo | Situação |
| --- | --- |
| 0A, estabilização | Virou rotina: trava da `main`, CI por PR, banco de teste por PR e regras em `docs/regras/` |
| 0B, segurança Supabase e Auth | Acesso só por e-mail e senha, PIN removido, funções privilegiadas revisadas; a auditoria de julho fechou com a exposição GraphQL desligada no banco em 24/10 (PR #523), depois de o endpoint sem uso ter sido despublicado em 24/09 (PR #445); a unificação das permissões antigas fica para depois |
| 1, compras por XML | Fases 1, 2 e 3A no ar, e os Vínculos de NF-e corrigem itens e memória do fornecedor; a fase 3B (aviso de alta) está no marco 1 |
| 2, unidades e conversões | Conversões de compra com trava do fator, corrigidas pelos Vínculos de NF-e |
| 3, estoque transacional | Substituída pelo inventário periódico (22/08/2026): contagem semanal pelo celular e consumo semanal da JC no ar |
| 4, ficha técnica versionada | Componentes, rendimento pela massa crua por variante e pré-mistura no ar; o marco 1 pede ficha válida e custo salvo nos produtos de 80% da venda; o versionamento completo, com vigência, continua pendente, sem prazo no plano aprovado |
| 5, vendas | Importação de vendas do balcão por arquivo, independente do PDV, em uso na JC, com produtos vendidos, curva ABC e histórico diário |
| 6, sobras e rupturas | Fluxo por lotes e reaproveitamento no ar; sobras em reais no marco 1; ruptura fora dos marcos |
| 7, CMV teórico | Cálculo pela ficha e auditoria de cobertura existem; a comparação com o real é o marco 2 |
| 8, CMV real por família | CMV real pela contagem no marco 1; por família, com explicação das diferenças, no marco 2 |
| 9, painel do Rodrigo | Painel do dono no marco 2; o painel completo fica para depois |
| 10, IA de apoio | Fica para depois |

## Definição de pronto

**De uma frente:**

- critérios de aceite cumpridos, com evidência (`docs/regras/FECHAMENTO.md`);
- fluxo testado no navegador, na matriz perfil × loja que a mudança toca;
- lint, tipos, testes e build aplicáveis aprovados, ou conferência documental
  quando a mudança é só de documento;
- RLS e grants validados quando houver banco;
- revisão de outra família de modelo, CI remoto verde e selo da portaria antes de
  integrar;
- nenhum segredo ou dado sensível versionado;
- PR pequena e revisável;
- documentação atualizada somente onde mudou algo durável;
- rollback conhecido;
- no ar, com o deploy conferido e a casa limpa.

**De um marco:** o marco 1 está pronto quando novembro fechou no ERP sem conta à
mão e os seis itens da seção do marco estão cumpridos, entregues na reunião de
10/12. O critério do marco 2 é definido depois dessa entrega.
