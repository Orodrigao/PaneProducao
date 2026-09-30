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
   O check aparece em toda PR, mas o **ensaio só roda** quando a PR mexe em
   migration, teste de banco, seed ou `config.toml` — a lista completa está em
   `docs/regras/BANCO.md`. Nas outras PRs ele fica verde com "Ensaio
   dispensado".
4. O preview só está liberado quando a Vercel está verde, mais `Banco por PR`
   **e** `Usuarios do Banco por PR` quando a PR mexe em `supabase/`, mais
   `CI Banco`. Sem o de usuários, o link abre num banco sem nenhuma conta para
   entrar.
5. Fechar a PR apaga o banco isolado dela e trava a branch na Vercel num
   endereço inválido (`pr-fechada-sem-banco.invalid`): um push depois do
   fechamento gera preview com build vermelho, inclusive quando o push é só de
   documentação, nunca um preview no banco compartilhado sem reserva. Previews
   já publicados não mudam: variável nova só vale para deployment nova.
   Reabrir a PR destrava (aponta de novo para o banco dela, ou devolve ao
   compartilhado se ela não mexe em `supabase/`); apagar a branch remove a
   trava. Cada execução do `Banco por PR` confere no GitHub se a branch existe
   e se tem PR aberta antes de mexer, e as execuções da mesma branch fazem
   fila, porque o GitHub não garante a ordem dos eventos. O disparo manual dos
   dois workflows recusa PR fechada e branch que não seja a da PR. Push na
   `main`, e PR fechada sem merge, reconstroem o `PaneERP Preview`
   compartilhado a partir da `main`.

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

Em 2026-08-30 e de novo em 2026-09-30 o GitHub cancelou quem esperava na fila,
porque guardava um só pendente por grupo: CIs e reconstruções morreram e o
banco ficou atrás da `main` sem aviso. Desde 2026-09-30:

- os dois lados usam `queue: max`: até 100 esperam, em ordem de chegada, e
  quem chega depois não cancela quem espera;
- entre as execuções do `Banco Preview`, só entra na fila a que vai de fato
  apagar e reconstruir o banco; push documental, push só de mecanismo de CI e
  PR fechada com merge rodam num grupo próprio (os smokes de produto seguem
  na fila, como antes);
- cada reconstrução restaura o topo da `main` no momento em que começa, e o
  resumo do job diz qual commit foi restaurado, só depois de tudo dar certo;
- no push da `main`, a espera do smoke pela restauração do próprio commit
  roda num job antes do navegador, fora da fila, para os dois não se
  esperarem.

Limites que continuam: reconstrução que falha deixa o banco atrás até a
próxima dar certo (o job fica vermelho); com mais de 100 esperando o GitHub
cancela quem chega; a espera do smoke no push desiste depois de 30 minutos,
e com muitos smokes na frente da restauração o navegador reprova mesmo que a
restauração termine depois (reexecute só o navegador); e execuções que já
estavam na fila com o `ci.yml` antigo, ou reexecuções de runs antigos, seguem
a regra antiga. A serialização dos smokes entre si
continua: separá-los segue sendo fase própria, que começa pelos testes, não
pela trava.

**Ramificação que ainda não nasceu: corrigido.** A revisão de 2026-08-30
apontou que o `Banco por PR` desistia na primeira consulta e deixava uma PR com
migration apontada para o banco compartilhado sem aviso. Hoje
`scripts/preview-branch-env.mjs` distingue "não mexe em `supabase/`" de "a
ramificação ainda não apareceu" e, no segundo caso, espera até 300 segundos;
se ela não nascer, o check fica vermelho dizendo que seguir testaria o banco
errado (conferido no código em 2026-09-30).

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
- `rodrigao+teste-financeiro-jc@gmail.com` — Financeiro JC;
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

### Acesso dos agentes e prova funcional

