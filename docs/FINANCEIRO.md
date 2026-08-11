# FINANCEIRO.md — Plano do módulo

**Natureza:** plano de funcionalidade nova, dividido em fases.
**Status:** descoberta concluída em 2026-08-11; plano revisado pelo Sol
(Codex) em revisão adversarial na mesma data e aprovado pelo Rodrigo.
**Nível de risco:** ALTO — dinheiro, permissões, RLS e migration.
Aprovação é **fase a fase**, nunca do plano inteiro de uma vez.

Para o estado real do sistema consulte [CURRENT_STATE.md](CURRENT_STATE.md).
Código, migrations e testes vencem este documento em caso de divergência.

Este plano coordena-se com o [plano do Contas a Receber](CONTAS_A_RECEBER.md)
(PR #200): aquele cuida de *quem me deve*; este cuida de *para onde vai o
dinheiro*. Nenhum substitui o outro.

## Problema

A verdade financeira da padaria mora em quatro lugares e montar um DRE é uma
caçada:

- **CNM (financeiro do PDV)** — a Elis lança lá as despesas: folha, aluguel,
  empréstimos, INSS/FGTS, diárias, compras sem nota. É o "contas a pagar de
  verdade" de hoje, com buracos conhecidos (caixa parou de ser lançado em
  18/07/2026; a luz da JC sumiu do mês; "Outras despesas" é um balde de
  R$ 12 mil sem nome);
- **Pane ERP** — só tem a compra com NF-e (contas a pagar) e o fechamento de
  caixa, desconectados entre si;
- **Bling** — cobranças PJ (já sentenciado a morrer pelo plano do Contas a
  Receber);
- **extratos bancários** — nunca conferidos.

O DRE de julho de 2026 só existiu porque Rodrigo e o agente juntaram tudo à
mão, em uma semana de trabalho (sessão "Análise de vendas ERP e CNM"). O
resultado provou o valor — receita R$ 239,6 mil, resultado operacional 26% —
e provou o custo de não ter o módulo.

