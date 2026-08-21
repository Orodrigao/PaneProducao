# Plano — Quantidade realmente enviada em Pedidos PJ

**Origem do pedido:** Rodrigo, 2026-08-20, com o nome "peso real em pedidos PJ".
A descoberta mostrou que o problema é maior que peso — ver decisão 1.

**Status:** descoberta concluída, **duas revisões adversariais independentes
recebidas e incorporadas**, plano emendado absorvendo os bloqueadores das
duas. **Aguardando aprovação do Rodrigo para a fase 1.** Nenhuma linha de
código foi escrita.

**Histórico:** aberto como PR #247 numa sessão de nuvem; o PR foi fechado pelo
GitHub quando a branch foi renomeada para a convenção do `AGENTS.md`. Continua
em PR #248, mesmo conteúdo e mesmo commit de origem.

**Risco:** ALTO. O número digitado pela Expedição vira, na mesma transação, o
valor da cobrança do cliente. Aprovação fase a fase.

**Sessão de origem:** Claude Code em ambiente de nuvem, branch
`claude/peso-real-pedidos-pj-kfamrj`. A continuação será local.

---

## O problema operacional

A Elis (perfil `financeiro`) lança o pedido PJ com uma estimativa: "3 kg de
mini-croissant", "50 pães de cachorro-quente de 21 cm". Na separação, sai o que
a massa rendeu — 3,067 kg, 55 unidades. Hoje o sistema cobra a estimativa,
porque a cobrança nasce de `quantidade × preço` no clique de "Marcar como
enviado". Resultado: a padaria entrega uma coisa e fatura outra.

Rodrigo, sobre o tamanho da diferença: para produto de encomenda exclusiva
tenta-se vender a fornada inteira; para produto de balcão manda-se o mais
próximo possível do pedido. Nos dois casos a diferença é pequena — "se o pedido
é 3000 g, deve sair 3067 g ou 2995 g", não 3500 g.

## Medição em produção (leitura live somente leitura, 2026-08-20)

| Mês | Pedidos PJ | Linhas por kg | Linhas por unidade | Pedidos com envio confirmado |
|---|---|---|---|---|
| jun/2026 | 27 | 11 | 43 | 0 |
| jul/2026 | 45 | 42 | 82 | 7 |
| ago/2026 | 65 | 56 | 111 | **61** |

Agosto até 20/08, pedidos não cancelados: **R$ 23.534,37** em pedidos PJ, dos
quais **R$ 7.056,00 (30,0%) vêm de linhas vendidas por quilo**.

Dois fatos que sustentam o plano:

1. **A adoção do "Marcar como enviado" mudou.** Em 2026-08-13 eram 1 em 116
   pedidos (medição registrada em `docs/CONTAS_A_RECEBER.md`, fase 3). Em
   agosto são 61 em 65. Pendurar a conferência nesse momento funciona.
2. **Um terço do dinheiro passa por estimativa de peso**, e as linhas por
   unidade que rendem a mais (50 pedidos → 55 enviados) somam por cima disso.
   Ninguém nunca registrou o real, então o tamanho do vazamento é desconhecido
   — e a fase 1 existe justamente para medi-lo.

## O que a auditoria do código encontrou

- `/pedidos-pj` (`src/app/pedidos-pj/page.tsx`, 891 linhas) tem dois modos,
  resolvidos em `src/lib/pjOrderDispatch.ts`: **comercial** (`admin`,
  `financeiro`) e **dispatch** (`expedicao` + loja `jc`). O modo dispatch não
  exibe nenhum valor em R$.
- A Expedição **não tem policy de SELECT nem de UPDATE** em `public.orders`
  para `order_type='pj'` — a policy `orders_select_authenticated_profiles`
  exclui explicitamente esse cruzamento. Ela só lê pela RPC
  `public.list_pj_orders_for_dispatch()` e só escreve pela RPC
  `public.confirm_pj_order_dispatch(uuid)`, ambas `SECURITY DEFINER`, com a
  permissão granular `pedidos_pj.confirmar_envio` e escopo `*` ou `jc`.
- Um pedido PJ é um **grupo de linhas** em `public.orders` ligadas por
  `order_group_id`. Colunas relevantes: `quantity numeric(12,3)`, `unit_price`,
  `pack_size`, `pricing_unit ('un'|'kg')`, `dispatched_at/by/by_name`,
  `cancelled_at`.
- Confirmar o envio gera a cobrança **na mesma transação**, por
  `private.build_receivable_from_pj_order`, que soma
  `sum(quantity * coalesce(unit_price, 0))`. **É esta linha que precisa mudar
  na fase 2.**
- **Atenção — a versão vigente dessa função NÃO é a que a criou.** Ela foi
  redefinida três vezes: `20260813215830` (criação), `20260814091757`
  (fuso da padaria) e **`20260814165657_dividir_cobranca_em_parcelas.sql:451`,
  que é a vigente** e já usa `private.emitir_cobrancas`,
  `private.data_na_padaria()` e `p_extra_details`. Partir de qualquer arquivo
  anterior apaga essas melhorias em silêncio — lição
  `funcao-de-banco-redefinida-perde-melhoria-recente`. Confirmado por
  `grep -l` nas migrations em 2026-08-20.
