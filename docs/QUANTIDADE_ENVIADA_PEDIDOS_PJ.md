# Plano — Quantidade realmente enviada em Pedidos PJ

**Origem do pedido:** Rodrigo, 2026-08-20, com o nome "peso real em pedidos PJ".
A descoberta mostrou que o problema é maior que peso — ver decisão 1.

**Status:** descoberta concluída, plano proposto, **aguardando aprovação da
fase 1**. Nenhuma linha de código foi escrita.

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
  `private.build_receivable_from_pj_order`
  (`supabase/migrations/20260813215830_pedido_pj_vira_cobranca.sql`), que soma
  `sum(quantity * coalesce(unit_price, 0))`. **É esta linha que precisa mudar
  na fase 2.**
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

## Pendências antes de começar a fase 1

1. **Revisão adversarial** — exigida pelo `AGENTS.md` para plano com dado
   financeiro. Não foi possível consultar o Sol a partir do ambiente de nuvem
   (ver seção seguinte). Foi despachado um revisor limpo, sem o contexto da
   conversa, com a pergunta "o que falta neste plano que qualquer sistema desse
   tipo tem?". **O resultado ainda não foi incorporado a este documento.**
2. **Aprovação explícita do Rodrigo para a fase 1.**

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
