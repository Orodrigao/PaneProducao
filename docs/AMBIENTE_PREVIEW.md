# Ambiente Preview seguro

## Objetivo

Todo código ainda não integrado à `main` deve ser testado sem ler ou alterar
o banco real da padaria. Os destinos são:

- Production → `PanePedidosLojas` (`gohluceldchoitihrimw`);
- preview de PR que mexe em `supabase/` → o banco isolado daquela PR, criado
  e apagado pelo Supabase;
- demais previews e desenvolvimento local → `PaneERP Preview`
  (`tuqzhjsbodoycjbmwuqm`), que espelha a `main`.

O Banco Preview contém apenas dados fictícios gerados por
`supabase/seed.sql`. Nunca recebe cópia de clientes, vendas, preços, usuários
ou documentos de produção.

## Ciclo de uma PR

1. PR que mexe em `supabase/` recebe do Supabase um banco isolado, nascido das
   migrations e do seed daquela branch. O workflow `Banco por PR` grava na
   Vercel as variáveis daquela branch e manda refazer o preview; o workflow
   `Usuarios do Banco por PR` cria as contas fictícias e reaplica o seed lá
   dentro.
2. PR que não mexe em `supabase/` não ganha banco próprio e não precisa: o
   preview dela usa o `PaneERP Preview` compartilhado, que espelha a `main`.
3. `CI Banco` ensaia a história completa do schema num banco local descartável.
   Ele **não roda em toda PR**: só dispara quando a PR toca
   `supabase/migrations/`, `supabase/tests/`, `supabase/seed.sql` ou
   `supabase/config.toml`.
4. O preview só está liberado quando a Vercel está verde, mais `Banco por PR`
   **e** `Usuarios do Banco por PR` quando a PR mexe em `supabase/`, mais
   `CI Banco` quando ele dispara. Sem o de usuários, o link abre num banco sem
   nenhuma conta para entrar.
5. Fechar a PR apaga o banco isolado dela e as variáveis daquela branch. Push na
   `main`, e PR fechada sem merge, reconstroem o `PaneERP Preview` compartilhado
   a partir da `main`.

O reset do passo 5 não é limpeza opcional. Ele remove migrations de uma PR
descartada, impedindo que o próximo preview converse com um schema que nunca
existiu em produção.

Os objetos novos do banco nascem sem acesso automático para a API. Toda
migration que criar tabela, sequência ou função deve conceder explicitamente
somente os acessos necessários. Isso mantém produção, CI e Preview com a mesma
regra, independentemente dos padrões do projeto hospedado.

## Estado da transição

**Concluída em 2026-08-30.** Até 29/08 existia um único Banco Preview, e a
etiqueta `precisa-banco-preview` reservava esse banco para uma PR de cada vez.
Os PRs #287 a #291 puseram no ar o encadeamento GitHub, Supabase e Vercel, e
agora cada PR que mexe em `supabase/` recebe ambiente próprio. Não há mais fila.

Conferido em 2026-08-30 por leitura direta da API do Supabase, sem escrita: as
PRs #286 e #292 tinham, ao mesmo tempo, bancos isolados próprios e saudáveis,
ambos criados sem dados de produção.

**O arranjo antigo saiu do código:** a etiqueta `precisa-banco-preview`, o job
`Reconstruir Preview desta PR` e a espera por etiqueta no `ci.yml` foram
removidos. O job `Restaurar Banco Preview para a main`, no mesmo arquivo,
**continua necessário**: é ele que mantém o banco compartilhado usado por toda
PR que não mexe em `supabase/`.

**A fila do smoke continua de pé, e de propósito.** O job do navegador e o
workflow do banco dividem a trava `banco-preview-compartilhado`. Ela parece
desperdício, porque vários smokes poderiam correr juntos, mas os testes de
navegador **escrevem** no banco: criam compra manual, cadastram fornecedor e
lançam movimento financeiro, cada um com carimbo de tempo para se distinguir.
Dois smokes simultâneos podem conferir o registro criado pelo outro. Tirar a
trava sem antes separar os testes que escrevem dos que só leem troca um
entupimento visível por falha intermitente, que é pior. Uma tentativa nesse
sentido foi reprovada em revisão em 2026-08-30.

O custo dela é real e está medido: naquele mesmo dia, com cinco frentes
abertas, o GitHub cancelou quem estava na fila, dois CIs e quatro
reconstruções morreram em cascata e o banco ficou sem ser restaurado. Resolver
isso é fase própria, e começa pelos testes, não pela trava.

**Limitação conhecida, ainda sem correção.** O `Banco por PR` consulta a lista
de ramificações uma vez e, se a da PR ainda não tiver nascido, encerra tratando
a PR como se não tivesse banco próprio. GitHub e Supabase não garantem ordem
entre si, então uma PR com migration pode acabar apontada para o banco
compartilhado sem aviso. Apontado na revisão de 2026-08-30; corrigir exige
distinguir "não mexe em `supabase/`" de "a ramificação ainda não apareceu" e
esperar nesse segundo caso.

