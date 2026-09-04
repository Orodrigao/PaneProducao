# FORMACAO_DE_PRECO.md — Preço sugerido e preço praticado

**Criado em:** 2026-09-03. Registra decisões que Rodrigo tomou em duas conversas
do mesmo dia e que até aqui viviam somente no painel Onde Estamos. Painel é
espelho: se a conversa se perde, o desenho se perde junto.

**Status: plano guardado.** Nada em execução, nada reservado na portaria.
Rodrigo definiu em 2026-09-03 que a prioridade é a cobrança pela quantidade
enviada e que a formação de preço fica no plano, sem data.

**Autoridade:** este documento registra decisões e o desenho pretendido. O que
existe de fato está no código, nas migrations e nos testes.

## O problema

Dentro da ficha técnica existe a tela **Formação de preço**. Os valores de
embalagem, mão de obra, perda e imposto ou taxas **não ficam gravados**. Cada
vez que alguém abre a tela, digita tudo de novo, e o preço sugerido de hoje não
pode ser comparado com o de ontem, porque não sobrou registro de como ele foi
calculado.

## O que foi decidido

1. **Padrão único para imposto, margem e mão de obra por quilo.** São valores
   que valem para o negócio inteiro e se definem uma vez, em vez de serem
   redigitados a cada produto.
2. **Embalagem e perda são por produto.** Variam de item para item e pertencem
   à ficha daquele item.
3. **Margem desejada e margem mínima por tipo de produto e por canal.** A
   estrutura está decidida; **os percentuais não**. Os números 65%, 45% e 25%
   circularam numa conversa de 2026-09-03 e chegaram a ser registrados aqui como
   aprovados. Em 2026-09-04 Rodrigo corrigiu: **foram chute, não decisão.**
   Estão riscados de propósito, para ninguém os tratar como meta. Como chegar
   nos números de verdade está na seção "Como definir as margens".
4. **No PJ o sistema apenas avisa.** A formação de preço não mexe em preço de
   cliente PJ, que continua vindo das tabelas de preço.
5. **O ERP calcula o preço sugerido.** Ele não é o dono do preço praticado no
   balcão, pelo motivo da seção seguinte.

## O preço praticado vem do PDV, não de cadastro manual

Decisão de 2026-09-03, na conversa sobre itens de revenda.

O ERP hoje guarda apenas o **custo** do produto (`products.cost_price`) e uma
marca de revenda (`products.is_revenda`). Não existe preço de venda de varejo em
lugar nenhum do ERP; a tabela `product_prices` é preço por destino, do fluxo de
romaneio, e não serve para isso.

**Não vamos criar cadastro manual de preço de venda.** O preço de verdade muda
no PDV, e um preço digitado no ERP envelheceria em silêncio a cada mudança lá.
É a mesma família de erro da farinha cadastrada a R$ 74,00 o quilo: um número
digitado que ninguém percebeu ter envelhecido.

**O caminho é o preço observado.** Quando a importação do relatório do CNM
existir, ela traz o que foi vendido e por quanto. O ERP guarda isso como
observação, compara com o custo que veio das notas fiscais e avisa quando a
margem aperta. Se o preço mudar no PDV, a importação seguinte atualiza sozinha.
O preço continua tendo um dono só.

**Consequência para a importação do CNM:** é preciso existir o vínculo entre o
item vendido no PDV e o produto do catálogo, do mesmo jeito que a NF-e vincula
o item do fornecedor ao produto. Sem esse vínculo, o relatório traz receita mas
o sistema não sabe qual custo aplicar. Ver
[SALES_IMPORT_CNM.md](SALES_IMPORT_CNM.md).

**O aviso mais barato não depende disso.** A decisão de reajustar nasce quando o
custo sobe, e o ERP já sabe quanto o item custava na compra anterior. Um aviso
na entrada da nota fiscal ("este item subiu 22% desde a última compra") é
acionável hoje, sem preço de venda nenhum e sem esperar o CNM. Hoje esse aviso
não existe.

## De onde sai o custo de mão de obra

Decidido em 2026-09-04, depois de Rodrigo perguntar como o sistema separaria a
folha de produção da de atendimento.

**Resposta curta: o sistema já sabe, e ninguém precisa dizer de novo.** O
Financeiro já tem as categorias de mão de obra separadas por equipe, e a Elis já
lança assim. Conferido em produção nesta data:

| Categoria | Equipe | Lançamentos | Total lançado |
| --- | --- | --- | --- |
| Mão de obra, Produção | producao | 15 | R$ 12.094,90 |
| Mão de obra, Balcão JC | balcao | 9 | R$ 7.530,77 |
| Mão de obra, Balcão JA | balcao | 5 | R$ 4.975,73 |
| Mão de obra, Expedição | expedicao | 6 | R$ 3.868,61 |
| Mão de obra, Administrativo | administrativo | 8 | R$ 7.379,44 |
| Mão de obra, Encargos | sem equipe | 2 | R$ 1.792,65 |
| Mão de obra, Diárias e extras | sem equipe | 2 | R$ 815,00 |

**Só a mão de obra de produção entra no custo do produto.** Balcão, expedição e
administrativo são despesa operacional e aparecem no resultado do negócio, não
no CMV do pão. Misturar faz o pão parecer caro e esconde onde o dinheiro vai.

**Nada de cadastro de funcionário nem de salário individual dentro do ERP.** O
dado entra uma vez, no lançamento financeiro que já existe, e serve ao DRE e ao
custo do produto.

### Encargos e diárias passam a ser lançados por equipe