Os agentes estão autorizados a autenticar com essas contas no preview e executar
os testes do escopo aprovado, inclusive criar, alterar e limpar registros fictícios
da própria execução. Usar login existente não é alterar Auth, roles ou permissões.
Não enviar e-mail/SMS real, efetuar pagamento nem acionar integração externa real
como efeito de teste. Não apagar registros de outra tarefa nem reconstruir o banco
compartilhado por conveniência; respeitar as reservas e o ciclo oficial de reset.

Antes do teste, conferir a PR/revisão, URL publicada, checks de provisionamento e
destino do banco. Usar o perfil correto, não apenas uma sessão admin já aberta.
Testar os perfis/lojas afetados e o fluxo completo: entrada válida, salvar, reler
após reload, rejeição de entrada inválida, descarte e troca de sessão quando
afetados. Dados simulados no navegador não comprovam gravação nem RLS real.

A credencial de aplicativo do preview pode ser fornecida ao agente por cofre ou
canal local aprovado, separado do repositório. Não usar senha pessoal, senha de
banco, service role ou token administrativo para simular um usuário comum. O CI
já injeta `SUPABASE_TEST_USER_PASSWORD`; o secret do GitHub não oferece leitura
do valor, portanto não tentar extraí-lo por log ou artefato. Fora do CI, usar
integração de cofre ou canal local já disponível e autorizado. Não copiar a credencial
para `.env.local` da worktree, selado pela portaria.

Se o acesso local não estiver preparado, aproveitar os testes existentes no CI
e completar a cobertura pelo fluxo autorizado. Identificar as lacunas reais e
preparar o acesso reutilizável por canal aprovado; caso dependa de intervenção
humana, pedir apenas esse provisionamento, nunca transferir todo o roteiro.
Não tratar essa orientação como evidência de que o acesso local já foi instalado.
Teste focal roda direto na worktree sobre dependências já instaladas; a bateria
completa selada roda no Check isolado da Portaria, depois do CI remoto verde.

Relatar ambiente, revisão, cenários, resultado e limites, sem credenciais. Teste
ignorado ou instável não vira prova por repetir até passar. Rodrigo não é o
testador técnico final; sua avaliação de usabilidade é complementar, salvo
aceite humano expressamente pedido para a entrega.

## Segredos de infraestrutura

O workflow espera estes secrets, instalados somente na fase de ativação:

- `SUPABASE_OWNER_ACCESS_TOKEN` — token criado pela conta proprietária do
  Rodrigo;
- `SUPABASE_PREVIEW_DB_PASSWORD` — senha técnica apenas do banco de teste;
- `SUPABASE_TEST_USER_PASSWORD` — senha compartilhada apenas pelas
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

Os testes de fotos de produto são a exceção: falam com o preview da Vercel da
própria PR, localizado por `scripts/preview-da-pr.mjs`. Quando o último push é
só documental, a Vercel não publica o commit; o teste então usa o último
commit publicado da PR, desde que esteja verde, venha da Vercel e só haja
documentação entre ele e o commit atual. Mudança no mecanismo de CI no meio
(inclusive nos workflows que ligam o preview ao banco da PR) não vale. Qualquer dúvida
reprova com a mensagem "A Vercel ainda nao publicou um preview verde".

## Navegador no preview desta PR (piloto)

Plano aprovado pelo Rodrigo em 2026-09-30, fases 1 a 3 até integrar. Motivo: a
plataforma de um dos agentes não deixa digitar senha fora de `localhost`, e em
PR que mexe em `supabase/` o teste de perfil só roda no link da Vercel. Com
isso o Rodrigo logava na mão a cada PR de banco. Agora quem entra é o GitHub,
com o secret `SUPABASE_TEST_USER_PASSWORD`. O agente escreve os roteiros e lê o
resultado, sem ver a senha.

O check `Navegador no preview desta PR` é um job de
`Usuarios do Banco por PR`. Roda só em PR que mexe em `supabase/`, depois de o
provisionamento criar as contas, e fica vermelho, nunca pulado, se o
provisionamento não terminar bem. A ordem é esta:

1. o provisionamento publica o endereço do banco da PR (não é segredo: ele já
   vai no JavaScript do preview);
