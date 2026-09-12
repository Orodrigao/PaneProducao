# COMPRAS_POR_XML.md: entrada de NF-e e custo do insumo

**Criado em:** 2026-09-05, para registrar a decisão de Rodrigo sobre o destino
do imposto, que até então vivia somente na conversa.

**Revisado em:** 2026-09-07, com sete decisões e correções de Rodrigo. A
revisão mudou o documento de forma relevante: rebaixou um suposto defeito à
condição de hipótese, precisou a regra do custo pelo regime tributário da
empresa, proibiu o fechamento de nota por diferença desconhecida e acrescentou
o plano em fases.

**Autoridade:** este documento registra o problema, as decisões e o desenho
pretendido. O que existe de fato está no código, nas migrations e nos testes.
O estado atual do sistema fica em [CURRENT_STATE.md](CURRENT_STATE.md).

**Status: fase 0 executada parcialmente em 2026-09-10 e ampliada em
2026-09-12.** Vinte e quatro arquivos reais, correspondentes a 21 NF-e
distintas, foram conferidos localmente; cinco padrões fiscais viraram fixtures
reduzidas, inteiramente fictícias. Doze notas contêm desconto e encerram a
hipótese sobre onde ele aparece. Alguns casos de borda ainda não têm evidência;
por isso a fase 3 continua limitada aos casos comprovados. Nenhuma regra de
produção mudou.

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

Efeito na operação: a nota não entra e a conta a pagar não nasce. Contorno em
uso: lançar a compra à mão, somando o imposto como se fosse um item.

## A nota já vem com a conta fechada

Este é o fato que organiza todo o resto. O valor total da NF-e não é um número
solto: ele é validado pela SEFAZ antes da autorização, pela regra que gera a
rejeição 610. A composição é esta:

```text
vNF = (vProd - vDesc + vST + vFCPST + vIPI + vIPIDevol
       + vFrete + vSeg + vOutro + vII) - desoneracaoEfetivamenteDeduzida
```

Esta composição é uma referência inicial para as compras de produtos, não
uma fórmula universal para todo XML autorizado. A dedução depende do indicador
`indDeduzDeson` de cada item: com `0`, o `vICMSDeson` não reduz o total;
com `1`, reduz. Indicador ausente não pode ser convertido silenciosamente em
`0` ou `1`: a fase 0 deve documentar a regra aplicável à versão da nota e os
casos aceitos antes da implementação. Não deduzir o total de `vICMSDeson`
indiscriminadamente nem deduzir de novo um abatimento já contabilizado.

Fonte: [NT 2023.004, campo N28b](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?conteudo=hoSIJ5lGBNc%3D).
A fase 0 deve conferir também as regras vigentes, suas exceções e os campos
`vServ` e `indTot`. Autorização da SEFAZ não prova, sozinha, que esta fórmula
simplificada cobre a nota. Resíduo sem explicação bloqueia a confirmação e
exige investigação; não deve ser distribuído nem atribuído automaticamente
a erro do fornecedor ou do ERP.

Hoje o ERP lê três desses valores (`vProd` e `vDesc` por item, e `vNF` como
total) e ignora os outros oito. Por isso toda nota com imposto por fora ou
despesa acessória é recusada.

## A hipótese do desconto foi encerrada

A primeira versão deste documento afirmava que existia um segundo caso: o
fornecedor lançar desconto somente no rodapé da nota, deixando a soma dos itens
maior que o total. **Isso não está comprovado e não deve ser tratado como
defeito confirmado.**

