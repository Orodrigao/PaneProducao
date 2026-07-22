# Ambiente Preview seguro

## Objetivo

Todo código ainda não integrado à `main` deve ser testado sem ler ou alterar
o banco real da padaria. O mesmo projeto da Vercel mantém dois destinos:

- Production → `PanePedidosLojas` (`gohluceldchoitihrimw`);
- Preview e desenvolvimento local → `PaneERP Preview`
  (`tuqzhjsbodoycjbmwuqm`).

O Banco Preview contém apenas dados fictícios gerados por
`supabase/seed.sql`. Nunca recebe cópia de clientes, vendas, preços, usuários
ou documentos de produção.

## Ciclo de uma PR com migration

1. Abrir ou atualizar a PR dispara `CI Banco` e `Banco Preview`.
2. `CI Banco` ensaia migrations e seed num banco local descartável.
3. `Banco Preview` apaga o ambiente remoto de teste, reaplica a história
   completa da branch, carrega o seed e roda os pgTAP.
4. O preview só está liberado quando Vercel, CI Banco e Banco Preview estão
   verdes.
5. Fechar ou integrar a PR reconstrói o Banco Preview usando a `main`.

O passo 5 não é limpeza opcional. Ele remove migrations de uma PR descartada,
impedindo que o próximo preview converse com um schema que nunca existiu em
produção.

## Banco compartilhado no plano gratuito

Existe um único Banco Preview. Duas PRs com migrations abertas poderiam
trocar o schema uma da outra; por isso a automação bloqueia a segunda. Enquanto
uma PR com migration estiver usando o banco, outra PR que tente reconstruí-lo
também espera. PR sem mudança de banco pode continuar em paralelo, desde que
não dependa de schema ainda não integrado.

## Dados e contas fictícias

O seed cria:

- as lojas JC, JA e EX com identificação explícita de teste;
- três produtos da área Cozinha;
- dois pães e pedidos do dia para JA e EX;
- perfis e permissões somente quando as respectivas contas já existem no
  Supabase Auth.

Contas com senha são criadas pelo mecanismo oficial do Supabase Auth, nunca
por migration. E-mails previstos:

- `rodrigao+teste@gmail.com` — administrador;
- `rodrigao+teste-vendas-ja@gmail.com` — perfil sem acesso à Cozinha;
- `rodrigao+teste-expedicao-jc@gmail.com` — saída de Romaneio/PJ;
- `rodrigao+teste-romaneio-ex@gmail.com` — conferência da EX;
- `rodrigao+teste-cozinha-jc@gmail.com` — Produção da Cozinha na JC.

As contas são criadas pela API oficial do Supabase Auth depois de cada reset.
Todas usam uma senha fictícia que obedece à política do aplicativo e fica no
secret `SUPABASE_TEST_USER_PASSWORD` do GitHub e no gerenciador de senhas do
Rodrigo. Senha nunca entra no repositório, documentação, log ou conversa.

## Segredos de infraestrutura

O workflow espera estes secrets, instalados somente na fase de ativação:

- `SUPABASE_OWNER_ACCESS_TOKEN` — token criado pela conta proprietária do
  Rodrigo;
- `SUPABASE_PREVIEW_DB_PASSWORD` — senha técnica apenas do banco de teste;
- `SUPABASE_TEST_USER_PASSWORD` — senha compartilhada apenas pelas cinco
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

## Reconstrução manual

Em GitHub Actions, execute `Banco Preview` por `workflow_dispatch` e informe
`RECONSTRUIR`. A operação apaga somente o banco de teste e o recompõe a partir
da `main`. Nunca use esse procedimento no projeto de produção.