- Travas existentes: `private.guard_dispatched_pj_order_changes` (pedido
  enviado não muda), `private.guard_billed_pj_order_changes` e
  `..._delete` (pedido cobrado não muda nem some).
- **Não existe nenhuma função que altere o VALOR de uma cobrança já criada.**
  Existem `cancel_receivable`, `correct_receivable_due_date`,
  `split_receivable`, `record_receivable_receipt`, `reverse_receivable_receipt`
  — e mais nada. Foi desenhado assim de propósito. Corrigir valor, portanto, é
  **cancelar e regerar**, nunca `UPDATE`.

## Decisões tomadas por Rodrigo (2026-08-20)

1. **Não é só peso.** O campo é *quantidade realmente enviada* e vale para kg
   E para unidade. O caso "pedi 50 pães, a massa rendeu 55, mando 55" é o mesmo
   problema. Um campo só de peso resolveria menos da metade.
2. A estimativa da Elis é **preservada**; o real entra em coluna nova. Previsto
   E realizado, conforme a regra da casa em `AGENTS.md`.
3. **Janela de correção:** depois do envio, dá para corrigir **enquanto o
   cliente não pagou nada**. O primeiro recebimento trava.
4. **Quem corrige depois do envio:** apenas `financeiro`/`admin`. A Expedição
   avisa. Antes do envio, a Expedição corrige à vontade.
5. **Pode sair menos, e pode um item não ir nenhum.** A tela aceita os dois.
6. ~~Duas travas, não uma~~ — **substituída pela decisão 12**, depois do teste
   do Rodrigo no preview em 2026-08-21. O bloqueio duro por proporção saiu; o
   que ficou é uma pergunta bem feita. Ver decisão 12.
7. **Relatório estimado × real:** sim, mas em fase separada, depois de haver
   dado real acumulado.
8. **Sem retroatividade:** pedidos já enviados não recebem quantidade real.

### Decisões acrescentadas em 2026-08-20, depois das revisões

