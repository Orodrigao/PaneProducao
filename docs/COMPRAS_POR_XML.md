# COMPRAS_POR_XML.md: entrada de NF-e e custo do insumo

**Criado em:** 2026-09-05. Registra a decisão que Rodrigo tomou nesta data
sobre o destino do imposto e das despesas da nota, e o defeito que a motivou.
Até aqui a decisão existia somente na conversa.

**Autoridade:** este documento registra o problema, a decisão e o desenho
pretendido. O que existe de fato está no código, nas migrations e nos testes.
O estado atual do sistema fica em [CURRENT_STATE.md](CURRENT_STATE.md).

**Status: nada em execução.** A decisão está tomada; a implementação ainda não
foi planejada em fases nem reservada na portaria.

## O problema

A entrada de NF-e recusa toda nota em que a soma dos produtos não fecha com o
valor total da nota.

Como funciona hoje:

- o leitor de XML tira o total da compra do campo `vNF`, no bloco de totais da
  nota (`src/lib/nfeXml.ts`);
- cada item soma `vProd` menos o `vDesc` daquele item;
- a função `create_xml_payable` compara as duas contas arredondadas a duas casas
  e recusa a nota inteira quando diferem, com a mensagem "A soma dos itens da
  NF-e não fecha com o total informado".

Nenhum outro campo do bloco de totais é lido: nem `vST` (ICMS substituição),
nem `vIPI`, `vFrete`, `vSeg`, `vOutro`, nem o `vDesc` do rodapé.

### Duas portas, um defeito só

1. **Imposto ou despesa por fora.** ICMS substituição, IPI, frete ou despesa
   acessória entram no valor da nota sem estar no preço dos produtos. A nota
   fica maior que a soma dos itens, e trava.
2. **Desconto dado no fechamento.** O sistema lê desconto item por item, mas não
   lê o desconto que o fornecedor lança só no rodapé. A nota fica menor que a
   soma dos itens, e trava igual.

A segunda porta foi encontrada em 2026-09-05, lendo o código; o registro
anterior descrevia somente a primeira. Consertar uma e esquecer a outra deixa
metade das notas problemáticas ainda de fora.

Efeito na operação: a nota não entra e a conta a pagar não nasce. Contorno em
uso: lançar a compra à mão, somando o imposto como se fosse um item.

## A decisão (Rodrigo, 2026-09-05)

**Tudo que a nota cobra além do preço dos produtos entra no custo do insumo.**
Imposto (ICMS substituição e IPI), frete, seguro e outras despesas acessórias.
Desconto concedido no fechamento também é distribuído, reduzindo o custo.

Motivo: o custo do insumo passa a ser o custo real de pôr a mercadoria dentro da
padaria. Se o fornecedor cobra frete para trazer a farinha, aquela farinha
custou isso. É regra única, sem exceção para a operação decorar, e deixa o CMV o
mais fiel possível.

Alternativas apresentadas e descartadas na mesma conversa:

- só o imposto no custo, com frete e despesas como linha separada de despesa;
- imposto e frete no custo, com seguro e outras despesas fora.

As duas deixariam o custo por quilo menor que a realidade e criariam uma regra a
mais para explicar depois.

## Desenho pretendido

Nada disto está implementado. Fica registrado para quem abrir a frente.

1. **Usar o valor do próprio item sempre que a nota informar.** A NF-e traz,
   dentro de cada item, os valores de frete, seguro, desconto e outras despesas
   daquele produto, e traz o ICMS substituição e o IPI no bloco de imposto do
   item. Quando existirem, é esse número que entra no custo, não uma parcela
   calculada. Isso importa: numa nota com refrigerante e farinha, só o
   refrigerante tem substituição tributária, e um rateio proporcional jogaria
   imposto na farinha, mentindo no custo do pão.
2. **Ratear proporcionalmente apenas o que a nota cobra dela inteira**, sem
   dizer de qual item é. A base do rateio é o valor de cada item.
3. **Campo opcional não aceita palpite.** Esses campos por item são opcionais no
   layout fiscal e nem todo emissor preenche. A tela precisa dizer se o número
   veio do próprio item ou de rateio, pela mesma razão que o vencimento da
   parcela já diz (ver `lessons.md`, 2026-08-21). Antes de implementar, conferir
   contra XMLs reais dos fornecedores da padaria quais campos vêm preenchidos.
4. **A sobra de centavos tem dono declarado.** Rateio proporcional não fecha
   exato. O item de maior valor absorve a diferença, como já é feito na divisão
   de parcelas em `buildInstallments`.
5. **Item que não é insumo não vira custo de insumo.** A classificação de itens
   da NF-e já separa o que vira item do catálogo (`mapeado`) do que é uso ou
   despesa (`nao_aplicavel`). O valor rateado continua entrando na conta a pagar
   em qualquer caso; só a atualização de `products.cost_price` fica restrita aos
   itens de catálogo.
6. **A trava do total passa a fechar por construção.** Com o rateio, a soma dos
   itens é igual ao valor da nota por definição. A comparação continua valendo
   como rede de segurança, e passa a acusar erro de cálculo em vez de recusar
   nota legítima.
7. **O valor de conferência contra o papel não se perde.** A tela precisa
   continuar mostrando o valor do item como está na nota, com o custo já rateado
   ao lado ou abaixo. Sem isso, quem confere a nota contra a DANFE não acha os
   números.

## Decisões pendentes

- **Custo das notas já lançadas.** Recomendação: não reescrever o passado. O CMV
  real vem da contagem semanal de inventário, e mexer no histórico quebra a
  comparação entre meses. Falta o martelo do Rodrigo, com o desenho na mão.
- **Efeito nos preços de venda.** O custo dos insumos sobe quando isso entrar, e
  alguns preços vão aparecer defasados na formação de preço. Não é defeito novo:
  é uma conta incompleta ficando completa. Ver
  [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md).

## Fora do escopo

- Estoque e baixa por consumo. O CMV da padaria é por inventário periódico.
- Recuperação de crédito tributário. Aqui o imposto entra como custo, não como
  crédito a recuperar.

## Onde continuar

- Defeitos abertos e estado real: [CURRENT_STATE.md](CURRENT_STATE.md). A
  entrada que descreve este defeito ainda diz que o destino do imposto depende
  de decisão; ela precisa apontar para este documento assim que a reserva do
  arquivo liberar.
- Roadmap, fase 1 "Compras por XML": [PLAN.md](PLAN.md).
- Preço de venda, que consome o custo: [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md).
