# FORMACAO_DE_PRECO.md — Preço sugerido e preço praticado

**Criado em:** 2026-09-03. Registra decisões que Rodrigo tomou em duas conversas
do mesmo dia e que até aqui viviam somente no painel Onde Estamos. Painel é
espelho: se a conversa se perde, o desenho se perde junto.

**Status: plano aprovado em 2026-09-29, fases 1 a 3 autorizadas até produção.**
A frente foi retomada em 2026-09-29, com descoberta nova e um plano em fases
revisado por um agente de outra família. O plano está na seção "Plano em fases",
e o que mudou em relação às decisões de setembro está em "Decidido em
2026-09-29". O que já foi entregue se confere no código e no
`docs/CURRENT_STATE.md`, nunca por este status.

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
   cliente PJ, que continua vindo das tabelas de preço. *Revisto em 2026-09-29:
   a Buck ganha preço sugerido próprio e os demais clientes PJ saíram do
   escopo, inclusive do aviso.*
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

**O caminho é o preço observado.** A importação de vendas do balcão existe
desde 2026-09-14 (só a JC é importada até aqui) e, com o vínculo entre item do
PDV e produto do catálogo, mostra o preço médio praticado. Ela traz o que foi
vendido e por quanto. O ERP guarda isso como
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

*Revisto em 2026-09-29: o rateio saiu do escopo.* Com as despesas fixas
entrando no preço (ver "Decidido em 2026-09-29"), energia e gás chegam ao preço
de qualquer jeito; o rateio só decidiria qual produto carrega mais. Além disso,
no Financeiro eles estão dentro da categoria "Ocupação", junto com aluguel,
internet e IPTU, sem como separar. Volta ao plano se a distorção incomodar.

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

## Decidido em 2026-09-29

Decisões de Rodrigo na conversa "Formação de preço: descoberta e plano".

- **Despesas fixas entram no preço, separadas da margem.** O sistema calcula
  quanto elas pesam no faturamento de cada mês fechado, a partir do Financeiro,
  e soma esse percentual ao preço. A margem desejada passa a significar lucro.
- **O mesmo percentual de despesas fixas vale para todos os canais**, a Buck
  inclusive, mesmo que ela não use balcão nem loja. Rodrigo preferiu a regra
  simples ao preço mais justo da Buck.
- **Canais com preço sugerido próprio: Balcão, iFood e Buck.** Os demais
  clientes PJ ficam fora, sem aviso.
- **Só admin vê a formação de preço e muda a Configuração**, garantido no banco,
  não só na tela. Compras continua mexendo em receita e rendimento.
- **Divisão do trabalho:** a fase 2 vai para o agente de outra família como
  executor principal, em paralelo; as fases 1 e 3 ficam com quem conduz a
  frente, com revisão cruzada.

### Fatos medidos em produção nesta data (somente leitura)

- **O faturamento está em dois lugares.** Balcão da JC e da JA, com iFood, no
  Fechamento de caixa (`cash_closings`); PJ e Buck no Financeiro. O Financeiro
  não tem venda de balcão: calcular só por ele dobraria o peso das despesas.
- **As despesas do Financeiro só estão completas a partir de setembro de
  2026.** Em agosto a mão de obra lançada é um quarto da de setembro, porque o
  Financeiro começou no meio do mês.
- **Encargos e diárias continuam sem equipe**, e a taxa de cartão não aparece
  lançada.
- **Peso na produção de setembro (até dia 28):** 34 pães produzidos, 12 com
  peso na ficha, 62% das unidades cobertas. O Croissant, item mais produzido
  (2.674 unidades), não tem peso. O Brioche Hamburguer está com 0,8 kg por
  unidade, valor que parece ser de pacote. Pesar cerca de dez pães leva a
  cobertura acima de 90%.
- **Faixas de margem fixas no código:** `classifyGrossMargin`, em
  `src/lib/saleOptions.ts`, pinta "ruim" abaixo de 50% e "boa" a partir de 65%
  nas telas de Tabelas de preço e de auditoria de CMV. São números da mesma
  família do chute corrigido em 2026-09-04.

## A conta

Todos os percentuais incidem sobre o mesmo preço de venda:

```text
custo direto   = ingredientes da ficha + embalagem da ficha + mão de obra
custo ajustado = custo direto / (1 − sobra e descarte %)
preço          = custo ajustado / (1 − imposto % − taxa do canal % − despesas fixas % − margem %)
```

- **Margem** é o lucro em porcentagem do preço de venda, não acréscimo sobre o
  custo. A tela diz isso escrito.
- **Preço de equilíbrio** é a mesma conta com margem zero. É o que a ficha
  mostra enquanto a margem do tipo e do canal não estiver definida.
- **Mão de obra** por unidade = custo do quilo × peso médio da unidade; por
  quilo, o custo do quilo direto.

### Cada custo tem uma única fonte