9. **A correção fica pronta antes de o dinheiro depender do número.** Na ordem
   original havia um intervalo em que a cobrança já usava o real e ainda não
   existia tela para corrigir: o erro de tara que motivou a decisão 3 viraria
   fatura sem caminho de volta. Consequência aceita conscientemente: **a
   virada e a correção viram uma fase só**, maior que as outras. Separá-las só
   produz ou a janela sem conserto, ou um mecanismo de cancelar-e-regerar
   construído antes de existir o que corrigir, que o `AGENTS.md` proíbe ("não
   criar abstração sem consumidor real"). É uma unidade de risco indivisível.

10. ~~Teto duro de 3x para cima e 1/3 para baixo~~ — **revogada pela decisão
    12**, em 2026-08-21, depois do Rodrigo testar no preview e a trava barrar
    um número plausível.

11. **Item não enviado não impede a cobrança dos demais.** O item que não saiu
    sai da conta, o resto do pedido é faturado, e o motivo da falta fica
    registrado para a Elis. O cliente paga pelo que recebeu. Atenção de
    implementação: isso **não** é o caminho do item cancelado, que hoje
    derruba a cobrança do pedido inteiro; e o caso de **nada** enviado é o
    bloqueador 4, que não pode abortar o envio.

### Decisão tomada em 2026-08-21, depois do teste no preview

12. **A trava é uma pergunta, não uma barreira.** A tela pára quando a
    diferença passa de **10% no quilo** ou **20% na unidade**, mostra o pedido
    e o digitado lado a lado — "O pedido é de 42 un e você digitou 80 un.
    Confirma?" — e exige o motivo escrito. **Não existe recusa por
    quantidade.**

    O argumento do Rodrigo, que derrubou o desenho anterior: barreira por
    tamanho pega 420 no lugar de 42, mas **não pega 80 no lugar de 42** — e 80
    é o engano que realmente acontece. Uma trava que só pega o absurdo dá
    sensação de proteção sem proteger do caso comum. O que protege é a pessoa
    ver os dois números juntos.

    O quilo pergunta antes da unidade porque peso erra por tara, por balança
    desregulada, por unidade trocada; contagem erra menos.

    Continua sendo recusa o que não é questão de quantidade: número negativo e
    fração em item vendido por unidade.

    **Risco residual, aceito conscientemente:** quem confirmar por hábito grava
    o número errado, inclusive gramas num campo de quilo. Na fase 1 isso é
    inofensivo, porque nada aqui vira dinheiro. **Na fase 2 a trava de saída
    por linha deixa de ser desejável e passa a ser obrigatória** — é a lição
    `validar-tambem-na-saida`, que nasceu de um erro de R$ 190 mil causado
    exatamente por dado envenenado antes de o bloqueio existir.

### Caso que originou a decisão 3

A Expedição pesa o mini-croissant e esquece de descontar a tara da bandeja.
Anota 2,5 kg em vez de 3,0 kg, salva e confirma o envio. Percebe o erro logo
depois. Sem janela de correção, a única saída seria criar um pedido novo do
zero. Foi pedido explícito da Elis que exista edição.

## Plano — 3 fases

A ordem é deliberada: **a fase que liga o dinheiro vem depois da fase que
coleta o dado.**

Ordem emendada em 2026-08-20 (decisão 9): eram 4 fases, são 3. A antiga fase 3
(correção) foi fundida com a antiga fase 2 (a virada), porque a correção
precisa existir no dia em que a cobrança passa a depender do número.

| Fase | O que muda na padaria | Mexe em dinheiro? | Quem executa |
|---|---|---|---|
| 1 | Expedição confere e digita a quantidade enviada de cada item; salva e corrige à vontade. "Marcar como enviado" exige tudo conferido. **A cobrança continua saindo pela estimativa**, com aviso fixo na tela dizendo isso. | Não | agente principal (migration, RPC) + operário (tela, sob revisão) |
| 2 | A cobrança passa a usar a quantidade enviada **e**, no mesmo pacote, o financeiro ganha "Corrigir quantidade enviada" no pedido já enviado. | Sim | agente principal, sozinho |
| 3 | Relatório pedido × enviado por produto e mês. | Não | operário, sob revisão |

Entre a fase 1 e a fase 2 fica um intervalo de uso real. Nele se mede, com
número, o quanto a estimativa erra e se a Expedição adotou a conferência —
antes de a cobrança depender dela. Justificativa nas lições
`status-deduzido-de-data-nao-e-fato` e `adocao-se-mede-no-ciclo-inteiro`.

### Fase 1 — conferência da quantidade enviada

Emendada em 2026-08-20 absorvendo os bloqueadores 3, 5 e 8 e os riscos 11 a
14, 16 e 17 da seção de revisões. Itens marcados **(R)** nasceram das revisões.

- Coluna nova em `public.orders` para a quantidade enviada, mais autoria e
  carimbo de tempo **por linha**, não por grupo (risco 14).
- **(R) Três estados, sem ambiguidade:** `null` = ainda não conferido; `0` =
  conferido e não enviado, **com motivo obrigatório**; positivo = enviado. O
  botão "não enviei este item" grava **zero**, nunca ausência — se gravasse
  `null`, o `coalesce(enviado, estimado)` da fase 2 cobraria do cliente
  justamente o item que não saiu. `numeric(12,3)` com `check (>= 0)`.
- **(R) A conferência acontece na mesma unidade em que o pedido foi digitado**
  (bloqueador 8, o erro mais provável de todos): quem separa conta caixas, o
  banco guarda unidades. A tela mostra "12 cx × 21 = 252 un" com o equivalente
  ao lado, e trata `pack_size`/`pricing_unit` nulos do legado.
- RPC nova para a Expedição JC gravar, com a mesma permissão
  `pedidos_pj.confirmar_envio`, aplicando a regra da decisão 12: pergunta
  acima de 10% no quilo e 20% na unidade, com motivo obrigatório, e recusa
  apenas o que não é questão de quantidade.
- **(R) Validação estrutural:** item por unidade só aceita inteiro; item por
  quilo respeita a precisão de `numeric(12,3)`; a unidade do pedido não muda
  durante a expedição.
- **(R) Acrescentar a coluna nova e o carimbo à lista de colunas do gatilho**
  `guard_billed_pj_order_changes`, na mesma migration que cria a coluna
  (bloqueador 3). O gatilho tem lista fixa e não cobriria a coluna nova.
- **(R) Concorrência e repetição:** salvar e confirmar travam as mesmas linhas
  na mesma ordem e revalidam depois da trava; o salvamento leva a versão que a
  tela abriu e recusa se alguém mudou no meio, em vez de deixar vencer quem
  salvou por último; toda ação leva `p_request_id` e deduplica, como as demais
  funções de Contas a Receber já fazem (risco 17).
- **(R) Histórico das alterações**, não só a última digitação. Numa contestação
  é preciso provar quem digitou 3,067 e quem trocou por 3,670, com o motivo.
- **(R) Enquanto houver conferência pendente, o pedido não sai da fila** da
  Expedição à meia-noite: fica em "Em aberto" com marca de atrasado (risco 13).
- **(R) Contador de adoção por etapa** — conferido / enviado / cobrado — desde
  o primeiro dia, porque adoção se mede por etapa do ciclo, nunca por total
  agregado (risco 11).
- `list_pj_orders_for_dispatch` passa a devolver os dois números. **Mudar o
  tipo de retorno exige `drop` + `create`, e o `drop` perde os grants**:
  reconceder explicitamente e revogar de `public, anon` na mesma migration
  (risco 16, lição `grants-implicitos-variam-por-ambiente`).
- Tela: bloco de conferência item a item, salvável e corrigível quantas vezes
  quiser enquanto o pedido não foi enviado.
- "Marcar como enviado" bloqueia enquanto houver item não conferido, **com o
  motivo escrito na tela, ao lado do botão** — nunca em `title`/tooltip (lição
  `botao-desabilitado-sem-motivo-na-tela`).
- **(R) Aviso fixo na tela** dizendo que a conferência ainda não altera a
  cobrança, com o prazo escrito da fase 1 (risco 12). Sem isso, as duas
  pessoas descobrem sozinhas que o sistema cobra errado e abandonam a
  conferência antes de a fase 2 existir.
- Aceite: expedição JC consegue; vendas JA é bloqueada. Matriz nos dois
  sentidos, no navegador. A matriz inclui os casos do bloqueador 4 (nada
  enviado) e do bloqueador 8 (item com `pack_size > 1`).

### Fase 2 — a cobrança passa a usar o real, com a correção junto

As duas metades vão no mesmo pacote (decisão 9). A correção precisa estar
testada e no ar no mesmo dia em que a cobrança passa a depender do número.

**Metade A — a virada:**

- **cinco pontos calculam esse valor hoje, não um.** Todos mudam no mesmo
  commit, com teste que compara os números para o mesmo grupo:
  `private.build_receivable_from_pj_order` (o motor),
  `public.list_pj_orders_to_bill` (a lista "a faturar" da Elis),
  `src/lib/pjSalesReport.ts` com `src/app/relatorios/pj/page.tsx` (o relatório
  de Vendas PJ, risco 6) e as duas somas da tela em
  `src/app/pedidos-pj/page.tsx` (linhas 415 e 811). Mudar só o motor faz a
  tela e o relatório mostrarem um número e a cobrança gerar outro;
- **fechar o caminho que fatura antes da conferência** (bloqueador 1):
  `list_pj_orders_to_bill` trata como entregue também quem só tem
  `delivery_date` vencida, sem envio confirmado. Passa a excluir, ou marcar
  como "aguardando conferência", pedido com item não conferido; e
  `create_receivable_from_pj_order` recusa esse caso com mensagem clara;
- **nada enviado não aborta o envio** (bloqueador 4): o motor separa "sem
  preço cadastrado" (erro) de "nada foi enviado" (fato legítimo, cliente
  recusou na porta). Grava o envio, não gera cobrança, e o pedido aparece numa
  lista de enviados sem cobrança — lição `sobras-pendentes-sem-saida`;
