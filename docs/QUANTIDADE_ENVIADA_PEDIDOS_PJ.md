# Plano — Quantidade realmente enviada em Pedidos PJ

**Origem do pedido:** Rodrigo, 2026-08-20, com o nome "peso real em pedidos PJ".
A descoberta mostrou que o problema é maior que peso — ver decisão 1.

**Status:** descoberta concluída, plano proposto, **revisão adversarial
recebida e incorporada** (ver seção própria no fim). O plano precisa dos
ajustes listados lá antes de a fase 1 começar. **Aguardando aprovação do
Rodrigo.** Nenhuma linha de código foi escrita.

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
6. **Trava dos 20%:** diferença acima de 20% para cima ou para baixo em relação
   à estimativa pára a tela e exige confirmação escrita antes de salvar.
7. **Relatório estimado × real:** sim, mas em fase separada, depois de haver
   dado real acumulado.
8. **Sem retroatividade:** pedidos já enviados não recebem quantidade real.

### Caso que originou a decisão 3

A Expedição pesa o mini-croissant e esquece de descontar a tara da bandeja.
Anota 2,5 kg em vez de 3,0 kg, salva e confirma o envio. Percebe o erro logo
depois. Sem janela de correção, a única saída seria criar um pedido novo do
zero. Foi pedido explícito da Elis que exista edição.

## Plano — 4 fases

A ordem é deliberada: **a fase que liga o dinheiro vem depois da fase que
coleta o dado.**

| Fase | O que muda na padaria | Mexe em dinheiro? | Quem executa |
|---|---|---|---|
| 1 | Expedição confere e digita a quantidade enviada de cada item; salva e corrige à vontade. "Marcar como enviado" exige tudo conferido. **A cobrança continua saindo pela estimativa.** | Não | agente principal (migration, RPC) + operário (tela) |
| 2 | A cobrança passa a usar a quantidade enviada. | Sim | agente principal, sozinho |
| 3 | Financeiro ganha "Corrigir quantidade enviada" no pedido já enviado. | Sim | agente principal, sozinho |
| 4 | Relatório pedido × enviado por produto e mês. | Não | operário, sob revisão |

Entre a fase 1 e a fase 2 fica um intervalo de uso real. Nele se mede, com
número, o quanto a estimativa erra e se a Expedição adotou a conferência —
antes de a cobrança depender dela. Justificativa nas lições
`status-deduzido-de-data-nao-e-fato` e `adocao-se-mede-no-ciclo-inteiro`.

### Fase 1 — conferência da quantidade enviada

- Coluna nova em `public.orders` para a quantidade enviada, mais autoria e
  carimbo de tempo. A estimativa em `quantity` fica intacta.
- RPC nova para a Expedição JC gravar, com a mesma permissão
  `pedidos_pj.confirmar_envio`, validando a trava dos 20%.
- Botão explícito "não enviei este item" em vez de digitar zero.
- `list_pj_orders_for_dispatch` passa a devolver os dois números.
- Tela: bloco de conferência item a item, salvável e corrigível quantas vezes
  quiser enquanto o pedido não foi enviado.
- "Marcar como enviado" bloqueia enquanto houver item não conferido, **com o
  motivo escrito na tela, ao lado do botão** — nunca em `title`/tooltip (lição
  `botao-desabilitado-sem-motivo-na-tela`).
- Aceite: expedição JC consegue; vendas JA é bloqueada. Matriz nos dois
  sentidos, no navegador.

### Fase 2 — a cobrança passa a usar o real

- `private.build_receivable_from_pj_order` passa a somar
  `coalesce(enviado, estimado) * unit_price`.
- **Trava de saída:** recusa a cobrança se o valor real passar do dobro do
  valor estimado do pedido. É a lição `validar-tambem-na-saida`, que nasceu de
  um erro de R$ 190 mil causado por gramas digitadas em campo de quilo. Trava
  só na entrada é mitigação, não garantia.
- Redefinir a função exige partir da **versão vigente**, não da que a criou
  (lição `funcao-de-banco-redefinida-perde-melhoria-recente`).

### Fase 3 — correção depois do envio

- Função nova, `SECURITY DEFINER`, só para `financeiro`/`admin`: numa transação
  só, cancela a cobrança existente com motivo, atualiza a quantidade enviada e
  regera a cobrança pelo mesmo motor.
- Bloqueada se houver qualquer recebimento registrado na cobrança.
- A cobrança cancelada permanece no histórico. O rastro é a razão de não
  sobrescrever valor.

### Fase 4 — estimado × real

Relatório por produto e por mês. Só depois de haver dado acumulado.

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
   2 — não esperar a fase 4, que é o relatório novo.**

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
    escolher uma base e usar a mesma nos dois. Fase 4, decidido na fase 2.
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

### Risco fora do escopo — reportado, não corrigir aqui

`orders_select_authenticated_profiles` (baseline `:3616`) permite que qualquer
perfil ativo diferente de `expedicao` leia todas as linhas PJ, `unit_price`
incluso. É o padrão que a lição `leitura-operacional-sem-preco` mandou não
repetir. Não tem relação com este plano e **não deve ser corrigido junto** —
mas a coluna nova entra nessa mesma leitura ampla.

## Pendências antes de começar a fase 1

1. **Revisão adversarial** — feita e incorporada (seção acima). Não foi
   possível consultar o Sol a partir do ambiente de nuvem; foi usado um
   revisor limpo, saída que o próprio `AGENTS.md` prevê. Se o Rodrigo quiser a
   opinião do Sol de verdade numa sessão local, vale rodar `/consulta` com a
   mesma pergunta — os achados acima já dão o contraditório inicial.
2. **Rever o plano das fases 1 a 3 absorvendo os bloqueadores 1 a 5.** O plano
   como está escrito na seção "Plano — 4 fases" ainda não os contempla.
3. **Responder a pergunta 1 das perguntas abertas** (o que o cliente recebe
   junto com a entrega) antes da fase 2.
4. **Aprovação explícita do Rodrigo para a fase 1.**

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

Observação sobre a branch: o nome `claude/...` foi imposto pelo ambiente de
nuvem e contraria a convenção do `AGENTS.md`, que exige `tipo/<descricao>` e
proíbe prefixo de agente. Numa sessão local, renomeie para
`feat/quantidade-enviada-pedidos-pj` antes de seguir.