As duas únicas categorias sem equipe são justamente as que mais variam. Decisão
de Rodrigo em 2026-09-04: **lançar por equipe**, como já se faz com o salário,
em vez de ratear por proporção. Muda um pouco o processo da Elis e resolve para
sempre, sem estimativa no meio do caminho.

### Energia, gás e água: rateio por percentual

Aqui não dá para separar no lançamento, porque a conta da loja é uma só e cobre
produção e balcão juntos. Entra um percentual definido por Rodrigo, revisado
quando o parque de equipamentos mudar. É o tipo de parâmetro que mora na página
de Configuração do Sistema.

### A conta, ao final

Custo de transformação por quilo = (mão de obra de produção do mês, com os
encargos da produção) mais (a parte da energia e do gás atribuída à produção),
dividido pelos quilos produzidos no mês.

Os quilos o sistema já conta: em 2026-09-04 havia **508 registros de produção em
27 dos últimos 30 dias**, com a quantidade assada de cada pão. O que falta é o
peso da unidade, que é o pré-requisito registrado abaixo.

**Por que não cronometrar máquina e pessoa por produto**, como fazem alguns
sistemas de padaria: numa produção artesanal o mesmo forno assa vários produtos
juntos, a mesma massa vira itens diferentes, e ninguém consegue dizer com
honestidade quantos minutos de quem foram para cada peça. Além disso, toda
receita nova exigiria cronometrar de novo. O resultado é um número com aparência
de precisão que envelhece sem avisar, que é a mesma família de erro da farinha
cadastrada a R$ 74,00. O rateio por quilo se recalcula sozinho todo mês com
dados que já entram no sistema. Se um dia o erro entre um folhado e um pão
simples incomodar, o passo seguinte é um fator de dificuldade por família, e não
a cronometragem.

## Como definir as margens, já que elas não estão definidas

Definir meta de margem antes de conhecer o custo completo é decidir no escuro. O
que o sistema sabe hoje é o **custo de ingrediente** da ficha: a baguete custa
R$ 0,59 em ingredientes. Isso não é o custo do pão. Falta mão de obra,
embalagem, perda de forno e imposto, que é exatamente o que a formação de preço
existe para somar.

Margem calculada sobre ingrediente parece ótima e não paga conta nenhuma.

**O caminho proposto, quando esta frente for retomada:**

1. Escolher cinco produtos representativos: um pão simples, um pão recheado, um
   croissant, um item de confeitaria e um de revenda.
2. Levantar o custo completo dos cinco, somando os quatro componentes que faltam
   ao de ingrediente.
3. Comparar com o preço praticado hoje, que está no PDV.
4. A margem que aparecer é o retrato real. **A meta se define a partir dela**,
   produto por tipo, e não de um número escolhido antes.

O que dá para afirmar sem medir: margem de **revenda** é estruturalmente menor
que a de fabricação, porque na revenda a padaria compra pronto e só recebe pela
distribuição. Por isso a estrutura separa por tipo. Quanto menor, só a conta dos
cinco produtos vai dizer.

## Pré-requisitos conhecidos

1. **Classificar a revenda.** Medido em produção em 2026-09-03: 33 produtos
   ativos têm categoria de revenda escrita em texto livre (`revenda`, `Revenda`,
   `REVENDA`) e apenas **7** estão marcados com `is_revenda`. Enquanto o sistema
   não souber o que é revenda, não há margem de revenda para calcular. Isso é
   parte da limpeza do catálogo, em
   [CATALOGO_PRODUTOS.md](CATALOGO_PRODUTOS.md).
2. **Mão de obra por quilo depende do peso na ficha.** Onde o produto não tiver
   o peso da unidade, a conta por quilo não fecha, e é preciso decidir o que
   fazer com esses itens.

## Fora de escopo, por decisão

- **O ERP mandar preço para o PDV.** Integração de ida é outro projeto, bem
  maior, e não está no plano.
- **Cadastro manual de preço de venda no ERP**, pelo motivo já explicado.

## Decidido em 2026-09-04

- **Os parâmetros padrão moram numa página de Configuração do Sistema**, a ser
  criada. Rodrigo prevê que outras questões globais vão aparecer no caminho e
  que elas precisam de um lugar comum, em vez de nascerem espalhadas.
- **O aviso de margem apertada aparece nos dois lugares:** na tela do produto e
  no relatório.
- **Produto sem peso da unidade não entra na formação de preço.** A mão de obra
  é por quilo, e sem o peso não há como saber quanto dela cabe numa unidade.
  Medido em produção em 2026-09-04: dos **191 produtos fabricados ativos**, só
  **26** têm peso médio na ficha e **21** têm peso na opção de venda; **165 não
  têm peso em lugar nenhum**. Rodrigo escolheu exigir o peso e ir preenchendo:
  "No fim temos que ter todas as fichas cadastradas. É preciso."

## O que ainda não está decidido

- Os percentuais de margem, desejada e mínima, por tipo e por canal. Ver "Como
  definir as margens".
- O que a página de Configuração do Sistema vai conter além dos parâmetros de
  preço.

## Nota de procedência

As decisões da seção "O que foi decidido" foram tomadas na conversa
"Persistência de dados na Formação de preço", em 2026-09-03, e foram trazidas
para cá a partir do registro que aquela sessão publicou no painel. A conferência aconteceu em 2026-09-04 e pegou um erro: os
percentuais de margem não eram decisão, eram chute, e foram corrigidos acima. O
resto da estrutura ele confirmou. Fica a lição: registro de decisão precisa
dizer de onde veio cada número, senão um chute vira meta por repetição.