- a base do valor (`estimado` ou `real_enviado`) fica gravada no evento
  `lancada` da cobrança. Sem isso a coorte da fase 1 é irreconciliável depois;
- para pedido posterior à virada, **ausência do real bloqueia a cobrança**. O
  `coalesce(enviado, estimado)` fica restrito ao legado identificado, senão
  esconde justamente o dado que faltou;
- **trava de saída por linha e absoluta, agora OBRIGATÓRIA** e não mais
  desejável. A decisão 12 tirou a recusa da entrada, então esta é a única porta
  que sobra entre um número confirmado por hábito e a fatura do cliente.
  Espelha as três travas da cobrança da Buck: teto de kg por linha, teto de
  fator por linha (recusa, não confirmação) e piso simétrico. A trava do dobro
  sobre o total do pedido, do plano original, não serve: num pedido de
  R$ 5.000, digitar 30 kg em vez de 3,067 kg dá fator 1,48 e passaria
  (bloqueador 5);
- arredondar **cada linha** a centavos e somar as linhas, mesmo critério nos
  cinco pontos;
- redefinir `private.build_receivable_from_pj_order` partindo da **versão
  vigente**, que está em
  `supabase/migrations/20260814165657_dividir_cobranca_em_parcelas.sql:451`.

**Metade B — a correção depois do envio:**

- função nova, `SECURITY DEFINER`, só para `financeiro`/`admin`: numa transação
  só, cancela **todas as cobranças vivas do grupo** com motivo, atualiza a
  quantidade enviada e regera pelo mesmo motor. São várias porque
  `split_receivable` copia `origin_ref` para cada parcela, com índice único por
  `(origin, origin_ref, installment_number)` (risco 7). Preserva o
  parcelamento e o prazo efetivo, e mostra na tela o que vai mudar antes do
  clique;
- bloqueada se **qualquer parcela** tiver recebimento ativo; recebimento
  estornado não fecha a janela, que é o critério que `split_receivable` já usa;
- precisa de `perform set_config('pane.pj_dispatch_rpc','on',true)`, senão o
  gatilho `guard_dispatched_pj_order_changes` recusa o `UPDATE` em pedido
  enviado. **Cuidado: esse GUC é chave-mestra** e também desliga a proteção de
  `dispatched_at/by/by_name` — atualizar só as colunas pretendidas e provar em
  pgTAP que `dispatched_at` não mudou (risco 9);