2. `scripts/preview-pr-pronto.mjs` espera o `Apontar o preview para o banco
   desta PR` do commit, localiza o preview verde por `scripts/preview-da-pr.mjs`
   e só aceita quando o JavaScript publicado daquele link cita o banco da PR e
   nenhum outro. Produção reprova na hora; o banco compartilhado espera o
   redeploy por até 15 minutos;
3. o Playwright (`playwright.preview-pr.config.ts`, roteiros em
   `test/preview-pr/`) entra com `entrarComo(page, perfil)` de
   `test/preview-pr/apoio/entrar.ts`, o único arquivo que lê a senha. Durante a
   sessão a página só fala com o preview e com o banco da PR, e o login precisa
   ter ido a esse banco;
4. `scripts/preview-pr-resumo.mjs` escreve no resumo do job a tabela perfil ×
   loja × esperado × resultado, e reprova se nada rodou, se algo foi pulado, se
   um teste só passou na repetição ou se falta a matriz (`matriz(...)` na
   declaração do teste).

O job não recebe o token do Supabase nem o da Vercel. A senha só existe no
passo do Playwright, depois do `npm ci`, e só `pull-requests`, `contents`,
`checks` e `deployments` em leitura. Risco residual aceito pelo Rodrigo: o
código da PR roda com a senha de teste, como já acontece no job de navegador do
`ci.yml`. Em falha, o artefato guarda só o `error-context.md` por 7 dias.
`scripts/preview-pr-guarda.test.mjs`, no `npm test`, reprova roteiro que cite
a senha, pule teste ou leia o ambiente, e executa o passo que publica o
endereço do banco com uma CLI falsa.

Roteiro novo: mudança de permissão se prova em dois níveis. O perfil permitido
consegue, e o bloqueado é barrado na tela e numa chamada direta à Data API com
o token da própria sessão (`cabecalhosDaSessao`), com o mesmo pedido passando
para quem pode. Dado criado leva marca única da execução e é limpo quando der;
o próximo `Usuarios do Banco por PR` reaplica o seed.

Fases: 1, o check existe e é provado numa PR-canário fechada sem merge; 2,
piloto numa PR real de banco; 3, a regra entra em `docs/regras/BANCO.md`,
`docs/regras/FECHAMENTO.md` e no briefing das skills. Pôr o check na
`Trava da main` é decisão separada, depois de umas dez PRs estáveis. PR que não
mexe em `supabase/` continua no job `Navegador (login, perfis e lojas)`.

## Testes locais e armadilhas conhecidas

Regras curtas tiradas de falhas reais entre julho e setembro de 2026. O
post-mortem de cada uma está na PR correspondente.

- **pgTAP na máquina, com Docker só sob demanda e só o banco.** Abra o Docker
  Desktop apenas para testar PR que mexe em `supabase/`. Suba só o Postgres,
  como o `CI Banco`: `supabase db start`, `supabase db reset --local` (cerca de
  4 minutos) e `docker exec -i supabase_db_pane-processo psql -U postgres -d
  postgres -f - < supabase/tests/<arquivo>.test.sql`; confira `grep -c "^ ok"`
  contra o `plan(N)` e `grep "^ not ok"` para as falhas. O atalho `supabase test
  db` falha com "No plan found in TAP output" por defeito do container auxiliar;
  o schema aplica normalmente. Não use `supabase start`: ele sobe 11 serviços
  que religam sozinhos a cada abertura do Docker. Ao terminar, `supabase stop` e
  `docker desktop stop`.