Rodrigo apontou em 2026-09-07 que o padrão da NF-e define o desconto total como
o somatório dos descontos dos itens, e a conferência confirmou: o campo `vDesc`
do bloco de totais é o somatório dos `vDesc` dos itens, e existe rejeição
própria para a divergência (a 537, "Total do desconto difere do somatório dos
itens"). Um emissor conforme, portanto, não consegue lançar desconto só no
rodapé: a nota não seria autorizada.

O que era observação de código (o ERP não lê o `vDesc` do rodapé) virou
conclusão sobre a operação (existem notas assim) sem nenhum XML que
sustentasse a passagem. A ampliação da amostra em 2026-09-12 encerrou essa
hipótese: nas 12 NF-e com desconto, o `vDesc` total corresponde exatamente à
soma dos descontos dos itens. Não apareceu desconto lançado somente no rodapé.
O caso foi descartado para o fluxo suportado; uma divergência entre total e
itens deve continuar bloqueada, não compensada pelo ERP.

## A decisão sobre o custo

**Rodrigo, 2026-09-05, refinada em 2026-09-07.**

A Pane & Salute está no **Simples Nacional**, e isso decide a regra: a empresa
não se credita de ICMS, IPI, PIS ou COFINS. O que vem cobrado na nota de compra
é dinheiro que sai e não volta.

Regra: **o custo do insumo inclui os impostos não recuperáveis e as despesas de
aquisição, e desconta os abatimentos.** Sem somar de novo o que já está dentro
do preço.

| Valor na nota | Como vem | Entra no custo |
| --- | --- | --- |
| `vProd` | por item | Sim, é o preço |
| ICMS próprio | por dentro, já embutido no `vProd` | Não somar de novo, já está no preço |
| `vDesc` | por item | Subtrai |
| `vST` (substituição) | por fora | Sim, não recuperável |
| `vFCPST` (fundo de combate à pobreza sobre ST) | por fora | Sim, não recuperável |
| `vIPI` | por fora | Sim, não recuperável neste regime |
| `vFrete` | por item ou no total | Sim, despesa de aquisição |
| `vSeg` | por item ou no total | Sim, despesa de aquisição |
| `vOutro` | por item ou no total | Sim, despesa de aquisição |
| `vICMSDeson` | depende de `indDeduzDeson` por item | Reduz somente o valor efetivamente deduzido; com indicador `0`, não abater |
| `vIPIDevol`, `vII` | por fora | A confirmar na fase 0, raros neste ramo |

O erro que essa tabela existe para evitar é somar imposto duas vezes. O ICMS
próprio é calculado "por dentro": ele já está no preço que o fornecedor cobra.
Somá-lo ao custo inflaria o custo do insumo e, por consequência, o CMV e o preço
de venda sugerido.

Foram apresentadas e descartadas duas alternativas: só o imposto no custo, com
frete como despesa separada; e imposto mais frete no custo, com seguro e outras
despesas de fora. As duas deixariam o custo por quilo menor que a realidade.

## Como o cálculo deve ser feito

O sistema calcula, a Elis confere. Ela não faz conta.

1. **Primeiro, o que o XML atribui ao próprio item.** A NF-e permite informar
   frete, seguro, desconto e outras despesas dentro de cada item, e informa o
   imposto de cada item no bloco de tributos dele. Quando o valor está lá, é ele
   que entra no custo daquele produto. Numa nota com refrigerante e farinha, só
   o refrigerante tem substituição tributária, e um rateio cego jogaria imposto
   na farinha, mentindo no custo do pão.
2. **Depois, o rateio, apenas de despesa comum identificada.** Rateia-se somente
   o valor que a nota cobra dela inteira e que não foi atribuído a nenhum item.
   A base do rateio é o valor de cada item.
3. **Nunca somar o mesmo valor duas vezes.** Se um valor já veio atribuído ao
   item, ele não entra de novo pelo total. Essa é a armadilha central do
   desenho: os campos do total são somatórios dos campos dos itens, então ler os
   dois e somar dobra o imposto em silêncio.
4. **Nunca distribuir diferença desconhecida para fechar a nota.** Se, depois de
   ler tudo, sobrar valor não explicado, a importação **não se completa**. O
   sistema mostra o valor que não conseguiu explicar. Fechar a conta empurrando
   a sobra para algum item transformaria um erro de leitura em custo errado,
   silenciosamente e para sempre.
5. **Ajuste de centavos tem regra explícita e limite.** Rateio proporcional gera
   sobra de arredondamento, e a regra precisa ser determinística para que a
   regra 4 possa ser aplicada:
   - a parcela de cada item é calculada proporcionalmente e arredondada a duas
     casas, com meio centavo indo para cima;
   - a sobra é a diferença entre o valor a ratear e a soma das parcelas
     arredondadas. Como cada item erra no máximo meio centavo, a sobra é sempre
     menor, em módulo, que o número de itens da nota em centavos;
   - a sobra é distribuída um centavo por item, do item de maior valor para o de
     menor. Em empate de valor, vence o item de menor número de linha, que é
     estável e está no próprio arquivo;
   - nessa etapa, portanto, **nenhum item recebe mais de um centavo**. Somando o
     arredondamento inicial, o desvio de um item em relação ao valor matemático
     exato pode chegar a cerca de um centavo e meio. Esse é o limite real, e é
     ele que deve estar no teste;
   - diferença maior que o número de itens em centavos não é arredondamento: é
     divergência, e cai na regra 4.

A regra 5 existe para que a 4 seja aplicável. Sem um limite declarado e
calculável, qualquer diferença poderia ser chamada de arredondamento, e a
proibição da regra 4 viraria letra morta.

## O fluxo da Elis

O que ela faz hoje, ao lançar uma compra à mão, some. O fluxo pretendido:

1. **Importa o XML.**
2. **Confere na tela**, contra a DANFE em papel ou PDF: o valor dos produtos, os
   acréscimos discriminados (cada imposto e cada despesa com seu nome), os
   descontos e o total a pagar. Os números precisam aparecer como estão na nota,
   para que a conferência seja possível olhando um e outro.
3. **Confirma.**

O que ela **não** faz: calcular rateio, decidir o que é custo, ou criar item
fictício para compensar diferença. Se a tela pedir qualquer uma dessas três
coisas, o desenho está errado.

## Quando a conta não fecha

A tela mostra:

- **o valor que não foi explicado**, em reais, e contra qual conta ele sobrou;
- **a orientação**, em duas linhas: confira o arquivo com o fornecedor; se o XML
  estiver correto, é a leitura do ERP que está falhando, e a equipe técnica
  precisa investigar.

Nunca oferecer um botão que ajuste a diferença para fechar. A saída de quem
está na frente da tela é conferir e escalar, não remendar.

## Importação pendente de conferência

**Esta capacidade não existe hoje** e é pré-requisito do fluxo acima. Hoje a
importação é tudo ou nada: ou completa e gera conta a pagar, ou falha e se
perde.

O que precisa passar a existir: uma importação salva em estado pendente de
conferência, que

- **não gera conta a pagar** enquanto não for confirmada;
- **não atualiza o custo** de nenhum produto enquanto não for confirmada;
- **é retomável** sem refazer o trabalho já feito, inclusive o mapeamento de
  itens para insumos do catálogo, que é a parte cara.

Sem isso, qualquer divergência custa à Elis todo o trabalho de novo, e a
tentação de forçar o fechamento volta pela porta dos fundos.

# Plano em fases

Cada fase cabe em uma conversa e termina testável. A ordem importa: a fase 0
produz a evidência sem a qual as outras são chute, e a fase 3 é a única que
toca dinheiro.

**Aprovação é fase a fase.** Nenhuma fase começa sem o aval de Rodrigo para
aquela fase.

## Fase 0: evidência, com notas reais anonimizadas

**Objetivo.** Sair do layout teórico e descobrir o que os fornecedores da Pane
realmente emitem.

**Escopo.**

- Reunir XMLs reais de compras recentes, cobrindo os casos que importam: nota
  sem nenhum acréscimo; nota com ICMS substituição; nota com IPI; nota com
  frete; nota com desconto; e, se existir, nota com desconto no rodapé não
  espelhado nos itens.
- Anonimizar: CNPJ, razão social, endereço, chave de acesso, números de
  documento e qualquer dado pessoal. Remover integralmente os blocos
  `Signature`, inclusive `X509Certificate`, e os protocolos de autorização
  identificáveis antes de versionar. Não guardar certificado real nem assinatura
  inválida do documento original. Se um teste exigir a estrutura, usar conteúdo
  inteiramente sintético, explicitamente fictício, sem certificado real.
  Preços e quantidades podem ser
  substituídos por valores fictícios desde que a **composição continue
  fechando** pela regra aplicável documentada; casos não suportados
  permanecem exemplos de bloqueio, sem forçar esta fórmula simplificada.
- Guardar em `test/fixtures/`, conforme o contrato de arquivos.
- Conferir o XML final inteiro e adicionar verificação automatizada que recuse
  assinatura/certificado real e identificadores originais nas fixtures. A
  anonimização preserva a composição numérica, não a validade fiscal da assinatura.
- Incluir casos de `indDeduzDeson=0`, `indDeduzDeson=1`, indicador ausente
  e itens com indicadores diferentes. Registrar a versão/regra usada em cada
  caso; ausência de evidência impede liberar a fase 3 para esse caso.
- Produzir uma tabela: para cada campo da fórmula, em quantas notas ele veio
  preenchido, e se veio por item, no total, ou nos dois.
- Fechar dois casos de borda que a fórmula acima não cobre e que podem produzir
  diferença legítima: `vServ` (valor de serviço, que só aparece em nota mista de
  produto e serviço, provavelmente ausente nas compras de insumo, a confirmar) e
  `indTot` (marcador que diz se o valor de um item entra ou não no total da
  nota, usado em bonificação e brinde). Um item com `indTot` zerado produz
  diferença que não é erro e precisa ser tratado antes da fase 3.

**Fora do escopo.** Nenhuma mudança de código de produção.

**Arquivos prováveis.** `test/fixtures/nfe/` com as notas anonimizadas, e um
teste novo em `src/lib/` que lê cada fixture e confere a composição. Nenhum
arquivo de produção é tocado.

**Riscos.** Anonimização mal feita vaza dado de fornecedor. A conferência é
ler o arquivo final inteiro antes de commitar, não confiar no script.

**Critério de aceite.**

- A hipótese do desconto no rodapé está respondida com sim ou não, apoiada em
  arquivo, e o documento é atualizado com a resposta.
- Está escrito quais campos a fase 3 pode contar como presentes e quais precisam
  de tratamento para ausência.

**Testes.** Para cada fixture suportada, conferir a composição pela regra
validada. Para as não suportadas, conferir o bloqueio explícito. O teste
registra a regra aplicável e protege contra alteração indevida das fixtures.

**Rollback.** Trivial, são arquivos de teste.

### Evidência obtida em 2026-09-10 e ampliada em 2026-09-12

A amostra combinada contém 24 arquivos de NF-e versão 4.00. Antes da contagem,
eles foram deduplicados pela identidade fiscal da nota: três cópias foram
excluídas, restando 21 NF-e distintas. Os originais permanecem em uma pasta
privada fora do repositório e não foram versionados. As fixtures são exemplos
reduzidos: preservam a posição dos campos fiscais observados, mas substituem
fornecedor, produtos, documentos, datas, quantidades e valores por conteúdo
fictício. Assinatura, certificado, protocolo, QR Code, responsável técnico e
texto livre não foram copiados.

| Campo ou caso | Notas com valor | Onde apareceu | Resultado |
| --- | ---: | --- | --- |
| Produtos (`vProd`) | 21 de 21 | itens e total | base presente em toda a amostra |
| ST (`vST` no total, `vICMSST` no item) | 2 de 21 | itens e total | usar o item e não somar o total novamente |
| IPI (`vIPI`) | 1 de 21 | itens e total | usar o item e não somar o total novamente |
| Frete (`vFrete`) | 2 de 21 | item e total | usar o item e não somar o total novamente |
| Outras despesas (`vOutro`) | 1 de 21 | itens e total | usar o item e não somar o total novamente |
| ICMS desonerado (`vICMSDeson`) | 1 de 21 | item e total | o indicador era `0`, portanto não reduziu `vNF` |
| Desconto (`vDesc`) | 12 de 21 | itens e total | o total correspondeu à soma dos itens em todas as 12 notas |
| `vFCPST`, seguro, imposto de importação ou serviço | 0 de 21 | ausente | continuam sem evidência real nesta fase |
| Item fora do total (`indTot=0`) | 0 de 21 | ausente | bonificação e brinde continuam sem caso real |

As 21 notas distintas fecharam até o centavo pela composição documentada,
incluindo o caso em que `indDeduzDeson=0` e as 12 notas com desconto. Em todas
as notas com desconto, o total descontado foi exatamente a soma dos itens.
Essa conferência local ficou preservada, sem identificadores nem valores, em
`test/fixtures/nfe/evidence-summary.json`: cada nota registra separadamente se
o total dos produtos e o total do desconto coincidiram com as respectivas somas
dos itens. O arquivo permite reproduzir as contagens da tabela, enquanto os
originais são a única fonte para reauditar os números fiscais. Não apareceu
`indDeduzDeson=1`, indicador misto na mesma nota, `vServ` ou item com
`indTot=0`. Esses casos permanecem bloqueados para a futura fase 3 até existir
evidência real.

Cinco fixtures em `test/fixtures/nfe/` cobrem os padrões encontrados: desconto
por item; sem acréscimos; ST com desoneração não dedutível; frete atribuído ao
item; e ST com IPI e outras despesas. O teste automatizado confirma a conta até o centavo e
recusa assinatura, certificado, protocolo, chave de 44 dígitos e blocos que
possam carregar identificação do documento original. Além das guardas por
campo, o conteúdo inteiro de cada fixture fica selado por hash, normalizando
somente a diferença de quebra de linha entre Windows e Linux: comentário,
atributo, série, texto solto, campo duplicado ou qualquer outro conteúdo novo
exige atualização explícita do teste e nova revisão da anonimização.

## Fase 1: o ERP passa a enxergar a nota inteira

**Objetivo.** Ler todos os campos da composição e mostrar a conferência na tela,
sem mudar custo, conta a pagar ou o que é aceito.

**Escopo.**

- `src/lib/nfeXml.ts` passa a ler os campos do bloco de totais e os
  equivalentes por item, incluindo `indDeduzDeson` e sua ausência explícita.
- Uma função nova, isolada e testada, que recebe a nota lida e devolve a
  composição: produtos, cada acréscimo com seu nome, descontos, total, e o
  valor não explicado (que deve ser zero).
- A tela de importação mostra essa composição.
- Quando não fecha, a tela mostra o valor não explicado e a orientação da seção
  anterior, em vez da mensagem atual, que não diz o que fazer.

**Fora do escopo.** Custo, conta a pagar e a trava do banco não mudam. Nota que
hoje é recusada continua recusada, mas agora explicada.

**Arquivos prováveis.** `src/lib/nfeXml.ts`, `src/lib/nfeXml.test.ts`, uma
função nova em `src/lib/` com teste próprio, `src/components/XmlPayableImport.tsx`.

**Riscos.** Médio: muda o fluxo de conferência usado na operação. Nada do que a fase escreve chega ao banco. O risco real é de
UI: poluir a tela de importação com números que a Elis não precisa. Mitigação:
mostrar a composição resumida, com o detalhe atrás de um toque.

**Critério de aceite.** Para cada caso suportado com regra validada na fase 0,
a tela mostra a composição correta e resíduo zero. Casos sem regra validada
(incluindo indicador ausente ainda não esclarecido) mostram bloqueio explícito;
o teste exige a recusa, nunca um ajuste para zerar o resíduo.

**Testes.** Unidade sobre as fixtures, cobrindo campo ausente, campo zerado e
valor só no item, só no total, e nos dois.

**Rollback.** Reverter o PR. Nenhum dado gravado.

## Fase 2: importação pendente de conferência

**Objetivo.** Permitir salvar uma importação sem que ela vire dinheiro.

**Escopo.**

- Estado novo de importação, persistido, que não gera conta a pagar nem
  atualiza custo.
- Retomada: reabrir a importação com o mapeamento de itens já feito preservado.
- Descarte explícito de uma importação pendente.
- Gate financeiro desde a criação: RLS habilitado e forçado, leitura limitada
  ao perfil e escopo autorizados, escrita direta revogada e mutações somente
  por RPC que valide sessão, permissão e escopo no banco. Grants explícitos;
  se usar `SECURITY DEFINER`, `search_path` seguro e privilégio mínimo.
- Idempotência e proteção contra concorrência: reenvio ou duplo toque não
  cria outra importação; definir a chave por documento e escopo. A confirmação
  repetida não pode criar duas contas. Não usar menu como autorização.

**Fora do escopo.** O cálculo do custo com acréscimos continua sendo o da fase 3.

**Arquivos prováveis.** Migration nova, `src/lib/payables.ts`,
`src/components/XmlPayableImport.tsx`, testes pgTAP.

**Riscos.** Alto: mexe em schema e na fronteira do que vira conta a
pagar. Uma importação pendente que gere conta por engano cria dívida falsa.
Mitigação: gate financeiro e testes de acesso, concorrência e repetição, além de teste pgTAP que prova que importação pendente não produz linha em
contas a pagar nem altera `cost_price`.

**Critério de aceite.** Importar, sair da tela, voltar e continuar de onde
parou, sem que nada tenha aparecido no financeiro nem no custo.

**Testes e aceite de segurança.** pgTAP e navegador com um perfil permitido
E um bloqueado, incluindo leitura e mutação fora do escopo, tentativa direta
pela Data API, retomada, descarte, reenvio e concorrência. Comprovar ausência
de conta/custo no rascunho e ausência de duplicata. Conferir grants, RLS e RPC;
nenhuma fase é aceita só porque a interface escondeu o botão.

**Rollback.** Migration só de ida; o rollback é uma migration nova que remove o
estado, possível enquanto nenhuma importação pendente real existir.

## Fase 3: o custo passa a incluir os não recuperáveis

**Frente financeira. Área crítica: dinheiro, migration e função do banco. Não
desce para ajudante e exige aprovação específica.**

**Objetivo.** Aplicar a decisão do custo, com atribuição por item, rateio só do
que é comum, e recusa de diferença desconhecida.

**Escopo.**

- Atribuição por item e rateio das despesas comuns, com a regra de centavos da
  seção anterior.
- O custo do produto passa a considerar o valor com acréscimos; o valor
  original do item continua guardado e visível, para conferência contra a
  DANFE.
- A trava do total passa a exigir composição explicada, em vez de igualdade
  entre soma dos produtos e total.

**Fora do escopo.** **Notas já lançadas não são reprocessadas.** Decisão de
Rodrigo em 2026-09-07. O custo histórico permanece como está; o CMV real vem da
contagem semanal de inventário, e reescrever o passado quebraria a comparação
entre meses.

**Arquivos prováveis.** Migration redefinindo `create_xml_payable`,
`src/lib/payables.ts`, a função de rateio com teste próprio, testes pgTAP.

**Riscos.** Altos e de dinheiro:

- somar imposto duas vezes, inflando custo, CMV e preço sugerido. É o risco
  principal e o teste tem de mirar nele diretamente;
- rateio que fecha a nota escondendo erro de leitura, exatamente o que a regra 4
  proíbe;
- o site e o banco chegam separados no mesmo merge, então a função nova precisa
  conviver com a versão do site que está no ar.

**Critério de aceite.**

- Cada fixture suportada, com regra validada na fase 0, importa e o custo resultante bate com o valor calculado
  à mão, conferido por Rodrigo em pelo menos uma versão anonimizada de nota
  real. O original permanece fora do ambiente de teste.
- Casos sem regra validada permanecem bloqueados, inclusive indicador ausente
  sem interpretação comprovada.
- Uma nota fabricada com diferença inexplicável é recusada, com o valor não
  explicado na tela.
- Nenhum produto fora do catálogo tem custo atualizado.

**Testes.** pgTAP sobre a função, unidade sobre o rateio (incluindo a sobra de
centavos e o caso de valor presente no item e no total), e conferência manual
da versão anonimizada por Rodrigo no preview. Comparação com o original
acontece fora do preview; não enviar dados reais ao ambiente de teste.

**Rollback.** Migration nova revertendo a função para a versão anterior. Como
custo já gravado não volta sozinho, a fase precisa ser aprovada com o
entendimento de que o custo dos produtos tocados muda a partir dali.

## Decisões pendentes

- **Efeito nos preços de venda.** O custo dos insumos sobe quando a fase 3
  entrar, e alguns preços vão aparecer defasados na formação de preço. Não é
  defeito novo: é uma conta incompleta ficando completa. Cabe decidir se a
  revisão de preços acompanha a fase 3 ou vem depois. Ver
  [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md).

## Fora do escopo

- Estoque e baixa por consumo. O CMV da padaria é por inventário periódico.
- Recuperação de crédito tributário. A empresa está no Simples Nacional; o
  imposto entra como custo, não como crédito a recuperar. Se o regime mudar, a
  regra do custo muda junto e este documento precisa ser revisto.

## Onde continuar

- Defeitos abertos e estado real: [CURRENT_STATE.md](CURRENT_STATE.md).
  A decisão sobre o custo está registrada; a implementação continua pendente,
  começando pela evidência da fase 0 e com aprovação própria por fase.
- Roadmap, fase 1 "Compras por XML": [PLAN.md](PLAN.md).
- Preço de venda, que consome o custo: [FORMACAO_DE_PRECO.md](FORMACAO_DE_PRECO.md).
