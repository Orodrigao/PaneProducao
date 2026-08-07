# CONTAS_A_RECEBER.md — Plano do módulo

**Natureza:** plano de funcionalidade nova, dividido em fases.
**Status:** descoberta concluída em 2026-08-07. Aguardando aprovação da fase 0.
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
- juros, multa ou correção por atraso;
- cobrança automática por WhatsApp ou e-mail;
- pagamento parcial de uma cobrança (uma cobrança é quitada inteira);
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

---

# Fases

Cada fase cabe em uma conversa e termina testável no navegador.

## Fase 0 — Dados de teste de Pedidos PJ no Banco Preview

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

**Objetivo:** existir um único lugar que responde quem deve, quanto e quando —
e o Bling poder ser desligado.

**Escopo — entra:**

- tabelas de cobrança e de eventos, espelhando o padrão já validado de contas a
  pagar (`20260803200136_contas_a_pagar_manual.sql`);
- permissões granulares próprias: acessar, lançar, baixar, cancelar e corrigir;
- ações protegidas no banco (`SECURITY DEFINER`, `search_path` seguro, grants
  explícitos), com escrita **somente por elas** — nunca direto na tabela;
- RLS em todas as tabelas novas, com policy de leitura por permissão;
- tela `/contas-receber`: lista de quem deve, com atrasados e a vencer em
  destaque; lançamento avulso; baixa; cancelamento com motivo; correção de
  vencimento;
- rota derivada da permissão granular, como já é feito em `/pedidos-pj`.

**Não entra:** geração automática a partir de pedido ou romaneio (fases 3 e 4),
extrato por cliente (fase 5), pagamento parcial.

**Depende de:** fase 1 (o vencimento vem do prazo do cliente) e da decisão
sobre o bloqueio de hardening registrada acima.

**Arquivos e tabelas prováveis:** migration nova; `src/app/contas-receber/`;
`src/lib/receivables.ts` e testes; `src/lib/auth.ts` para a rota.

**Riscos:**

- os três planos de permissão (`DEFAULT_ROUTES_BY_ROLE`, `allowed_routes` e
  `app_user_permissions`) precisam concordar, senão a Elis fica com o checkbox
  marcado e sem conseguir abrir a tela;
- valor é dinheiro: validar no banco, não só na tela — a lição
  `validar-tambem-na-saida` nasceu de um erro de R$ 190 mil;
- lançar duas vezes a mesma cobrança. Toda ação de criação carrega
  identificador próprio e repetir devolve a mesma cobrança, sem duplicar.

**Critérios de aceite:**

- a Elis lança uma cobrança avulsa escolhendo cliente, valor, descrição e data
  base; o vencimento aparece calculado do prazo do cliente;
- a lista mostra o que está atrasado e o que vence nos próximos dias;
- a baixa registra quem deu e quando; o cancelamento exige motivo;
- cobrança já recebida não pode ser cancelada;
- repetir a ação (toque duplo, recarregar) não duplica nem corrompe;
- **um perfil sem a permissão é bloqueado pelo banco**, não apenas pela tela.

**Testes — matriz obrigatória:** financeiro JC (deve conseguir lançar, baixar e
cancelar) **e** vendas JA (deve ser bloqueado na tela e no banco). Estados de
carregando, vazio, erro, sucesso e repetição. `CI Banco` e `Banco Preview`
verdes.

**Recuperação:** correção de banco é migration nova. A tela pode ser revertida
sozinha sem perder cobrança já lançada.

## Fase 3 — Pedido PJ entregue vira cobrança

**Objetivo:** acabar com a digitação repetida do que já está no sistema.

**Escopo — entra:**

- corrigir a edição de pedido PJ para **não apagar e recriar** as linhas;
- ação que transforma um pedido enviado em cobrança, com o valor calculado pela
  mesma conta da tela do pedido e validado no banco;
- uma cobrança por pedido: gerar de novo devolve a mesma, nunca uma segunda;
- lista de pedidos entregues que ainda não viraram cobrança.

**Não entra:** geração automática no momento em que a Expedição confirma o
envio. **Decisão:** quem gera a cobrança é o financeiro, com um clique — a
Expedição não cria registro financeiro. Se Rodrigo preferir automático, é nova
aprovação.

**Depende de:** fase 2 e do PR #198 já incorporado.

**Arquivos prováveis:** `src/app/pedidos-pj/page.tsx`, `src/lib/receivables.ts`,
`src/app/contas-receber/`, migration nova.

**Riscos:** pedido cancelado depois de virar cobrança; pedido editado depois de
cobrado. Ambos precisam de bloqueio explícito no banco.

**Critérios de aceite:**

- editar um pedido preserva as linhas e a cobrança ligada a ele;
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

**Objetivo:** a cobrança semanal da Buck deixar de sumir na impressora.

**Escopo — entra:**

- ação na tela de Romaneios que transforma o período faturado em cobrança;
- **o valor é recalculado no banco**, a partir dos itens do romaneio e da tabela
  BUCK — o total vindo do navegador é apenas conferido, nunca aceito;
- as travas atuais (produto sem preço, unidade incompatível, quantidade
  suspeita) bloqueiam a geração, como já bloqueiam a impressão;
- um período já cobrado não pode ser cobrado de novo.

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
- item sem preço ou com unidade incompatível impede a geração e diz o porquê;
- repetir a geração do mesmo período devolve a mesma cobrança.

**Testes:** financeiro JC gera; romaneio EX não vê a ação. Um período com item
sem preço tem que ser recusado.

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
