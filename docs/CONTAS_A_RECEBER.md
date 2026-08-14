# CONTAS_A_RECEBER.md — Plano do módulo

**Natureza:** plano de funcionalidade nova, dividido em fases.
**Status:** descoberta concluída em 2026-08-07. Aguardando aprovação da fase 0.
Revisado em 2026-08-10 contra o checklist padrão de contas a receber; quatro
lacunas incorporadas por decisão do Rodrigo (decisão 9).
Fase 0 concluída em 2026-08-11 (seed no PR #202, smoke no PR #208).
Fase 1 concluída em 2026-08-10 (PR #206). A dependência da fase 2 sobre o
molde corrigido de contas a pagar foi satisfeita pelo PR #209.

**Revisão de 2026-08-13 — a fase 2 foi reescrita.** Entre 12 e 13 de agosto o
módulo Financeiro foi ao ar (livro-caixa, contas a pagar alimentando o livro,
recorrências, transferências e cartão de crédito). A fase 2 tinha sido
planejada antes disso e não previa o livro. As mudanças estão na decisão 10 e
na própria fase 2; o restante do plano segue valendo.
**Nível de risco:** ALTO — dinheiro, permissões, RLS e migration.
Aprovação é **fase a fase**, nunca do plano inteiro de uma vez.

Para o estado real do sistema consulte [CURRENT_STATE.md](CURRENT_STATE.md).
Código, migrations e testes vencem este documento em caso de divergência.

## Problema

A mesma informação de cobrança é lançada em três lugares e a verdade não mora
em nenhum:

- **Bling** — cliente que pede nota: a Elis emite NF e boleto juntos por lá, e
  a cobrança fica registrada lá;
- **Pane ERP** — cliente que compra sem nota: ela lança aqui;
- **pagamento** — deveria ir para o CNM, mas ela registra no ERP e no Bling,
  porque o boleto sai do Bling.

O sintoma que provocou a decisão: ao montar o DRE, Rodrigo teve que buscar
faturamento em lugares separados e entregar a informação em partes.

**A dor é trabalho dobrado e informação espalhada, não inadimplência.**

## Decisão de arquitetura (Rodrigo, 2026-08-07)

- **CNM** passa a emitir somente nota fiscal;
- **boleto** é emitido pelo site do banco, fora de qualquer sistema;
- **Pane ERP** é o dono da verdade: quem deve, quanto, quando vence, se pagou;
- **Bling sai de cena.**

Consequência que reduz o projeto pela metade: **o ERP não emite nota nem
boleto.** Ele registra que existem e se foram pagos. Nenhum risco fiscal entra
neste módulo.

## Decisões de negócio já tomadas

Não reabrir sem evidência nova.

1. **Uma cobrança por pedido PJ.** Não há fatura consolidada para clientes PJ.
2. **A EX/Buck é a única exceção:** junta as entregas da semana em uma conta só.
   Essa conta nasce do romaneio, não de pedido PJ.
3. **Vencimento sai de prazo fixo cadastrado em cada cliente.** Não há campo de
   vencimento no momento da cobrança; a exceção existe por uma ação separada de
   *corrigir vencimento*, com permissão própria e registro de quem mudou.
4. **Lançamento avulso sempre aponta para cliente cadastrado.** Sem nome livre —
   é o que faz o extrato por cliente fechar.
5. **O avulso é construído antes da geração automática.** A tela nasce
   funcionando sozinha; o Bling pode ser desligado ao fim da fase 2.
6. **A dívida aberta hoje entra pelo lançamento avulso**, digitada pela Elis.
   Não haverá importação de arquivo do Bling.
7. **Quem opera é a Elis, perfil `financeiro`**, no celular. Volume observado:
   cerca de 30 cobranças por mês, R$ 8 mil a R$ 19 mil.
8. **A cobrança de pedido PJ nasce do envio confirmado pela Expedição**, não de
   data de entrega no calendário. Decidido em 2026-08-07; substitui a decisão
   anterior de que o financeiro geraria a cobrança com um clique.
   - **Quem cria é o sistema, não a pessoa.** A ação protegida que registra o
     envio gera a cobrança dentro dela; a Expedição não recebe nenhuma
     permissão financeira e continua sem ver valores.
   - **Rede de proteção obrigatória:** lista de pedidos com entrega vencida e
     sem envio confirmado. É o que impede um esquecimento da Expedição virar
     faturamento perdido.
9. **A baixa registra o fato, não o clique (Rodrigo, 2026-08-10).** Quatro
   lacunas encontradas na revisão contra o checklist padrão do domínio, todas
   aprovadas:
   - a baixa pergunta a **data em que o dinheiro entrou** e o **valor
     recebido**, com padrão "hoje, valor da cobrança" para não atrasar o dia
     a dia;
   - a baixa registra a **forma de recebimento** (Pix, transferência, boleto,
     dinheiro);
   - existe **estorno de baixa errada**, com permissão própria, motivo
     obrigatório e registro de quem desfez;
   - toda cobrança **mostra a origem** que a gerou (pedido, romaneio ou
     avulso), com os itens.
   As lacunas eram as mesmas do contas a pagar, corrigidas lá em paralelo
   pelo Sol; a regra geral virou o roteiro de benchmark do PR #207.
10. **A cobrança recebida entra no livro-caixa (Rodrigo, 2026-08-13).** O
    módulo Financeiro subiu depois que este plano foi escrito, e o livro-caixa
    já nasceu com as categorias de receita `clientes_pj` e `buck_ex` vazias,
    esperando por este módulo. Quatro consequências, todas aprovadas:
    - **a baixa da cobrança escreve no livro na mesma transação** — ou o
      cliente é marcado como pago e o dinheiro entra no caixa, ou nenhuma das
      duas coisas acontece. É como a baixa de contas a pagar já funciona;
    - **a baixa pergunta em qual conta o dinheiro caiu**, e não só a forma
      (Pix, boleto, dinheiro). Sem a conta, o saldo por banco não fecha.
      Diferente do contas a pagar, onde a conta pertence à compra, aqui ela
      pertence à baixa: o mesmo cliente paga por Pix num mês e por boleto de
      outro banco no seguinte;
    - **a receita pesa no mês do faturamento, não no mês em que o dinheiro
      entrou.** Espelha a regra da despesa (decisão 6 de
      [FINANCEIRO.md](FINANCEIRO.md)): se o pão saiu em julho, a farinha dele
      já foi lançada como despesa em julho — a venda tem que contar em julho
      também, senão os dois meses mentem em direções opostas. As três datas
      ficam gravadas: faturamento manda no resultado, vencimento manda na
      lista de atrasados, recebimento manda no saldo da conta. Custo aceito:
      um mês já fechado pode mudar se uma cobrança antiga for lançada com
      atraso — o livro registra a correção como linha nova, nunca apagando a
      anterior;
    - **a tela é própria, `/contas-receber`**, espelhando `/contas-pagar`, e
      não uma aba de `/financeiro`. O `/financeiro` continua sendo o livro e o
      resultado; pagar e receber são as duas telas do dia a dia da Elis, com
      permissões separadas.

11. **Dois caminhos para a mesma cobrança (Rodrigo, 2026-08-13).** A decisão 8
    dizia que a cobrança nasce do envio confirmado pela Expedição. A medição em
    produção antes de implementar a fase 3 mostrou que isso não se sustenta:
    **116 pedidos PJ desde junho de 2026, 1 com envio confirmado** — 27 em
    junho (nenhum), 44 em julho (um) e 45 em agosto até o dia 13 (nenhum),
    somando R$ 47 mil. Construir só o caminho automático faria a cobrança
    deixar de nascer para quase todos os pedidos.
    - a cobrança continua nascendo **por dentro** da ação que confirma o
      envio, sem nenhuma permissão financeira para a Expedição;
    - **e** o financeiro passa a ter a lista de *entregues e ainda não
      cobrados*, marcando vários e gerando de uma vez;
    - os dois caminhos chamam a mesma função no banco, então valor,
      vencimento e travas não podem divergir;
    - **cliente sem prazo cadastrado não trava o envio.** A confirmação
      acontece, a cobrança não nasce, e o pedido fica na lista até alguém
      cadastrar o prazo. Travar a operação por causa de um campo do financeiro
      é acoplamento que quebra a padaria.
    Se o hábito da Expedição melhorar, o caminho automático assume sozinho e a
    lista esvazia — sem mudar nada no código.

12. **A cobrança aceita recebimento em pedaços (Rodrigo, 2026-08-14).** A Buck
    paga um pouco em Pix e um pouco em dinheiro, em dias diferentes. O modelo
    das fases 2 a 4 guardava um recebimento só e obrigava a Elis a registrar
    uma mentira: o valor cheio antes de ter entrado, ou nada.
    - vale para **qualquer cobrança**, não só a da Buck;
    - a cobrança ganha a situação **parcial**, e quanto entrou é sempre a soma
      dos pedaços ativos — nunca um campo que alguém escreve;
    - **cada pedaço vira um lançamento próprio no livro**, na conta e na data
      dele. A chave de origem aponta para o pedaço, não para a cobrança: o
      livro tem índice de um lançamento ativo por origem, e sem isso a segunda
      parcela não entraria no caixa;
    - o **estorno é de um pedaço**; cancelar exige que nada tenha entrado;
    - valor menor que o cobrado **deixou de significar desconto**: agora é
      recebimento parcial. O "restinho que nunca vem" segue sem solução, por
      decisão consciente — ver Fora do escopo.
    Feito enquanto produção tinha zero cobranças: nenhum dado a migrar.

## Três origens, um único destino

| Origem | O que já existe hoje | O que falta |
| --- | --- | --- |
| Pedido PJ | pedido, preço travado na linha, envio confirmado pela Expedição | virar cobrança com vencimento e baixa |
| EX/Buck | agrupamento por período, preços da tabela BUCK, documento de cobrança impresso, travas de preço/unidade/quantidade | virar cobrança com vencimento e baixa |
| Avulso | nada | tudo |

As três desembocam na mesma lista de quem deve, quanto e quando.

## Fora do escopo

Registrado para o plano não inchar:

- emitir nota fiscal;
- emitir ou registrar boleto;
- integração automática com banco, Bling ou CNM;
- fatura mensal consolidada para clientes PJ;
- cálculo automático de juros, multa ou correção por atraso — a diferença
  paga a mais ou a menos fica visível no valor recebido da baixa (decisão 9),
  sem cálculo;
- cobrança automática por WhatsApp ou e-mail;
- ~~pagamento parcial de uma cobrança~~ — **entrou em 2026-08-14** (decisão
  12), quando Rodrigo informou que a Buck paga em pedaços. O que era exclusão
  virou funcionalidade;
- renegociação de dívida;
- contas a receber do varejo das lojas — isso é caixa, não fiado.

## Bloqueio a resolver antes da fase 2

`CURRENT_STATE.md` registra que funcionalidade nova com dado financeiro deve
esperar a conclusão do hardening Auth/RLS. Contas a pagar entrou em agosto de
2026 mesmo assim.

**Ou a regra foi superada na prática e o documento está desatualizado, ou
contas a receber também deveria esperar.** Rodrigo decide antes da fase 2 —
que é a primeira a criar tabela financeira — e a decisão é registrada em
`CURRENT_STATE.md` na mesma tarefa. As fases 0 e 1 não criam dado financeiro e
não dependem dessa decisão.

### Gate técnico da fase 2

Revisado por Claude e por Sol (Codex) em 2026-08-07, de forma independente.
Os dois concordam que **esperar o hardening inteiro não é necessário** e que
as fases 0 e 1 podem seguir. Também concordam que a fase 2 exige um gate
próprio — e que "o padrão do contas a pagar parece correto" **não** serve como
gate, porque a revisão do Sol encontrou um defeito nesse próprio padrão (ver
achado 8 abaixo).

Atualização de 2026-08-13: o módulo Financeiro cumpriu este mesmo gate nas
fases que já foram ao ar, e o molde do livro-caixa
(`20260812115945_financeiro_livro_caixa.sql`) satisfaz sozinho os itens 2 a 7.
Copiar esse molde — e não mais o contas a pagar de agosto — é o caminho mais
curto e mais seguro para a fase 2.

A fase 2 só começa depois de:

1. proteção contra senha vazada ligada no Auth — **satisfeito**, confirmado em
   auditoria live somente leitura de 2026-08-11 (ver `CURRENT_STATE.md`);
2. `REVOKE` explícito de `INSERT`, `UPDATE` e `DELETE` para `anon` e
   `authenticated` nas tabelas novas;
3. `ENABLE` e `FORCE ROW LEVEL SECURITY` desde a criação;
4. grants explícitos apenas para a leitura necessária e para a execução das
   funções exatas, por assinatura;
5. `SECURITY DEFINER` com `search_path = ''`, dono controlado e sem acesso
   público;
6. valor, vencimento, autoria e status calculados e validados no banco, nunca
   aceitos prontos do navegador;
7. **criação, baixa e estorno em funções separadas, com `lancar`, `baixar` e
   `estornar` realmente independentes** — o defeito do achado 8 não se
   repete aqui;
8. chave idempotente com proteção contra chamadas concorrentes: repetir devolve
   a mesma cobrança em vez de erro de unicidade;
9. policies próprias em cada tabela filha, sem depender da visibilidade da
   tabela-pai;
10. teste direto por REST, RPC e GraphQL — não apenas pela tela;
11. matriz no Preview com usuário sem permissão, financeiro autorizado, outra
    loja e administrador, afirmando que escrita direta na tabela falha.

Não é necessário limpar as 24 funções antigas antes. É necessário provar que
nenhuma função reutilizada pelo módulo novo abre caminho de leitura ou escrita
fora do escopo.

## Achados da auditoria que o plano precisa tratar

Levantados na descoberta, com evidência nos dados de produção:

1. **Relatório de Vendas PJ inflava o faturamento** em ~R$ 30 mil entre junho e
   julho de 2026, por multiplicar o tamanho do pacote duas vezes. Corrigido no
   PR #198, pré-requisito de todo o resto: cobrança gerada sobre conta errada
   cobra o cliente errado.
2. **Cliente duplicado com o mesmo CNPJ** — `NDCG - NIX` e
   `NDCG RESTAURANTE LTDA - Nix`, ambos `54.338.407/0001-52`, um com 3 pedidos e
   outro com nenhum. Vira dois extratos para o mesmo pagador.
3. **Seis clientes sem CNPJ cadastrado.**
4. **Editar um pedido PJ apaga e recria as linhas** (`delete` seguido de
   `insert` em `src/app/pedidos-pj/page.tsx`). Qualquer cobrança apontando para
   elas quebra. Tem que mudar antes da fase 3.
5. **O Banco Preview não tem cliente, tabela de preço nem pedido PJ**, e nenhum
   dos testes de navegador cobre Pedidos PJ. Hoje é impossível testar cobrança
   antes de ir ao ar.
6. **22 tabelas de preço ativas para 32 clientes**, 18 delas atendendo um único
   cliente, com cópias e nomes repetidos. Sem histórico de preço nem vigência.
   Não bloqueia o módulo; tratado na fase 6.
7. **Entrega não existe como fato registrado.** O rótulo *entregue* na lista de
   Pedidos PJ é deduzido de a data de entrega já ter passado, e o relatório de
   Vendas PJ soma pela data em que a entrega estava agendada. Nenhum dos dois
   olha para algo que aconteceu. O único fato registrado é a Expedição marcar
   *Enviado* — e ela marcou **1 pedido em 93** desde julho de 2026.
   Daí a decisão 8 e a rede de proteção que ela exige: se o hábito da Expedição
   não mudar, a cobrança para de nascer. Esse é o principal risco operacional
   do módulo, e ele não é técnico.
8. **`create_manual_payable` separa mal as permissões — achado do Sol (Codex),
   2026-08-07, fora do escopo deste plano.** A função aceita `p_paid = true`
   mas valida somente `contas_pagar.lancar`. Quem pode lançar consegue criar
   uma conta já quitada sem ter `contas_pagar.baixar`. Hoje isso é invisível
   porque a mesma pessoa faz as duas coisas; no dia em que lançar e dar baixa
   forem de gente diferente, a separação não se sustenta. **Não corrigir junto
   com este módulo** — é tarefa própria, em contas a pagar. Aqui serve como
   prova de que "a função valida permissão" não equivale a "as
   responsabilidades estão separadas": ver o item 7 do gate técnico.
9. **`request_id` protege contra repetição, mas não contra simultaneidade** —
   também achado do Sol. Duas chamadas ao mesmo tempo produzem erro de
   unicidade em vez de devolver o mesmo registro. O módulo novo trata isso no
   item 8 do gate técnico.

---

# Fases

Cada fase cabe em uma conversa e termina testável no navegador.

## Fase 0 — Dados de teste de Pedidos PJ no Banco Preview

**Concluída em 2026-08-11.** Seed pelo PR #202; smoke de navegador pelo
PR #208. O smoke rendeu dois consertos no cenário de teste: o financeiro
fictício estava sem as rotas (/pedidos-pj, /relatorios) e sem a permissão
`pedidos_pj.acessar` — o tripé rota/permissão/RLS valia só em uma perna.

**Objetivo:** poder testar cobrança no preview antes de qualquer coisa ir ao ar.

**Escopo — entra:**

- semear em `supabase/seed.sql`: clientes fictícios com prazo de pagamento,
  uma tabela de preço, e pedidos PJ cobrindo pedido em aberto, pedido enviado,
  pedido cancelado e pelo menos um item com pacote maior que 1;
- um teste de navegador cobrindo Pedidos PJ com o perfil financeiro.

**Não entra:** mudança de schema, de tela ou de permissão.

**Depende de:** nada. Pode começar imediatamente.

**Arquivos prováveis:** `supabase/seed.sql`, `test/browser/auth.smoke.spec.ts`.

**Riscos:** seed que grava e não limpa quebra a repetição do CI — foi
exatamente o problema corrigido no PR #199 do Codex. O teste novo é **somente
de leitura**.

**Critérios de aceite:**

- o preview mostra pedidos PJ e o relatório de Vendas PJ mostra total diferente
  de zero;
- o teste de navegador passa **duas vezes seguidas sem reconstruir o banco**;
- `Banco Preview` e `CI Banco` verdes.

**Testes:** financeiro JC abre `/pedidos-pj` e vê a lista; abre
`/relatorios/pj` e o total bate com a soma dos pedidos semeados.

**Recuperação:** seed é reaplicado a cada reconstrução do Preview; reverter o
arquivo devolve o estado anterior. Não toca produção.

## Fase 1 — Prazo de pagamento e higiene do cadastro de clientes

**Objetivo:** o cliente passa a carregar o prazo que ele paga, e o mesmo CNPJ
deixa de virar dois clientes.

**Escopo — entra:**

- coluna de prazo de pagamento em dias em `customers`, com padrão e limite;
- unicidade de CNPJ ignorando pontuação, com recado claro na tela;
- unificação do cliente NDCG duplicado, preservando os pedidos existentes;
- campo de prazo na tela de Clientes.

**Não entra:** limite de crédito, bloqueio por inadimplência, endereço de
cobrança, e-mail de cobrança. Entram só se a operação pedir.

**Depende de:** fase 0, para poder testar no preview.

**Arquivos e tabelas prováveis:** migration nova em `supabase/migrations/`,
`src/app/clientes/page.tsx`, `public.customers`.

**Riscos:** o índice de unicidade falha se existir duplicata no banco — a
migration precisa **unificar antes de criar o índice**, na mesma transação, e
os pedidos do cliente removido precisam ser reapontados. Migration é só ida:
erro aqui se corrige com migration nova.

**Critérios de aceite:**

- o cadastro mostra e salva o prazo de pagamento;
- tentar salvar um CNPJ já usado mostra recado claro e não grava;
- NDCG passa a ser um cliente só, com os 3 pedidos preservados e visíveis;
- clientes sem CNPJ continuam funcionando (o campo segue opcional).

**Testes:** admin e financeiro criam e editam cliente; perfil sem acesso a
`/clientes` continua bloqueado. `CI Banco` e `Banco Preview` verdes.

**Recuperação:** migration nova. A unificação do NDCG precisa registrar no
próprio arquivo qual id foi preservado e qual foi absorvido.

## Fase 2 — A tela de Contas a receber e o lançamento avulso

**Reescrita em 2026-08-13** para nascer ligada ao livro-caixa (decisão 10).
**Concluída em 2026-08-13 (PR #232),** testada por Rodrigo no preview. O teste
dele encontrou dois defeitos que os automáticos não pegaram: a origem nova sem
nome na tela do Financeiro e a baixa sem evidência visível quando a receita cai
em mês anterior — ver `lessons.md`.

**Objetivo:** existir um único lugar que responde quem deve, quanto e quando —
e o Bling poder ser desligado. Ao dar baixa, o dinheiro aparece no caixa sem
ninguém digitar de novo.

**Escopo — entra:**

- tabelas de cobrança e de eventos, copiando o molde do **livro-caixa**
  (`20260812115945_financeiro_livro_caixa.sql`), não o do contas a pagar de
  agosto: portas fechadas por padrão e abertas uma a uma, permissão conferida
  por função auxiliar em `private`, registro imutável (corrigir é estornar e
  relançar, nunca alterar) e trava contra toque duplo por `request_id`;
- **três datas gravadas na cobrança**: faturamento (manda no resultado do
  mês), vencimento (manda na lista de atrasados) e recebimento (manda no saldo
  da conta);
- permissões granulares próprias: `contas_receber.acessar`, `.lancar`,
  `.baixar`, `.estornar`, `.cancelar` e `.corrigir_vencimento`;
- ações protegidas no banco (`SECURITY DEFINER`, `search_path = ''`, grants
  explícitos por assinatura), com escrita **somente por elas** — nunca direto
  na tabela;
- RLS forçada em todas as tabelas novas desde a criação, com policy de leitura
  por permissão;
- **a baixa escreve no livro-caixa na mesma transação**, na categoria
  `clientes_pj` (ou `buck_ex`, conforme a origem), com competência no mês do
  faturamento e `source = 'contas_receber'` apontando para a cobrança;
- **o estorno da baixa estorna o lançamento do livro junto**, pelo mesmo
  caminho — sem isso a baixa errada sai da cobrança e fica no caixa para
  sempre;
- tela `/contas-receber`: lista de quem deve, com atrasados e a vencer em
  destaque; lançamento avulso; baixa com data do recebimento, valor recebido,
  forma de recebimento **e conta que recebeu** (padrão: hoje, valor da
  cobrança); estorno de baixa com motivo; cancelamento com motivo; correção de
  vencimento; cada cobrança mostra a origem que a gerou (decisão 9);
- rota derivada da permissão granular, como já é feito em `/pedidos-pj`, **e o
  link no menu** — sem ele a tela existe e ninguém chega (lição
  `tela-nova-precisa-do-menu`).

**Não entra:** geração automática a partir de pedido ou romaneio (fases 3 e 4),
extrato por cliente (fase 5), pagamento parcial.

**Depende de:** fase 1 (o vencimento vem do prazo do cliente) e do módulo
Financeiro no ar — satisfeito. A dependência antiga do molde corrigido do
contas a pagar deixou de existir: o molde agora é o do livro-caixa.

**Arquivos e tabelas prováveis:** migration nova; `src/app/contas-receber/`;
`src/lib/receivables.ts` e testes; `src/lib/auth.ts` para a rota;
`src/components/Nav.tsx` para o menu; testes pgTAP em `supabase/tests/`.

**Riscos:**

- **dar baixa não pode exigir duas permissões.** A Elis terá
  `contas_receber.baixar`; se a função também exigisse `financeiro.lancar`,
  ela travaria na hora de usar. O contas a pagar já resolveu assim: a baixa
  confere só a permissão dela e escreve no livro por dentro
  (`record_payable_installment_payment`);
- os quatro planos de acesso (`DEFAULT_ROUTES_BY_ROLE`, `allowed_routes`,
  `app_user_permissions` e o menu do `Nav`) precisam concordar, senão a Elis
  fica com o checkbox marcado e sem conseguir abrir a tela;
- valor é dinheiro: validar no banco, não só na tela — a lição
  `validar-tambem-na-saida` nasceu de um erro de R$ 190 mil;
- lançar duas vezes a mesma cobrança. Toda ação de criação carrega
  identificador próprio e repetir devolve a mesma cobrança, sem duplicar;
- **redefinir função compartilhada do Financeiro** (por exemplo
  `reverse_finance_entry`) apaga em silêncio melhoria recente de outro agente
  — lição `funcao-de-banco-redefinida-perde-melhoria-recente`. Se a fase
  precisar tocar uma função existente, partir da definição mais recente e
  provar por diff que a única diferença é a pretendida.

**Critérios de aceite:**

- a Elis lança uma cobrança avulsa escolhendo cliente, valor, descrição e data
  de faturamento; o vencimento aparece calculado do prazo do cliente;
- a lista mostra o que está atrasado e o que vence nos próximos dias;
- a baixa registra quem deu, a data em que o dinheiro entrou, o valor
  recebido, a forma e a conta — com os padrões preenchidos, dá para baixar em
  dois toques;
- **dar baixa faz o valor aparecer no livro-caixa**, em Clientes PJ, no mês do
  faturamento, com a mesma quantia;
- estornar uma baixa exige motivo, devolve a cobrança para aberta, **tira o
  valor do livro** e registra quem desfez;
- o cancelamento exige motivo;
- cobrança já recebida não pode ser cancelada sem estorno antes;
- repetir a ação (toque duplo, recarregar) não duplica nem corrompe;
- **um perfil sem a permissão é bloqueado pelo banco**, não apenas pela tela.

**Testes — matriz obrigatória:** financeiro JC (deve conseguir lançar, baixar e
cancelar) **e** vendas JA (deve ser bloqueado na tela e no banco). Um teste de
banco que percorre o ciclo inteiro — lançar, baixar, conferir o livro,
estornar, conferir que o livro voltou, tentar estornar de novo. Estados de
carregando, vazio, erro, sucesso e repetição. `CI Banco` e `Banco Preview`
verdes.

**Recuperação:** correção de banco é migration nova. A tela pode ser revertida
sozinha sem perder cobrança já lançada; o que não pode ser revertido sozinho é
a ponte com o livro — lançamento gerado lá se corrige por estorno, nunca por
apagamento.

## Fase 3 — Pedido PJ entregue vira cobrança

**Concluída em 2026-08-14 (PR #233),** testada por Rodrigo no preview, com a
decisão 11 substituindo o gatilho único da decisão 8. O teste dele expôs dois
defeitos que os automáticos não pegavam: o cenário do Preview semeado com
"hoje", que vencia à meia-noite, e — a partir de uma pergunta dele sobre
horário — o uso da data do servidor (UTC) em vez da data da padaria, que
jogaria a receita de um envio noturno do dia 31 para o mês seguinte. Ver
`lessons.md`.


**Objetivo:** acabar com a digitação repetida do que já está no sistema.

**Escopo — entra:**

- corrigir a edição de pedido PJ para **não apagar e recriar** as linhas;
- a cobrança passa a ser criada **dentro da ação protegida que confirma o
  envio**, com o valor calculado pela mesma conta da tela do pedido e validado
  no banco;
- uma cobrança por pedido: confirmar o envio de novo devolve a mesma cobrança,
  nunca uma segunda;
- **a data de faturamento da cobrança é a data do envio confirmado** — é ela
  que decide em que mês essa venda pesa no resultado (decisão 10);
- **lista de pedidos com entrega vencida e sem envio confirmado** — a rede de
  proteção contra o esquecimento da Expedição.

**Não entra:** dar qualquer permissão financeira à Expedição. Ela continua sem
ver preço, total ou cobrança; quem cria o registro é a ação do banco, não a
pessoa.

**Risco principal desta fase, e ele é operacional:** desde julho de 2026 a
Expedição marcou *Enviado* em 1 pedido de 93. Se o hábito não mudar, a cobrança
deixa de nascer e o faturamento some. A lista de entregas vencidas sem envio
confirmado é o que torna esse esquecimento visível todo dia — sem ela, esta
fase troca um problema de digitação por um problema de receita.

**Depende de:** fase 2 e do PR #198 já incorporado.

**Arquivos prováveis:** `src/app/pedidos-pj/page.tsx`, `src/lib/receivables.ts`,
`src/app/contas-receber/`, migration nova.

**Riscos:** pedido cancelado depois de virar cobrança; pedido editado depois de
cobrado. Ambos precisam de bloqueio explícito no banco.

**Critérios de aceite:**

- editar um pedido preserva as linhas e a cobrança ligada a ele;
- abrir a cobrança mostra o pedido que a gerou, com os itens (decisão 9);
- pedido enviado aparece na lista de pendentes de cobrança e sai de lá quando
  vira cobrança;
- o valor da cobrança bate **exatamente** com o total mostrado na tela do
  pedido;
- gerar duas vezes não cria duas cobranças;
- pedido cancelado não pode virar cobrança; pedido já cobrado não pode ser
  cancelado sem antes cancelar a cobrança.

**Testes:** financeiro JC gera; expedição JC não vê a ação; um pedido com
pacote maior que 1 confere o valor.

## Fase 4 — Conta da semana da EX/Buck

**Concluída em 2026-08-14 (PR #234),** testada por Rodrigo no preview. Duas
decisões tomadas na execução: a Buck passou a ter prazo de 15 dias (o cadastro
estava sem prazo e sem ele o sistema recusa cobrar) e o período é escolhido
livremente, com sobreposição barrada por trava de banco.

O teste dele expôs que o Banco Preview grava o código das lojas em minúsculas
e produção em maiúsculas — a tela nunca teria encontrado a EX no ambiente de
teste — e que o perfil financeiro fictício não tinha permissão de ver
romaneios, embora a Elis a tenha em produção. Ao corrigir, apareceu também uma
fragilidade real: a conta escolhia uma loja EX com `limit 1` e ignoraria em
silêncio os romaneios de um segundo cadastro. Ver `lessons.md`.

**Dívida assumida:** a conta da Buck existe em `src/lib/romaneioBilling.ts` e
em `private.calcular_cobranca_buck`. São a mesma regra em duas linguagens e
precisam mudar juntas; a comparação de totais na geração é o alarme que dispara
se um lado mudar sozinho.


**Objetivo:** a cobrança semanal da Buck deixar de sumir na impressora.

**Escopo — entra:**

- ação na tela de Romaneios que transforma o período faturado em cobrança;
- **o valor é recalculado no banco**, a partir dos itens do romaneio e da tabela
  BUCK — o total vindo do navegador é apenas conferido, nunca aceito;
- as travas atuais (produto sem preço, unidade incompatível, quantidade
  suspeita) bloqueiam a geração, como já bloqueiam a impressão;
- um período já cobrado não pode ser cobrado de novo;
- **a data de faturamento é o último dia do período faturado**, e a receita cai
  em `buck_ex` no livro (decisão 10). Semana que atravessa a virada do mês pesa
  no mês em que o período fecha.

**Não entra:** mudar o documento impresso, o cálculo existente ou o fluxo do
romaneio.

**Depende de:** fase 2.

**Arquivos prováveis:** `src/app/relatorios/romaneios/page.tsx`,
`src/lib/romaneioBilling.ts`, migration nova.

**Riscos:** este é o fluxo do episódio dos R$ 190 mil. Recalcular no banco é
requisito, não preferência. Período sobreposto cobrado duas vezes é o segundo
risco e precisa de bloqueio no banco.

**Critérios de aceite:**

- gerar a cobrança da semana cria uma conta da Buck com o mesmo valor do
  documento impresso;
- abrir a cobrança mostra o período e os romaneios que a geraram (decisão 9);
- item sem preço ou com unidade incompatível impede a geração e diz o porquê;
- repetir a geração do mesmo período devolve a mesma cobrança.

**Testes:** financeiro JC gera; romaneio EX não vê a ação. Um período com item
sem preço tem que ser recusado.

## Fase 4B — Recebimento em pedaços

**Concluída em 2026-08-14 (PR #236),** testada por Rodrigo no preview. Nasceu
da decisão 12, fora do plano original: a informação de que a Buck paga
parcelado só apareceu quando a fase 4 ficou pronta.

**Escopo — entrou:** tabela `receivable_receipts`; situação `parcial`; um
lançamento no livro por pedaço; estorno por pedaço; cancelamento bloqueado com
dinheiro dentro; correção de vencimento liberada para cobrança parcial.

**Fica em aberto:** encerrar com desconto a cobrança que ficou faltando um
restinho. Aguarda acontecer na operação antes de ser construído.

## Fase 5 — Extrato por cliente e lista de atrasados

**Objetivo:** responder em uma tela o que faltou no dia do DRE.

**Escopo — entra:**

- extrato por cliente: tudo que ele deve, deveu e pagou, com período;
- lista de atrasados por faixa de atraso;
- total a receber por período;
- exportação em CSV;
- campo de número da nota fiscal na cobrança, preenchido quando houver.

**Não entra:** gráfico, previsão de recebimento, régua de cobrança.

**Depende de:** fases 2, 3 e 4 — o extrato só é confiável quando as três
origens já alimentam a lista.

**Critérios de aceite:** abrir um cliente e ver o faturamento inteiro dele sem
consultar nenhum outro sistema.

## Fase 6 — Preço: histórico, vigência e faxina nas tabelas

**Objetivo:** poder responder quanto se cobrava de um cliente em uma data
passada, e parar de criar tabela nova a cada cliente.

**Escopo — entra:** histórico de alteração de preço; data de vigência;
arquivamento das tabelas duplicadas e das cópias.

**Depende de:** nada do módulo. Pode ser adiada sem prejuízo.

**Observação:** os pedidos já gravam o preço praticado na própria linha, então
cobrança antiga não é afetada por mudança de tabela. Esta fase é melhoria de
gestão, não correção de risco.

---

## Ordem recomendada

`0 → 1 → 2` entrega o essencial: ao fim da fase 2 o Bling pode ser desligado e
a informação passa a viver em um lugar só. `3` e `4` tiram trabalho manual.
`5` entrega a visão que motivou o projeto. `6` pode esperar.

## Coordenação com o outro agente

O Sol (Codex) trabalhou em contas a pagar até o PR #197, incorporado em
2026-08-07. Áreas financeiras devem ser conferidas antes de cada fase: duas
frentes no mesmo fluxo são proibidas, sobreposição de área e não só de arquivo.

Atualização de 2026-08-13: o módulo Financeiro avançou muito entre 12 e 13 de
agosto (PRs #222 a #229) e **encosta neste plano**. A fase 2 daqui vai tocar
`finance_entries` e as funções do livro; a fase 4 do
[FINANCEIRO.md](FINANCEIRO.md) (o DRE) lê as cobranças daqui. Antes de começar
a fase 2, confirmar com Rodrigo que ninguém está mexendo no Financeiro ao
mesmo tempo — e lembrar que PR com migration segura a fila do Banco Preview
(lição `preview-compartilhado-nao-aceita-fila-paralela`).