- **não reaproveitar o fluxo de edição comercial**:
  `orderLinePacksFromStoredQuantity` arredonda, e 55 com `pack_size` 21 vira
  63 ao reabrir e salvar (risco 18);
- `p_request_id` para repetição segura: chamar duas vezes não pode cancelar a
  cobrança recém-gerada e criar histórico falso;
- **decidir antes de começar onde a tela mora** (risco 10): `admin` não alcança
  `/contas-receber` hoje, então ou a correção mora em `/pedidos-pj`, ou
  `/contas-receber` entra nas rotas do admin. Sem isso o Rodrigo não consegue
  testar a própria fase no preview. Conferir as quatro listas da lição
  `tela-nova-precisa-do-menu`;
- a cobrança cancelada permanece no histórico. O rastro é a razão de não
  sobrescrever valor.

### Fase 3 — estimado × real

Relatório por produto e por mês. Só depois de haver dado acumulado. Precisa
separar legado, sombra e real e mostrar a cobertura da medição: `null` antigo
significa "não medido", nunca "igual ao estimado" nem "não enviado". A base de
data (entrega ou envio) é a mesma escolhida na fase 2, e passa por
`private.data_na_padaria(...)`.

## Fora de escopo

- Retroatividade em pedidos já enviados.
- Alterar a contagem de `pack_size` para itens vendidos em pacote.
- Qualquer mudança no romaneio ou na produção.
- Diferença cobrada depois de o cliente já ter pago (decisão 3 fecha a janela).

## Revisão adversarial (2026-08-20)

Exigida pelo `AGENTS.md` para plano com dado financeiro. Executada por um
agente limpo, sem o contexto da conversa de descoberta, com a pergunta única
"o que falta neste plano que qualquer sistema desse tipo tem?".

Duas ressalvas de honestidade sobre esta revisão:

- as consultas dele ao banco de produção foram **negadas**, então nenhum
  achado abaixo se apoia em dado live — só em código e migrations;
- eu conferi pessoalmente no código os itens marcados **[conferido]**. Os
  marcados **[apontado]** são do revisor e ainda não foram verificados por
  mim; verifique antes de agir.

### Erro de premissa do plano original — [conferido]

O plano indicava a migration errada para a fase 2. Ver a correção já aplicada
na seção "O que a auditoria do código encontrou". Foi erro meu, não do plano
do Rodrigo.

### Bloqueadores — resolver antes de escrever a fase 1