O Supabase cobra o compute usado por branch; na tabela consultada em 2026-08-28,
o tamanho Micro começa em US$ 0,01344 por hora, exige plano Pro e esse consumo
não é coberto pelo Spend Cap. Rodrigo aceitou esse custo em 2026-08-28. Consulte
sempre a [documentação de Branching](https://supabase.com/docs/guides/deployment/branching)
e a [página de cobrança vigente](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
antes de mudar a configuração.

Feature Branching resolve o isolamento remoto entre PRs. Ele não elimina por si
só o Docker usado pelo ensaio descartável de `CI Banco`; trocar esse ensaio é
outra decisão e exige evidência equivalente da história completa de migrations.

## Dados e contas fictícias

O seed cria:

- as lojas JC, JA e EX com identificação explícita de teste;
- o catálogo fictício da área Cozinha;
- dois pães e pedidos do dia para JA e EX;
- romaneios fictícios da EX, incluindo uma viagem enviada para testar
  conferência pendente;
- perfis e permissões somente quando as respectivas contas já existem no
  Supabase Auth.

Contas com senha são criadas pelo mecanismo oficial do Supabase Auth, nunca
por migration. E-mails previstos:

- `rodrigao+teste@gmail.com` — administrador;
- `rodrigao+teste-vendas-ja@gmail.com` — Vendas JA, entra no Romaneio e testa as cinco rotas aprovadas;
- `rodrigao+teste-expedicao-jc@gmail.com` — saída de Romaneio/PJ;
- `rodrigao+teste-romaneio-ex@gmail.com` — conferência da EX;
- `rodrigao+teste-cozinha-jc@gmail.com` — Produção da Cozinha na JC;
- `rodrigao+teste-geolar-jc@gmail.com` — tela de Produção da Geolar na JC.

O seed também prepara um cenário da Geolar no próximo dia de produção: pedido
de 10 Baguetes na JC, com 5 unidades no freezer, 2 sobras pendentes e 3
unidades novas. A proposta de sobra fica pendente para a tela começar
bloqueada e ser liberada após a conferência.

As contas são criadas pela API oficial do Supabase Auth depois de cada reset.
Todas usam uma senha fictícia que obedece à política do aplicativo e fica no
secret `SUPABASE_TEST_USER_PASSWORD` do GitHub e no gerenciador de senhas do
Rodrigo. Senha nunca entra no repositório, documentação, log ou conversa.

## Segredos de infraestrutura

O workflow espera estes secrets, instalados somente na fase de ativação:

- `SUPABASE_OWNER_ACCESS_TOKEN` — token criado pela conta proprietária do
  Rodrigo;
- `SUPABASE_PREVIEW_DB_PASSWORD` — senha técnica apenas do banco de teste;
- `SUPABASE_TEST_USER_PASSWORD` — senha compartilhada apenas pelas seis
  contas fictícias do ambiente de teste.

A chave administrativa do Auth não fica gravada como secret adicional. O
workflow a obtém temporariamente com o token do proprietário, mascara o valor
nos logs e a descarta ao fim da execução.

O workflow contém também uma trava independente que aceita somente o ref
`tuqzhjsbodoycjbmwuqm`. Mesmo uma configuração equivocada de segredo não deve
permitir que o reset aponte para produção.

## Projeto pausado

O Supabase pode pausar um projeto gratuito depois de baixa atividade. Se o
preview inteiro apresentar erro:

1. abra o Supabase e confira o estado de `PaneERP Preview`;
2. reative o projeto se estiver pausado;
3. aguarde ficar `ACTIVE_HEALTHY`;
4. reexecute `Banco Preview` antes de investigar o código da funcionalidade.

O workflow falha com essa orientação quando detecta que o projeto não está
saudável.

## Smoke tests no navegador

O CI possui o controle `Navegador (login, perfis e lojas)`. Ele inicia a
versão da própria branch localmente, usando `.env.example`, e executa no Google
Chrome uma baseline sem gravação operacional:

- uma pessoa sem sessão é enviada ao login;
- o administrador abre Sobras e encontra JC e JA;
- Cozinha JC entra na Produção da Cozinha;
- Vendas JA é bloqueada da Produção da Cozinha.

O comando local é `npm run test:browser`. Sem
`SUPABASE_TEST_USER_PASSWORD`, somente o cenário público roda e os três logins
ficam explicitamente marcados como ignorados. No GitHub, a ausência do secret
falha o job antes do teste — nunca transforma cenário não executado em
aprovação.

A configuração usa somente `http://127.0.0.1` para o site da branch. A trava
existente no build valida que o Supabase é o projeto Preview. Screenshots,
vídeos, traces e relatórios com sessão não são gerados.

## Reconstrução manual

Em GitHub Actions, execute `Banco Preview` por `workflow_dispatch` e informe
`RECONSTRUIR`. A operação apaga somente o banco de teste e o recompõe a partir
da `main`. Nunca use esse procedimento no projeto de produção.