Não há nenhuma estrutura de categorias de despesa: a tentativa de centro de
custo por setor no CNM virou bagunça ("prestador de serviço vira
infraestrutura") e o DRE de lá não mostra nada.

## Decisão de arquitetura (Rodrigo, 2026-08-11)

- **O financeiro do CNM morre.** O CNM volta a ser só PDV (cupom) e emissor
  de nota fiscal;
- **O Pane ERP vira o único lugar onde entrada e saída são lançadas**;
- **O ERP é gerencial, não fiscal.** Os três CNPJs (RGE Pane e Pizza = JC;
  SF Salute = JA; Pane e Salute = iFood) viram campo informativo do
  lançamento, nunca estrutura. Obrigação fiscal continua no contador;
- Quem opera é a **Elis, perfil `financeiro`, no celular**. Rodrigo consome
  o DRE.

## Decisões de negócio já tomadas

Não reabrir sem evidência nova.

1. **Livro-caixa central e imutável.** Todo real que entra ou sai vira um
   lançamento com origem única, mês de referência, previsto e realizado
   (data e valor), categoria, loja e conta. Correção nasce como
   contra-lançamento ligado ao original; nada é apagado nem sobrescrito.
   (Incorporada da revisão do Sol, 2026-08-11.)
2. **DRE total + por loja (jc/ja/geral).** "Geral" é custo compartilhado
   explícito, não uma terceira loja: o total do DRE soma JC + JA + geral.
   Não há rateio automático; se um dia houver, será regra gravada como
   fotografia, nunca cálculo retroativo. Setor (produção/balcão/expedição)
   **não** é dimensão de lançamento — a tentativa anterior virou bagunça.
3. **EX é cliente, não loja.** A Exposição é outro CNPJ, sem sociedade do
   Rodrigo ("franquia" informal da Buck). No financeiro ela entra como canal
   de receita pela cobrança semanal do romaneio (fase 4 do Contas a
   Receber). Receita de varejo por fechamento de caixa só existe para JC e
   JA; o financeiro bloqueia `ex` nessa ponte.
4. **Folha por equipe, não por pessoa.** Produção, balcão JC, balcão JA,
   expedição e administrativo — 4-5 lançamentos por mês. Dá o recorte
   "quanto custa a produção em gente" que motivou o centro de custo antigo,
   sem colocar salário individual no sistema. Rateio fino por produto é
   trabalho futuro da ficha técnica (CMV real), não do financeiro.
5. **Elis vê tudo**, incluindo folha e retiradas do Rodrigo — é o que já
   acontece no CNM. As permissões nascem granulares para permitir restringir
   depois sem retrabalho.
6. **Competência simples: o lançamento pesa no mês a que se refere.** Conta
   de luz de julho paga em agosto pesa em julho. O sistema guarda sempre as
   duas datas e os dois valores (previsto e realizado).
7. **O caixa físico de cada loja é uma conta**, como o banco. Pagamento em
   dinheiro (fornecedor, diária) sai dele e é lançado igual. Sangria,
   depósito, reforço e movimentação entre contas são **transferências** —
   não tocam o DRE. Sem isso, dinheiro físico é contado duas vezes ou some.
8. **Venda entra cheia; taxa vira despesa própria.** Cartão (débito,
   crédito, SiTef) e iFood geram despesa de taxa visível — hoje a taxa de
   22,7% do iFood (~R$ 48 mil/ano) não aparece em lugar nenhum. O percentual
   usado fica gravado no próprio lançamento: mudar a tabela de taxas não
   reescreve meses antigos, e diferença entre taxa prevista e real vira
   ajuste, nunca correção do bruto.
9. **DRE em dois andares.** Empréstimos, compra de equipamento e retiradas
   do dono **não são despesa operacional**: aparecem abaixo do resultado
   operacional, como no DRE de julho. Senão o custo mensal infla e um mês
   sem pagar parcela parece lucro.
10. **Recorrência por previsão virtual.** O app é estático e não "acorda"
    no dia 1º: a previsão do mês deriva da regra na hora em que a tela abre
    e só vira lançamento materializado quando a Elis confirma o pagamento.
    Nada depende de um celular específico abrir a tela.
11. **O DRE confessa o que falta.** Linha visível de "sem categoria /
    pendente de confirmação" — o relatório nunca finge precisão que não
    tem. "Outras despesas" existe, com alerta quando passar de ~3% da
    receita.
12. **Fechar o mês.** Mês fechado não muda por correção casual; correção
    posterior a fechamento deixa trilha e ajuste explícito.

## Descartes registrados

Apontados na revisão adversarial e deixados de fora **por decisão**, não por
esquecimento:

- **Tipos nomeados de pagamento parcial, desconto e devolução** — a
  diferença previsto×real já fica gravada e visível; dar nome a cada caso é
  evolução futura (mesma decisão do Contas a Receber);
- **Separar juros de principal na parcela de empréstimo** — exige cadastro
  dos contratos; a v1 mostra a parcela inteira abaixo da linha. Vira fase
  futura junto com o cadastro de empréstimos (saldo devedor, taxa, prazo);
- **Comprovante anexado** — a v1 exige descrição no lançamento manual; foto
  fica para depois;
- **Conciliação bancária** — são ~8 contas em 3 CNPJs e extrato nunca foi
  hábito; começar por aí afundaria o projeto. Fase futura;
- **Saldo por conta e fluxo de caixa projetado** — depende de saldo inicial
  e conciliação; fase futura;
- **Provisão automática de 13º/férias** — futura; até lá o DRE de novembro/
  dezembro é lido com essa ressalva;
- **Captura automática da SEFAZ** — exige certificado digital e serviço fora
  do site estático; a Elis baixa o XML e sobe no ERP;
- **Orçamento/meta por categoria** — futura;
- **Estrutura por CNPJ** — decisão de arquitetura: gerencial, não fiscal.

## Fora do escopo

- emitir nota fiscal ou boleto (decisão do Contas a Receber);
- folha oficial — holerite, cálculo de encargos, eSocial (contador);
- obrigações fiscais e contábeis (contador);
- qualquer integração automática com banco.

## Achados da auditoria que o plano precisa tratar

1. **`cash_closings` aceita inserção e edição direta pelo navegador, e
   editar sobrescreve o fechamento sem rastro.** Insustentável como fonte de
   receita automática; a fase 3 protege a escrita e deriva os lançamentos
   com recálculo auditável.
2. **Bug do Stone:** o campo rotulado "4. Stone crédito/débito" na tela de
   fechamento é gravado na coluna `site_sales_amount`
   (`src/app/fechamento-caixa/page.tsx`, ~linha 70). ~R$ 30,9 mil/mês
   classificados como venda de site. O conserto exige política de histórico
   (reclassificação auditável ou corte prospectivo), decidida na fase 3 com
   o dado em mãos.
3. **iFood é campo informativo do fechamento** (fora do total declarado,
   lição `fechamento-caixa-informativos`). A ponte da fase 3 trata isso
   conscientemente: nem soma dupla, nem concluir que o total do fechamento é
   a receita inteira da loja.
4. **A categoria dos produtos de compra (`category_snapshot` do XML) não é
   categoria financeira.** Pertence ao mapeamento de insumo/CMV; uma NF pode
   misturar matéria-prima, embalagem e revenda. A classificação financeira
   aceita rateio por item ou por título (fase 1).
5. **Fator de conversão de compra** (galão de 5L a preço de galão por litro)
   — dor citada pelo Rodrigo; o ERP já trata na importação XML
   (PR #205, `conversoes_compra_produto`). A "ciência" migra do CNM já
   protegida.
6. **Idempotência por origem** (do Sol): um fechamento gera uma receita por
   loja/data/meio, nunca duas; taxa única por receita + versão da regra;
   recorrência única por regra + mês; correção recalcula somente os
   derivados daquela origem, na mesma transação; baixa e confirmação usam
   chave de requisição com proteção a concorrência (não apenas "se já está
   paga, não faz nada"); estorno cria lançamento inverso vinculado.
7. **O maior risco do corte do CNM não é o histórico**: é a conta de
   agosto, a parcela de empréstimo e a recorrência vigente que ficaram lá e
   nunca nasceram no ERP. A fase 5 migra explicitamente títulos abertos e
   recorrências vigentes.

## Gate técnico (herdado do Contas a Receber, reforçado)

Nenhuma fase que cria tabela financeira começa sem:

1. proteção contra senha vazada ligada no Auth;
2. `REVOKE` explícito de escrita para `anon` e `authenticated` nas tabelas
   novas; `ENABLE` e `FORCE ROW LEVEL SECURITY` desde a criação;
3. grants explícitos apenas para a leitura necessária e para as funções
   exatas, por assinatura;
4. `SECURITY DEFINER` com `search_path = ''`, dono controlado, escrita
   **somente por RPC** — nunca direto na tabela;
5. valor, competência, autoria e status calculados e validados no banco,
   nunca aceitos prontos do navegador;
6. ações independentes (lançar, corrigir, estornar, fechar mês) com
   permissões realmente independentes;
7. idempotência conforme o achado 6 acima;
8. policies próprias em cada tabela, sem depender da visibilidade da
   tabela-pai;
9. teste direto por REST, RPC e GraphQL — não apenas pela tela;
10. matriz no Preview com perfil sem permissão, financeiro autorizado e
    administrador, afirmando que escrita direta na tabela falha.

---

# Fases

Cada fase cabe em uma conversa, termina testável no navegador e tem
aprovação própria antes de começar.

## Fase 0 — Alicerce: livro-caixa, categorias e lançamento avulso

**Objetivo:** existir o registro central que segura todo o resto — e a Elis
conseguir lançar uma despesa avulsa com categoria em dois toques.

**Escopo — entra:**

- tabela de **categorias** semeada com o plano do anexo, com atributos:
  grupo do DRE, andar (operacional / abaixo da linha), natureza (receita /
  despesa / transferência), ordem de exibição, equipe (para mão de obra),
  ativo;
- tabela de **contas**: bancos (Caixa, Sicredi, Sicoob por CNPJ, Nubank,
  conta iFood) e caixas físicos (JC, JA), com CNPJ informativo;
- tabela de **lançamentos** (livro-caixa): origem única e imutável, tipo,
  categoria, loja (jc/ja/geral), canal, mês de referência, previsto e
  realizado (data e valor), conta, forma, descrição, autoria,
  contra-lançamento de estorno;
- permissões granulares `financeiro.*` (acessar, lançar, corrigir,
  estornar), rota derivada da permissão como em `/pedidos-pj`;
- RPCs de lançamento e estorno cumprindo o gate técnico;
- tela `/financeiro`: lançamento avulso (categoria, loja, valor, conta,
  descrição) e lista do mês com filtro por categoria.

**Não entra:** NF/contas a pagar, recorrência, receita automática, DRE.

**Depende de:** item 1 do gate (proteção de senha vazada) — **satisfeito**:
confirmada ligada em auditoria live de 2026-08-11 (plano Pro ativo,
HaveIBeenPwned habilitado, mínimo de 10 caracteres no servidor).

**Arquivos e tabelas prováveis:** migration nova; `src/app/financeiro/`;
`src/lib/finance.ts` e testes; `src/lib/auth.ts`.

**Riscos:** os três planos de permissão (`DEFAULT_ROUTES_BY_ROLE`,
`allowed_routes`, `app_user_permissions`) precisam concordar; categoria
balde por preguiça de escolher — mitigada por seletor de 2 toques com busca
e pelas definições de uma linha do anexo.

**Critérios de aceite:**

- Elis lança despesa avulsa em dois toques, com categoria obrigatória;
- estorno cria contra-lançamento ligado e exige motivo; nada é apagado;
- repetir a ação (toque duplo, reload) não duplica;
- perfil sem permissão é bloqueado **pelo banco** (REST, RPC e GraphQL),
  não só pela tela.

**Testes — matriz:** financeiro JC (consegue lançar e estornar) **e** vendas
JA (bloqueada na tela e no banco). Estados: carregando, vazio, erro,
sucesso, repetição.

**Recuperação:** migration nova; a tela pode ser revertida sem perder
lançamento.

## Fase 1 — Contas a Pagar entra no livro

**Objetivo:** a compra com NF e o boleto passam a alimentar o DRE.

**Escopo — entra:**

- todo título do contas a pagar carrega categoria financeira (por título,
  com rateio opcional por item quando a NF mistura matéria-prima, embalagem
  e revenda), mês de referência e conta de pagamento;
- a baixa (que já registra data, valor e forma reais — PRs #209/#210) gera
  o lançamento correspondente no livro-caixa, pela mesma transação;
- reclassificação de categoria auditável (evento, nunca sobrescrita);
- backfill dos títulos existentes somente onde houver regra verificável; o
  resto fica "não classificado" e visível como tal.

**Não entra:** mudar o fluxo de importação XML nem as conversões (já
resolvidos); recorrência.

**Depende de:** fase 0.

**Arquivos prováveis:** migration nova; `src/lib/payables.ts`;
`src/app/contas-pagar/page.tsx`; `src/components/PayablePurchaseList.tsx`.

**Riscos:** esta é a área histórica do Sol (Codex) — execução combinada
antes de começar, nunca os dois agentes no mesmo fluxo; título pago antes
da fase 1 sem categoria precisa aparecer como "não classificado", nunca
sumir do DRE.

**Critérios de aceite:** baixar um boleto cria o lançamento com a mesma
data/valor/forma; DRE (quando existir) e lista do livro batem com o contas
a pagar; reclassificar deixa trilha.

**Testes — matriz:** financeiro JC; perfil sem `contas_pagar` bloqueado.

**Recuperação:** migration nova.

## Fase 2 — Recorrências

**Objetivo:** aluguel, luz, contador, parcela de empréstimo e folha por
equipe aparecem sozinhos todo mês; a Elis só confirma o pago. É o que mata
o "esqueci de lançar" que furou o DRE de julho.

**Escopo — entra:**

- cadastro de regra recorrente: nome, categoria, loja, valor previsto, dia
  do mês, vigência (início/fim);
- previsão **virtual**: derivada da regra ao abrir o mês, materializada
  como lançamento só na confirmação (data, valor, forma e conta reais);
- idempotência regra + mês: impossível materializar duas vezes;
- pendências visíveis: previsão não confirmada aparece como pendente no mês
  (e futuramente no DRE);
- as parcelas dos 5 empréstimos entram como recorrências abaixo da linha; a
  folha entra como 4-5 recorrências mensais por equipe.

**Não entra:** cadastro de contrato de empréstimo (saldo devedor, juros);
provisão de 13º/férias.

**Depende de:** fase 0.

**Arquivos prováveis:** migration nova; `src/app/financeiro/`;
`src/lib/finance.ts`.

**Riscos:** vigência errada gera previsão fantasma (ex.: JA fechar em
dezembro — encerrar as regras dela é parte do fechamento da loja); mês sem
confirmar acumula pendência — é feature, não bug: pendência visível é o
alarme.

**Critérios de aceite:** regra criada gera previsão no mês seguinte sem
ação humana; confirmar em dois toques com padrão "hoje, valor previsto";
duas confirmações simultâneas não duplicam; encerrar vigência para as
previsões futuras sem tocar as passadas.

**Testes — matriz:** financeiro JC; vendas JA bloqueada.

**Recuperação:** migration nova; regra desativável sem perder histórico.

## Fase 3 — Receita do varejo e taxas, juntas

**Objetivo:** o fechamento de caixa que a loja já faz vira receita no DRE,
com a taxa de cartão e iFood nascendo como despesa na mesma operação.

**Escopo — entra:**

- proteção do fechamento: `cash_closings` deixa de aceitar escrita direta;
  a ação passa por RPC e edição gera recálculo auditável dos lançamentos
  derivados, nunca sobrescrita silenciosa;
- ponte: cada fechamento confirmado gera lançamentos de receita por loja e
  meio de pagamento (dinheiro, Banrisul, Stone, SiTef, PIX) e o iFood
  entra pelo valor cheio como canal próprio — tratado como informativo no
  total do caixa, sem soma dupla;
- config de taxas por meio de pagamento; a despesa de taxa nasce na mesma
  transação da receita, com o percentual gravado no lançamento;
- **conserto do bug Stone**: rótulo e coluna reconciliados
  (`site_sales_amount`), com política de histórico decidida na fase
  (reclassificação auditável do legado ou corte prospectivo documentado);
- bloqueio de `ex` na ponte (EX é cliente — decisão 3);
- tela simples de conferência do mês: total lançado × total esperado por
  fonte — o teste de fogo antes do DRE completo.

**Não entra:** mudar o fluxo operacional de quem fecha o caixa; conciliação
com extrato.

**Depende de:** fases 0 e 2 (a conferência usa pendências de recorrência).

**Arquivos e tabelas prováveis:** migration nova; `src/lib/cashClosing.ts`;
`src/app/fechamento-caixa/page.tsx`; `src/lib/finance.ts`;
`public.cash_closings`.

**Riscos:** este é o coração do módulo e mexe em fluxo diário das lojas —
qualquer trava nova no fechamento precisa preservar o que a pessoa já
digitou (lição `bloqueio-nao-pode-apagar-o-trabalho`); número que vira
dinheiro valida na saída além da entrada (lição `validar-tambem-na-saida`);
fechamento retroativo corrigido precisa recalcular só os derivados daquele
dia.

**Critérios de aceite:** fechar o caixa de um dia gera as receitas e taxas
daquele dia, uma vez só; refazer o fechamento recalcula em vez de duplicar;
a conferência do mês mostra fontes zeradas ou pendentes; taxa gravada não
muda quando a config muda depois; `ex` recusado na ponte.

**Testes — matriz:** perfil que fecha caixa na JC e na JA (consegue);
financeiro JC (vê receitas); vendas sem permissão de financeiro não vê
valores do livro. Fechamento repetido, corrigido e retroativo.

**Recuperação:** migration nova; a ponte pode ser desligada por flag sem
perder fechamentos.

## Fase 4 — O DRE

**Objetivo:** a tela que motivou tudo: para onde foi o dinheiro do mês, sem
caçada.

**Escopo — entra:**

- `/financeiro/dre`: mês a mês, dois andares (operacional e abaixo da
  linha), total + por loja (geral como custo compartilhado explícito);
- grupo → categoria → lançamentos (drill-down até o lançamento);
- linha de completude: "sem categoria / pendente de confirmação" sempre
  visível;
- receita PJ e Buck lidas das cobranças do Contas a Receber, por
  competência, sem duplicar;
- fechar o mês: trava com trilha para correção posterior;
- exportação CSV.

**Não entra:** gráfico, orçamento, comparativo com meta, fluxo de caixa.

**Depende de:** fases 0-3 deste plano e fases 2-4 do Contas a Receber (as
três origens de receita PJ/Buck). Se o Contas a Receber atrasar, o DRE nasce
com varejo + iFood e declara a lacuna na linha de completude.

**Arquivos prováveis:** `src/app/financeiro/dre/`; `src/lib/finance.ts`.

**Riscos:** duplicar receita PJ (cobrança no Receber E lançamento manual);
mês fechado reaberto sem trilha.

**Critérios de aceite:** o DRE de um mês de teste no Preview bate com a
soma manual dos lançamentos; a linha de completude zera quando tudo está
classificado e confirmado; fechar o mês impede alteração casual e a
correção com trilha funciona; CSV abre no Excel.

**Testes — matriz:** financeiro JC e admin (veem); vendas JA (bloqueada).

**Recuperação:** tela reversível sem tocar dados.

## Fase 5 — Corte do CNM

**Objetivo:** desligar o financeiro do CNM sem deixar nenhuma obrigação
para trás.

**Escopo — entra:**

- um mês de operação paralela: Elis lança no ERP, e a conferência (fase 3)
  é comparada com o método antigo no fim do mês;
- migração explícita, digitada pela Elis com apoio do Rodrigo: títulos em
  aberto, recorrências vigentes e qualquer parcela futura que hoje só
  existe no CNM;
- checklist de corte com data; registro da decisão em
  [CURRENT_STATE.md](CURRENT_STATE.md);
- o histórico do CNM **não** é importado — fica nos XLS para consulta.

**Depende de:** fases 0-4 estáveis.

**Riscos:** o maior risco do corte não é o histórico — é a conta de agosto
que ficou no CNM e nunca nasceu no ERP. O checklist de migração é
obrigatório, item a item, antes do desligamento.

**Critérios de aceite:** primeiro mês pós-corte fecha o DRE sem nenhuma
fonte externa; nenhum título vencido "aparece do nada" no mês seguinte.

**Recuperação:** o CNM continua existindo como PDV; reativar o financeiro
de lá é decisão do Rodrigo, não técnica.

---

## Ordem recomendada

`0 → 1 → 2 → 3` constrói o livro e liga as fontes; `4` entrega o DRE; `5`
desliga o CNM. As fases 2-4 do Contas a Receber correm em paralelo (áreas
diferentes), e o DRE consome o resultado delas.

## Coordenação com o outro agente

O Sol (Codex) é o autor do contas a pagar (até o PR #214) e fez a revisão
adversarial deste plano. As fases 0-5 tocam áreas dele (contas a pagar na
fase 1, potencialmente fechamento). Antes de cada fase: conferir com o
Rodrigo quem executa o quê — duas frentes no mesmo fluxo são proibidas,
sobreposição de área e não só de arquivo.

---

## Anexo — Plano de categorias

Cada categoria tem definição de uma linha; a Elis escolhe em dois toques.
Nomes finais podem ser ajustados na fase 0 sem novo plano.

**Receitas (operacional):**

| Categoria | O que entra |
| --- | --- |
| Venda balcão | fechamento de caixa JC e JA, por meio de pagamento |
| iFood | venda pelo app, valor cheio |
| Clientes PJ | cobranças do Contas a Receber |
| Buck (EX) | cobrança semanal do romaneio |
| Outras receitas | o que não couber acima (com descrição obrigatória) |

**Despesas (operacional):**

| Categoria | O que entra |
| --- | --- |
| CMV — Matéria-prima | farinha, insumos de produção |
| CMV — Embalagem | sacos, caixas, etiquetas |
| CMV — Revenda | produto comprado pronto para revender |
| Mão de obra — Produção | folha da equipe de produção |
| Mão de obra — Balcão JC | folha do atendimento JC |
| Mão de obra — Balcão JA | folha do atendimento JA |
| Mão de obra — Expedição | folha da expedição/entregas |
| Mão de obra — Administrativo | folha administrativa (inclui pró-labore fixo) |
| Mão de obra — Encargos | INSS, FGTS |
| Mão de obra — Diárias e extras | pagamento avulso de gente |
| Ocupação | aluguel, luz, água, gás, internet, IPTU |
| Impostos | Simples/DAS e afins |
| Taxas de cartão e apps | débito, crédito, SiTef, iFood |
| Manutenção | conserto de equipamento e predial |
| Serviços de terceiros | contador, advogado, prestadores |
| Financeiras | juros, multas, tarifas bancárias |
| Outras despesas | balde consciente — alerta acima de ~3% da receita |

**= Resultado operacional**

**Abaixo da linha:**

| Categoria | O que entra |
| --- | --- |
| Empréstimos | parcelas dos contratos |
| Equipamento / investimento | compra de ativo (assadeira, forno) |
| Retiradas — distribuição | retirada do dono além do pró-labore |

**= Sobra de caixa do mês**

**Transferências (sem efeito no DRE):** sangria, depósito, reforço,
movimentação entre contas.
