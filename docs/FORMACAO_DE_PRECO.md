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
3. **Margem desejada e margem mínima por tipo de produto e por canal.** Os
   números aprovados foram 65%, 45% e 25%.
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

## O que ainda não está decidido

- Onde os parâmetros padrão são editados e quem pode editá-los.
- O que fazer com produto sem peso da unidade na ficha.
- Se o aviso de margem apertada aparece na tela do produto, num relatório ou nos
  dois.

## Nota de procedência

As decisões da seção "O que foi decidido" foram tomadas na conversa
"Persistência de dados na Formação de preço", em 2026-09-03, e foram trazidas
para cá a partir do registro que aquela sessão publicou no painel. Rodrigo deve
conferir os números de margem e a divisão entre padrão único e por produto; se
algo aqui divergir do que ele decidiu, vale o que ele disse, e este documento é
que precisa ser corrigido.
