# Alarme de rotina parada

E-mail diário ao Rodrigo quando uma rotina do ERP para de ser lançada ou quando
o financeiro deixa coisa parada. Fase 1 (outubro de 2026): só ele recebe;
responsáveis por rotina, loja fechada e análise com IA ficam para depois.

## O que vigia

Regra da operação, `private.alarme_rotina_parada(p_as_of)` (PR 533), 14 linhas:
fechamento de caixa JC e JA, sobras JC e JA, contagem de prateleira JC e JA,
forno, romaneio, cozinha JC, venda do balcão JC, contagem semanal JC e entrada
de NF-e (rascunho parado, falta de nota e nota lançada com atraso, esta só
informativa).

Regra do financeiro, `private.alarme_financeiro(p_as_of)`, 4 linhas:

- `pj_liberacao`: pedido PJ conferido pela Expedição e sem liberação há 1 dia
  útil inteiro ou mais;
- `recorrencia_pendente`: conta recorrente com vencimento do mês passado há 3
  dias úteis sem confirmação (só vencimentos depois do cadastro da regra);
- `recebimento_parado`: 3 dias úteis seguidos sem recebimento registrado,
  havendo cobrança vencida em aberto;
- `parcela_vencida`: parcela a pagar da JC sem baixa a partir do primeiro dia
  útil depois do vencimento (decisão do Rodrigo em 29/10/2026: pagar depois do
  vencimento é atraso); as que vencem hoje ou até o próximo dia útil vão na
  mesma linha como informativo.

Dia útil é segunda a sexta, menos os feriados nacionais de data fixa. As duas
regras só contam o que já estava lançado no instante pedido, então o ensaio
sobre o histórico roda o mesmo texto com o instante trocado (consulta entre os
marcadores `inicio da consulta do ensaio` e `fim da consulta do ensaio`).

## Como sai o e-mail

1. O pg_cron `alarme-rotina-parada` chama a Edge Function de mesmo nome a cada
   15 minutos, das 08:00 às 20:45 de Brasília, com o segredo
   `alarme_rotina_cron_secret` que nasceu no cofre do banco.
2. A primeira chamada depois das 08:00, de segunda a sábado, tira a fotografia
   do dia (`public.claim_alarme_rotina_para_envio`) e grava em
   `private.alarme_rotina_envios`. Erro ou número de linhas diferente em uma
   regra vira "não foi possível verificar" naquele bloco, nunca "tudo em dia".
3. Cada atrasada é comparada com a última fotografia concluída: novo, continua
   (com o dia do primeiro aviso) ou resolvido. Atraso de bloco não verificado
   fica em espera e não conta como resolvido.
4. O e-mail sai pelo Resend (chave `RESEND_API_KEY`, a mesma do relatório de
   vencimentos) quando há atraso, resolvido, bloco não verificado, ou toda
   segunda com o resumo. Informativo sozinho não manda e-mail. Dia sem nada a
   mandar fica `sem_envio` e conta como concluído.
5. Falha no envio tenta de novo a cada 15 minutos, com a mesma
   `Idempotency-Key` (`alarme-rotina:<dia>`). A fotografia que não saiu no
   próprio dia expira: depois de uma queda chega só a do dia.

O destinatário é o e-mail do perfil ativo único "Rodrigão"; sem ele, ou com
dois, a função recusa em vez de mandar para outra pessoa.

## Vigia do vigia

O workflow `Vigia do alarme de rotina` (`.github/workflows/vigia-alarme.yml`)
roda de segunda a sábado às 09:45 de Brasília e lê, sem segredo, a data da
última fotografia concluída (GET na Edge Function). Se não for o dia esperado,
o job falha e o GitHub avisa por e-mail quem mexeu por último no agendamento.
A regra de decisão fica em `scripts/vigia-alarme.mjs`, testada no `npm test`.

## Onde olhar quando algo der errado

- Histórico de cada dia: `private.alarme_rotina_envios` (status `pendente`,
  `enviado`, `sem_envio` ou `expirado`, `last_error` e a fotografia inteira).
- Chamadas do cron: `cron.job_run_details` do job `alarme-rotina-parada` e os
  logs da Edge Function no painel do Supabase.
- E-mails aceitos: log do Resend, pelo assunto que começa com "Rotina parada",
  "Alarme do ERP" ou "Resumo de segunda".
- A publicação da função é pelo `functions.yml`, depois do merge; a migration,
  pela Action `Banco (migrations)`.

Para mudar uma regra, redefina a função a partir da versão mais recente nas
migrations e mantenha o número fixo de linhas e a ordem: a entrega compara por
`(rotina, loja)` e recusa bloco com contagem diferente.