| Componente | Fonte | Fica fora de |
| --- | --- | --- |
| Ingredientes | Ficha técnica | Nada a excluir |
| Embalagem | Componentes de tipo embalagem na própria ficha | Campo digitado, que deixa de existir |
| Perda de forno | Rendimento da ficha (massa para assado) | Campo de perda da formação |
| Sobra e descarte de venda | Percentual gravado por produto | Rendimento da ficha |
| Mão de obra de produção | Financeiro ÷ quilos produzidos no mês | Despesas fixas |
| Despesas fixas | Financeiro: mão de obra que não é de produção, ocupação, manutenção, serviços, financeiras e outras | CMV, impostos e taxas de cartão e apps |
| Imposto | Percentual da Configuração | Despesas fixas |
| Taxa do canal | Percentual da Configuração (cartão, comissão do iFood) | Despesas fixas |

## Plano em fases

Autorização de Rodrigo em 2026-09-29: fases 1 a 3 até produção, cada uma em
PR própria, depois de CI verde, revisão de outra família e Check. A fase 5
espera as margens.

| Fase | Resultado | Quem |
| --- | --- | --- |
| 0. Dados prontos | Pesar os pães sem peso, a começar pelo Croissant; conferir o Brioche Hamburguer; combinar com o Financeiro o lançamento de encargos e diárias por equipe | Operação |
| 1. Configuração do Sistema | Tela nova em Administração, só admin: imposto, taxa de cartão, comissão do iFood, margem desejada e mínima por tipo e canal (podem ficar vazias); guarda quem mudou e quando | Quem conduz |
| 2. Números do Financeiro | Por mês fechado: faturamento (Fechamento de caixa mais PJ e Buck do Financeiro), peso das despesas fixas e custo do quilo de mão de obra de produção, com cobertura de peso e meses usados; marcado como provisório enquanto os dados não fecham | Agente de outra família |
| 3. Formação de preço que salva | Na ficha: sobra por produto, embalagem da ficha, preço por canal, preço de equilíbrio e retrato de todos os números a cada salvamento | Quem conduz |
| 4. Conta dos 5 produtos | Rodrigo compara o custo completo de cinco produtos com o preço praticado e define as margens na Configuração | Rodrigo |
| 5. Avisos | Sugerido contra praticado (só JC, identificado) e contra a tabela da Buck; aviso de margem apertada na ficha e num relatório; faixas "ruim/boa" vindas da Configuração | A definir |

A ordem 4 antes de 5 é de propósito: aviso de "margem apertada" contra uma
margem que ninguém decidiu repetiria o erro do chute.

### Fora do escopo

Outros clientes PJ, kits, produção da cozinha (lanches e sopas) na mão de obra
por quilo, arredondamento de preço, envio de preço ao PDV, rateio de energia e
comparação com a JA enquanto a venda dela não for importada.

## Margens decididas em 2026-10-08 (fase 4)

Decisões de Rodrigo na conversa "Formação de preço — Fase 4: margens", depois
da conta dos cinco produtos feita fora da tela, com consultas somente leitura
em produção. **Provisórias:** saem de um único mês confiável (setembro de 2026)
e de uma mão de obra ainda na régua do pão assado. Revisar quando houver três
meses fechados ou quando a investigação do Financeiro (abaixo) terminar.

### O salário dos donos é custo fixo

Rodrigo e Suélen precisam retirar **R$ 20 mil por mês**. Esse valor entra nas
despesas fixas, como o salário de quem faz o trabalho deles, e não sai do
lucro. A margem passa a medir o que a padaria ganha **depois** de pagar os
donos. Em setembro o Financeiro tinha só R$ 997 de retirada lançada, abaixo da
linha do resultado. Com os R$ 20 mil, as despesas fixas vão de cerca de 26%
para cerca de **35% do faturamento**.

Consequência para a fase 2: o indicador de despesas fixas não enxerga a
retirada, porque ela fica abaixo da linha. Até ele mudar, a conta manual soma
os R$ 20 mil.

### Percentuais

Margem é lucro em porcentagem do preço, depois de imposto, taxa do canal e
despesas fixas (com o salário dos donos). Mínima: abaixo dela o produto é
revisado. Desejada: o alvo.

| Tipo | Canal | Mínima | Desejada |
| --- | --- | --- | --- |
| Pães e laminados | Balcão e iFood | 10% | 20% |
| Confeitaria | Balcão e iFood | 10% | 18% |
| Pães e laminados | Buck | 5% | 12% |
| Revenda | Todos | 5% | 10% |

Na Configuração do Sistema isso vira: margem do canal para Balcão, iFood e Buck
pela linha de pães, e exceção por categoria para Confeitaria e para as
categorias de revenda. Gravar é ação do Rodrigo como admin.

Parâmetros usados na conta: Simples Nacional 8,49%; taxa de cartão no balcão
5,5%, valor conservador escolhido por Rodrigo, que inclui venda em dinheiro e
Pix sem taxa; Buck sem taxa de canal; **comissão do iFood ainda não informada**.

### Por que esses números