- **Migration com regex `\nbegin\n` trava `db reset --local` por CRLF, não é
  bug da migration.** Sem `.gitattributes` para `.sql`, `core.autocrlf=true`
  no Windows converte as migrations para CRLF no checkout (`git ls-files
  --eol` mostra `w/crlf`). Migration que reconstrói função via
  `pg_get_functiondef` e casa `\n` puro — caso de
  `20260919235223_idempotencia_financeira_concorrente.sql`, que busca
  `E'\nbegin\n'` — recebe `\r\nbegin\r\n` e não bate, travando `supabase db
  reset --local` com "Nao foi possivel localizar o inicio da RPC
  confirm_finance_recurring_rule". Produção e `CI Banco` rodam em
  `ubuntu-latest`, checkout em LF, e não sofrem. Confirmado vermelho/verde com
  Postgres descartável em 20/09/2026 (ver a lição
  `postgres-descartavel-sem-docker` na memória): recriar a função com o texto
  exato do disco reproduz o erro; normalizar `\r\n` para `\n` antes de criar a
  função faz o mesmo regex casar. Contorno local: `git config core.autocrlf
  input` e recheckout de `supabase/` antes do reset. Um `.gitattributes`
  fixando LF em `supabase/**/*.sql` resolveria de vez, mas é decisão pendente
  do Rodrigo por afetar o checkout de todo mundo.
- **Docker Desktop cai ao abrir com "rename ... .sock ... The file cannot be
  accessed by the system".** Nesta máquina os sockets de
  `%LOCALAPPDATA%\Docker\run` e `%LOCALAPPDATA%\docker-secrets-engine` ficam
  ilegíveis toda vez que o Docker fecha (medido em 14/09/2026). Com o Docker
  fechado, renomeie as duas pastas com sufixo de data antes de abrir; ele recria
  pastas limpas. Nunca use "Reset to factory defaults".
- **Máquina esgotada deixa a portaria lenta.** O `Check` abre milhares de
  processos `git`; com a memória comprometida acima de 90%, cada processo passou
  de 50 ms para mais de 1 s e o preparo do snapshot foi de 10 minutos para mais
  de 2 horas (12 a 14/09/2026). Antes de culpar a portaria, confira memória e
  sessões abertas. Entrega integrada ou encerrada: arquive a sessão.
- **Reexecutar o navegador em outro dia exige seed novo.** O seed grava a data
  do dia em que rodou. O job de navegador do CI lê sempre o `PaneERP Preview`
  compartilhado, mesmo em PR que mexe em `supabase/`: reexecute `Banco Preview`
  com `RECONSTRUIR` e só depois o job. Para o banco isolado da PR (teste humano
  pelo link), reexecute `Usuarios do Banco por PR`, que recria as contas e
  reaplica o seed; `Banco por PR` só aponta a Vercel para o banco certo.
- **Teste humano no preview compartilhado consome cenário.** O smoke exige
  sobras da Geolar por resolver e a tela obriga a resolvê-las. Depois de um
  teste humano no banco compartilhado, reconstrua antes de confiar no semáforo.
- **Falha de smoke na janela de reconstrução não é corrida esperada.** O job de
  navegador divide a fila `banco-preview-compartilhado` com o `Banco Preview` e
  espera a restauração terminar. Se ainda assim falhar nessa janela, a guarda
  falhou: investigue, não reexecute por reflexo.
- **PRs sem `supabase/` abertas juntas geram links quase iguais no mesmo banco.** Ao
  entregar o link, diga o trecho do endereço que identifica a branch e um sinal
  visível na tela. Para confirmar a versão no ar: `curl` na página e `grep` no
  chunk de `/_next/static/chunks/app/<rota>/` por texto que só a versão nova tem.
- **Roteiro de perfis vem da `main`, seed vem da PR.** PR que muda rota ou
  permissão de perfil fictício entra em três passos: afrouxar o roteiro para
  aceitar os dois estados, entrar o seed novo, apertar o roteiro de volta.
- **Preview não reproduz produção.** Permissão que falta ao perfil fictício faz
  a RLS esconder a linha e a tela dizer "não existe"; compare o cenário com
  produção (leitura) antes de mexer no código.

## Reconstrução manual

Em GitHub Actions, execute `Banco Preview` por `workflow_dispatch` e informe
`RECONSTRUIR`. A operação apaga somente o banco de teste e o recompõe a partir
da `main`. Nunca use esse procedimento no projeto de produção.