1. **A cobrança pode nascer ANTES da conferência, e a fase 2 não fechava esse
   caminho.** — [conferido] `public.list_pj_orders_to_bill`
   (`20260814091757:520-540`) trata como entregue também
   `delivery_date <= private.data_na_padaria()`, **sem exigir envio
   confirmado**. Se a Elis faturar de manhã e a Expedição conferir de tarde, o
   motor encontra a cobrança viva pelo dedupe e a devolve — o valor real nunca
   entra. Hoje esse é o caminho principal de faturamento.
   **Correção:** a lista passa a excluir (ou marcar como "aguardando
   conferência") pedido PJ com itens não conferidos e entrega recente; e
   `create_receivable_from_pj_order` recusa esse caso com mensagem clara.
   **Entra na fase 2, com o gancho previsto já na fase 1.**

2. **A mesma conta vive em dois lugares e o plano só citava um.** —
   [conferido] `sum(quantity * coalesce(unit_price,0))` aparece no motor
   (`20260814165657:451`) **e** em `list_pj_orders_to_bill`
   (`20260814091757:520`). Trocar só o motor faria o painel mostrar um valor e
   o clique gerar outro. É a mesma dívida de `romaneioBilling.ts` ×
   `private.calcular_cobranca_buck` já registrada no `CURRENT_STATE.md` — não
   replicar de propósito. **Mudam no mesmo commit, com teste pgTAP que compara
   os dois números para o mesmo grupo. Fase 2.**

3. **A trava de "pedido já cobrado" não cobriria a coluna nova.** —
   [conferido] O gatilho é
   `before update of quantity, unit_price, pack_size, customer_id,
   delivery_date, cancelled_at` (`20260813215830:422`). Coluna nova não está
   na lista, e `orders_update_authenticated_profiles` (baseline `:3622`)
   permite `UPDATE` em qualquer linha PJ para `admin` e `financeiro`.
   **Acrescentar a coluna nova e o carimbo de conferência à lista do gatilho,
   na mesma migration que cria a coluna. Fase 1, não fase 2.**

4. **Pedido em que nada foi enviado travaria o envio inteiro.** — [conferido]
   O motor levanta exceção quando o valor é zero, com a mensagem "Pedido sem
   preço não vira cobrança. Confira a tabela de preço do cliente"; e
   `list_pj_orders_to_bill` filtra `amount > 0`. Como
   `confirm_pj_order_dispatch` chama o motor com `perform` na mesma transação,
   a exceção aborta o envio. Cenário real: cliente recusa a entrega na porta,
   a Expedição marca os 3 itens como "não enviei" e não consegue mais fechar o
   pedido — lição `sobras-pendentes-sem-saida`.
   **O motor precisa separar "sem preço cadastrado" (erro) de "nada foi
   enviado" (fato legítimo): grava o envio, não gera cobrança, e o pedido
   aparece numa lista de enviados sem cobrança. Fase 2, com o caso já na
   matriz de teste da fase 1.**

5. **A trava de saída da fase 2 tinha a forma errada.** — [apontado] "Dobro do
   valor estimado do pedido" é agregada e só olha para cima. Num pedido de
   R$ 5.000, digitar 30 kg em vez de 3,067 kg dá fator 1,48 e **passa**; e
   0,3 kg em vez de 3 kg não dispara nada.
   **Trocar por trava por linha e absoluta, espelhando as três travas da
   cobrança da Buck: teto de kg por linha, teto de fator por linha (recusa,
   não confirmação) e piso simétrico. Confirmação escrita é para a faixa
   cinzenta; para o absurdo, recusa. Fases 1 (entrada) e 2 (saída).**

### Riscos altos

6. **O relatório de Vendas PJ passa a mentir depois da fase 2.** — [apontado]
   `src/app/relatorios/pj/page.tsx` e `src/lib/pjSalesReport.ts` somam
   `unit_price × quantity` direto de `orders`. Com 30% do valor vindo de
   linhas por kg, Relatórios e Contas a Receber passariam a dar números
   diferentes para a mesma pergunta. **Ajustar o relatório existente na fase
   2 — não esperar a fase do relatório novo (fase 3 na numeração emendada).**

7. **A fase 3 ignorava que uma cobrança de pedido pode ser várias.** —
   [apontado] `public.split_receivable` cria N parcelas vivas com o mesmo
   `origin_ref`, e o índice único é por `(origin, origin_ref,
   installment_number)`. Cancelar "a cobrança" no singular quebra ou duplica.
   **A correção varre todas as cobranças vivas do `origin_ref`, recusa se
   qualquer uma tiver recebimento, preserva o parcelamento e o prazo efetivo,
   e mostra na tela o que vai mudar antes do clique. Fase 3.**

8. **`pack_size` torna a conferência ambígua — o erro mais provável de
   todos.** — [conferido] A linha grava `quantity = packs × pack_size`
   (`src/app/pedidos-pj/page.tsx:334`) e `unit_price` é por unidade. O plano
   não dizia em que unidade a Expedição digita. Quem separa conta caixas; o
   banco guarda unidades. Digitar 12 onde o pedido diz 252 dá −95%, a trava
   dos 20% pede confirmação, a pessoa confirma por hábito, e a cobrança sai
   por uma fração do valor.
   **A conferência acontece na MESMA unidade em que o pedido foi digitado,
   com a tela mostrando "12 cx × 21 = 252 un" e o equivalente ao lado. Tratar
   `pack_size` e `pricing_unit` nulos (existem linhas legadas assim).
   Fase 1.**

9. **A fase 3 esbarra num gatilho que o plano não mencionava.** — [conferido]
   `guard_dispatched_pj_order_changes` é `BEFORE DELETE OR UPDATE ... FOR EACH
   ROW` **sem lista de colunas** (baseline `:3062`): qualquer `UPDATE` em
   linha PJ já enviada é recusado sem o GUC `pane.pj_dispatch_rpc`.
   **A função de correção precisa de
   `perform set_config('pane.pj_dispatch_rpc','on',true)`. Cuidado: esse GUC é
   chave-mestra e também desliga a proteção de `dispatched_at/by/by_name` —
   atualizar só as colunas pretendidas e provar em pgTAP que `dispatched_at`
   não mudou. Fase 3.**

10. **`admin` não alcança `/contas-receber` — a fase 3 nasceria inutilizável
    para o Rodrigo.** — [apontado, mas coerente com o `CURRENT_STATE.md`, que
    já registra o mesmo] Na prática só a Elis corrigiria, e o Rodrigo não
    conseguiria testar a fase 3 no preview.
    **Decidir antes da fase 3: ou a tela de correção mora em `/pedidos-pj`
    (que o admin alcança), ou `/contas-receber` entra nas rotas do admin.
    Conferir as quatro listas da lição `tela-nova-precisa-do-menu`.**

11. **"A Expedição avisa" não é mecanismo.** — [apontado] Não existe lugar
    onde a Elis veja que um pedido saiu diferente do combinado.
    **Criar uma lista de "pedidos enviados com diferença" na tela do
    financeiro (fase 3) e um contador de adoção por etapa — conferido /
    enviado / cobrado — já na fase 1, porque adoção se mede por etapa do
    ciclo, nunca por total agregado.**

12. **A fase 1 cria um número certo que o sistema ignora de propósito.** —
    [apontado] Defensável, mas precisa de prazo e de aviso na tela, senão as
    duas pessoas descobrem que o sistema cobra errado sem saída e abandonam a
    conferência antes da fase 2 existir.
    **A fase 1 ganha prazo escrito e critério numérico de adoção para liberar
    a fase 2, e a tela mostra um banner fixo dizendo que a conferência ainda
    não altera a cobrança.**

### Riscos médios — [todos apontados, não verificados por mim]

13. **O pedido sai da fila da Expedição à meia-noite.** `organizePjOrders`
    (`src/lib/pjOrderList.ts:60-70`) manda para o Histórico tudo com entrega
    anterior a hoje, mesmo sem envio confirmado. Pedido entregue no sábado e
    conferido na segunda vira órfão. **Enquanto houver conferência pendente,
    o pedido fica em "Em aberto" com marca de atrasado. Fase 1.**
14. **`NULL`, zero e "nunca conferido" são três coisas distintas.** O carimbo
    de conferência precisa ser **por linha**, não por grupo, com
    `numeric(12,3)` e `check (>= 0)`. Fase 1.
15. **Fuso e base de data.** Toda data derivada passa por
    `private.data_na_padaria(...)`, nunca `now()::date`. E o relatório atual
    agrupa por `delivery_date` enquanto a cobrança usa a data do envio —
    escolher uma base e usar a mesma nos dois. Fase 3, decidido na fase 2.
16. **Mudar o retorno de `list_pj_orders_for_dispatch` exige `drop`.**
    `create or replace` não altera tipo de retorno, e o `drop` **perde os
    grants**. Reconceder explicitamente e revogar de `public, anon` na mesma
    migration — lição `grants-implicitos-variam-por-ambiente`. Fase 1.
17. **Idempotência.** Todas as funções de escrita de Contas a Receber recebem
    `p_request_id` e deduplicam. As duas RPCs novas seguem a convenção.
    Fases 1 e 3.
18. **Editar pelo fluxo comercial arredonda a quantidade.**
    `orderLinePacksFromStoredQuantity` (`src/lib/pjOrderQuantity.ts:24-27`)
    faz `Math.round` para `un`: 55 com `pack_size` 21 vira 63 ao reabrir e
    salvar. A tela de correção **não pode** reaproveitar o fluxo de edição
    comercial. Fase 3.
19. **A trilha da correção nasce invisível.** `receivable_events.event_type`
    tem `check` fechado, e nenhuma tela lê `receivable_events` hoje. Ou a tela
    passa a mostrar o histórico, ou registrar por escrito que a auditoria é só
    para consulta técnica. Fase 3.
20. **Teste, seed e matriz.** `supabase/tests/pedido_pj_vira_cobranca.test.sql`
    precisa crescer (conferido < estimado; tudo zero; conferido e não enviado;
    cobrado antes de conferir; correção com 3 parcelas; correção bloqueada por
    recebimento). O seed do Preview precisa de pedido em conferência parcial e
    de enviado+cobrado sem recebimento, **com entrega em `hoje+1` / `hoje−2`,
    nunca em "hoje"** — lição `seed-com-hoje-vence-a-meia-noite`, que já
    quebrou o roteiro de teste do Rodrigo neste mesmo módulo.

### Perguntas que a descoberta não fechou

1. **O que o cliente recebe junto com a entrega?** Não existe impressão de
   pedido PJ. Se o motorista entrega um papel dizendo 3 kg e a fatura vem com
   3,067 kg, o cliente contesta e a Elis não tem como provar. **Sem essa
   resposta, cobrar o real pode criar disputa comercial em vez de resolver.**
   Perguntar ao Rodrigo antes da fase 2.
2. **A Elis pode conferir quando a Expedição não conferiu?** A decisão 4 só
   trata do pós-envio; falta a regra do pré-envio.
3. **Pedidos sem `order_group_id`** (legado) não podem ser despachados nem
   cobrados pelas RPCs. Confirmar se ainda entram pedidos assim.

## Segunda revisão adversarial — Sol (Codex/GPT), sessão local, 2026-08-20

A revisão acima foi feita por um agente limpo dentro do ambiente de nuvem,
onde os CLIs do Sol e do operário não existem. Numa sessão local seguinte, a
mesma pergunta foi feita ao **Sol (Codex/GPT)**, em modo somente leitura e sem
o contexto da conversa, e o agente que conduzia a tarefa auditou o código em
paralelo. Veredito do Sol: **não começar a fase 1 como estava**, pelo mesmo
motivo de fundo — travas que faltam.

**Convergência (o que dá confiança):** três revisores independentes chegaram
sozinhos aos mesmos dois achados mais graves — a migration vigente errada e o
parcelamento tratado no singular. O que dois ou mais confirmam não é opinião.

**O que a segunda rodada acrescentou, e já está incorporado às fases acima:**

- **o botão "não enviei este item" não dizia o que gravava.** Gravando `null`,
  o `coalesce(enviado, estimado)` cobraria do cliente o item que não saiu. Os
  três estados (`null` / `0` com motivo / positivo) nasceram daqui;
- **validação estrutural da unidade**: inteiro para item por unidade, precisão
  definida para quilo, unidade imutável durante a expedição;
- **controle de tela desatualizada**: sem a versão que a tela abriu, vence quem
  salvar por último, não quem está certo;
- **histórico das alterações**, porque autoria e carimbo únicos guardam só a
  última digitação;
- **arredondamento decidido**: cada linha a centavos, depois somar, com o mesmo
  critério em todos os pontos de cálculo;
- **a trava do recebimento fica no saldo ativo**, não em qualquer passagem de
  dinheiro já estornada, para não criar dois critérios diferentes;
- **a ordem das fases**: a correção precisa existir no dia da virada. Virou a
  decisão 9 do Rodrigo;
- **auditoria local**: os pontos de cálculo na tela de Pedidos PJ (linhas 415 e
  811) e o GUC `pane.pj_dispatch_rpc`, que já constavam da primeira revisão em
  outra forma.

**Descartado, com motivo verificado no código:** o Sol levantou que a cobrança
pode já ter virado boleto, nota fiscal ou e-mail ao cliente, e que cancelá-la
internamente deixaria um documento externo válido na mão do cliente. **Não se
aplica hoje:** o ERP não emite boleto nem documento fiscal e não manda cobrança
ao cliente. `boleto` aparece apenas como *método pelo qual o dinheiro entrou*,
e a única Edge Function de e-mail é a de contas a pagar. A cobrança é registro
interno. Se um dia o ERP emitir documento externo, esta condição volta à mesa.

Também descartados, por estarem fora do escopo já fechado com o Rodrigo: peso
bruto, tara, integração com balança, lote e validade; e entrega parcial com
saldo pendente, devolução e reposição. Fica registrado que "não enviado" **não**
gera saldo a entregar automaticamente: é falta declarada com motivo, e a
providência é humana.

### Risco fora do escopo — reportado, não corrigir aqui

`orders_select_authenticated_profiles` (baseline `:3616`) permite que qualquer
perfil ativo diferente de `expedicao` leia todas as linhas PJ, `unit_price`
incluso. É o padrão que a lição `leitura-operacional-sem-preco` mandou não
repetir. Não tem relação com este plano e **não deve ser corrigido junto** —
mas a coluna nova entra nessa mesma leitura ampla.

## Pendências antes de começar a fase 1

1. ~~Revisão adversarial~~ — **feita duas vezes**, por revisores
   independentes: um agente limpo na sessão de nuvem e o Sol (Codex/GPT) numa
   sessão local. Ambas incorporadas acima, com o que foi aceito e o que foi
   descartado por escrito.
2. ~~Rever o plano das fases absorvendo os bloqueadores~~ — **feito**. As
   fases 1 e 2 acima foram reescritas item a item contra os bloqueadores 1 a 5
   e os riscos 6 a 18. Cada emenda aponta o achado que a originou.
3. **Responder a pergunta 1 das perguntas abertas** (o que o cliente recebe em
   papel junto com a entrega) — **antes da fase 2, não antes da fase 1**. A
   fase 1 só coleta dado e não muda nenhuma cobrança, então não depende dessa
   resposta.
4. **Aprovação explícita do Rodrigo para a fase 1.** — única pendência que
   bloqueia o começo.

## Nota sobre ambiente de nuvem (2026-08-20)

As skills `operario` (Gemini) e `consulta` (Sol) moram na máquina do Rodrigo e
não estão versionadas no repositório. Numa sessão de nuvem, o repositório é
clonado num contêiner limpo: os CLIs `gemini` e `codex` não existem e não há
chaves. Verificado nesta sessão.

Consequência prática: **em sessão de nuvem, "operário" significa subagente leve
da própria sessão, e "consulta ao Sol" significa subagente limpo sem o contexto
da tarefa** — a saída que o próprio `AGENTS.md` já prevê. Versionar as skills
não resolveria, porque os CLIs continuariam ausentes.

Se Rodrigo aprovar, essa equivalência vira regra no `AGENTS.md`, em PR de
documentação separado deste trabalho.

## Como retomar numa sessão local

```
git fetch origin
git checkout claude/peso-real-pedidos-pj-kfamrj
git pull
```

Leia este documento, o `AGENTS.md`, o `lessons.md` e a migration
`supabase/migrations/20260813215830_pedido_pj_vira_cobranca.sql`. O
entendimento está fechado e as decisões acima não devem ser reabertas sem
evidência nova. Se o código contradisser este documento, **o código vence** —
pare e reporte.

Observação sobre a branch: resolvida em 2026-08-20. A branch chama-se
`feat/quantidade-enviada-pedidos-pj`. O rename fechou o PR #247 (o GitHub não
migra o PR quando a branch de origem some) e o trabalho seguiu em PR #248.