- **Necessidade de caixa.** Além do salário dos donos, o lucro precisa pagar
  cerca de R$ 8,6 mil por mês de empréstimos e montar, em seis meses, a reserva
  de giro (cerca de R$ 45 mil para a pior semana, salários e aluguel no começo
  do mês) e quitar cerca de R$ 20 mil de boletos de fornecedor vencidos, se
  forem atraso real. Isso dá cerca de R$ 20 mil por mês, perto de 10% do
  faturamento. Com 65% da receita no balcão e 35% na Buck e PJ, todos na
  desejada dão perto de 17% de lucro médio; todos na mínima, perto de 8%. Por
  isso a mínima não desce mais.
- **Folga para o que a ficha não vê.** A matéria-prima comprada em setembro foi
  28% do faturamento, enquanto o ingrediente da ficha dos pães é de 6% a 16% do
  preço. Até essa diferença ser explicada, a desejada guarda folga.
- **Buck abaixo do balcão.** Venda garantida, sem sobra, sem devolução, sem
  cartão e paga em dia. Abaixo de 5%, um aumento de farinha ou azeitona zera o
  lucro.
- **Revenda.** Sem mão de obra nem sobra; com imposto, cartão e despesas fixas,
  5% a 10% de lucro resultam em preço de cerca de 2 vezes o custo de compra.
- **Referência de mercado: fraca.** Não há número da ABIP nem do Sebrae; só
  páginas de empresas de software, que falam em 5% a 10% de lucro líquido
  comum em padaria e mais em artesanal, com faixas que se contradizem. Serviu
  apenas para confirmar a ordem de grandeza.

### Retrato dos cinco produtos (setembro de 2026)

Mão de obra de R$ 5,00 por quilo de pão assado (folha bruta da produção de
R$ 11.124 mais encargos, férias, 13º e vales ≈ R$ 17 mil, sobre cerca de
3.300 kg), provisória até a fase 0 entregar o custo do quilo de massa crua.
Sobra do balcão pelo registro de sobras da JC; Buck sem sobra. Embalagem
estimada. Croissant com fator 2 na mão de obra, provisório.

| Produto | Balcão: praticado | Balcão: lucro | Buck: praticado | Buck: lucro |
| --- | --- | --- | --- | --- |
| Multigrãos | R$ 21,71 | 30% | R$ 9,50 | 20% |
| Italiano | R$ 13,81 | 26% | R$ 4,50 | **−2%** |
| Croissant | R$ 8,83 | 20% | R$ 4,65 | 10% |
| Pão de Azeitona | R$ 21,82 | 19% | R$ 9,50 | **−1%** |
| Bolo integral de maçã | R$ 21,81 | **−5%** | não vende | — |

Abaixo da mínima hoje: **Italiano e Pão de Azeitona na Buck** (preço mínimo
R$ 5,09 e R$ 10,64) e o **bolo de maçã** no balcão (mínimo R$ 29,85). Na Buck,
o Multigrãos tem folga (R$ 9,50 praticado, R$ 7,79 desejado), o que permite
propor uma tabela rebalanceada. No bolo, o caminho indicado é rever a receita
(a noz pecan sozinha custa cerca de R$ 3 por bolo), não o preço.

### Fatos medidos nesta conversa (somente leitura)

- **O bolo de maçã não tinha ficha.** O custo de R$ 5,20 era digitado; pela
  receita (6 bolos, noz pecan) o ingrediente é cerca de R$ 8,30. Outros itens de
  confeitaria também têm custo digitado sem ficha.
- **O salário pago é o líquido.** INSS e FGTS aparecem nos encargos, e férias e
  13º não são provisionados: cerca de R$ 6,5 mil por mês que o Financeiro não
  mostra até vencerem. Setembro teve R$ 8,2 mil de rescisões. Por isso a mão de
  obra da produção foi montada pela folha, não pelo caixa.
- **Contas a pagar só têm fornecedor.** Salário, aluguel, Simples e empréstimo
  entram no Financeiro só no dia do pagamento, então não há projeção de caixa.
  Havia R$ 19,7 mil em parcelas de fornecedor vencidas e não baixadas em
  2026-10-08, sem saber se é atraso ou baixa esquecida.
- **A soma de setembro não fecha com o caixa curto.** Faturamento de cerca de
  R$ 210 mil contra despesas lançadas deixa cerca de R$ 40 mil por mês. A
  hipótese principal é a retirada dos donos não lançada; seguem abertas venda
  contada duas vezes (campo "site" do fechamento da JC contra PJ), compras
  fora do Financeiro e dinheiro preso. Investigação separada, somente leitura.

## O que ainda não está decidido

- A comissão do iFood.
- O que a página de Configuração do Sistema vai conter além dos parâmetros de
  preço.

## Nota de procedência

As decisões da seção "O que foi decidido" foram tomadas na conversa
"Persistência de dados na Formação de preço", em 2026-09-03, e foram trazidas
para cá a partir do registro que aquela sessão publicou no painel. A conferência aconteceu em 2026-09-04 e pegou um erro: os
percentuais de margem não eram decisão, eram chute, e foram corrigidos acima. O
resto da estrutura ele confirmou. Fica a lição: registro de decisão precisa
dizer de onde veio cada número, senão um chute vira meta por repetição.
