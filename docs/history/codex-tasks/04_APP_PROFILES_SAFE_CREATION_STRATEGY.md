# 04 — Estratégia segura para criação de profiles reais

## Objetivo

Definir a estratégia futura para criar profiles reais em `public.app_profiles` com segurança, auditabilidade e baixo risco.

Esta tarefa é apenas documental. Ela não cria usuários, não insere dados, não executa SQL e não altera o login atual.

## Estado atual

- `public.app_profiles` existe no Supabase.
- `app_profiles` está vazia.
- RLS está habilitado e forçado.
- `anon` não tem acesso.
- `authenticated` só pode ler o próprio profile.
- `store` aceita apenas `null`, `jc`, `ex`, `ja`.
- `PJ` é canal/tipo de pedido, não loja.
- Login atual não depende de `app_profiles`.
- Login atual ainda usa `app_users`/PIN/localStorage.
- Não há usuários reais criados para essa nova estrutura.
- A matriz preliminar está em `docs/APP_PROFILES_REAL_USERS_MATRIX.md`.

## Dependências antes de qualquer criação real

Antes de criar qualquer usuário real ou qualquer profile real, exigir:

1. Matriz final de usuários aprovada.
2. E-mails confirmados.
3. Decisão sobre Elis: `jc` ou `global`.
4. Substituição de “Atendimento EX” por pessoa real.
5. Decisão sobre Marselle: `vendas` ou futura role `gerente_loja`.
6. Definição de quem pode ser admin.
7. Estratégia de criação aprovada.
8. Plano de rollback/documentação.
9. Confirmação de que o login atual não será alterado.

Sem esses itens, o Codex deve parar e apenas reportar o que falta.

## Opções de criação futura

As opções abaixo são comparação e planejamento. Não executar nenhuma delas nesta tarefa.

### Opção 1 — Migration controlada

Descrição: criar profiles reais por uma migration versionada, com dados mínimos e previamente aprovados.

Prós:

- gera diff revisável antes de aplicar;
- mantém histórico explícito do que foi criado;
- permite repetir o mesmo procedimento em outro ambiente;
- força uma etapa formal de aprovação antes de mexer no banco.

Contras:

- nomes e e-mails reais podem ficar no histórico do Git;
- não é ideal para alterações frequentes de equipe;
- rollback exige nova migration ou SQL aprovado;
- pode incentivar misturar schema e dados pessoais no mesmo fluxo.

Riscos:

- inserir role, loja ou e-mail errado em produção;
- aplicar a migration junto com outra mudança não relacionada;
- versionar dado pessoal antes da aprovação final;
- criar profiles antes dos usuários correspondentes existirem no Supabase Auth.

Quando usar:

- quando a lista for pequena, estável e totalmente aprovada;
- quando Rodrigo quiser revisão por arquivo/diff antes da aplicação;
- quando a prioridade for rastreabilidade sobre conveniência operacional.

Quando evitar:

- enquanto e-mails estiverem pendentes;
- se houver dúvida sobre roles, admins ou escopo de loja;
- se a equipe ainda estiver mudando rapidamente;
- se o repositório não puder receber nomes/e-mails reais.

### Opção 2 — Script administrativo temporário

Descrição: criar profiles por um script local controlado, executado uma única vez contra o ambiente correto, após revisão e aprovação.

Prós:

- evita colocar dados reais permanentes em migration;
- pode validar entradas antes de inserir;
- pode ser descartado ou mantido fora do repositório depois da execução;
- funciona bem para poucos usuários e operação pequena.

Contras:

- depende de cuidado manual na execução;
- pode ser rodado contra projeto errado se o ambiente estiver mal configurado;
- exige disciplina para não deixar secrets no código;
- logs e evidências precisam ser documentados separadamente.

Riscos:

- vazar `service_role` ou credenciais se forem versionadas;
- executar duas vezes e tentar duplicar profiles;
- divergir das constraints reais do banco;
- criar profiles sem usuário Auth correspondente.

Cuidados com credenciais:

- nunca versionar secrets;
- nunca colocar `SUPABASE_SERVICE_ROLE_KEY`, senha do banco ou tokens no arquivo;
- carregar credenciais apenas de ambiente local seguro;
- confirmar projeto alvo antes de qualquer execução;
- registrar resultado sem expor secrets.

Necessidade de não versionar secrets:

- se o script for versionado, ele deve conter apenas lógica e validações;
- valores sensíveis devem ficar fora do repositório;
- dados reais só devem entrar após aprovação explícita e com plano de descarte ou auditoria.

### Opção 3 — Edge Function administrativa segura

Descrição: criar profiles por uma Edge Function administrativa, protegida por autenticação forte, validações e auditoria.

Prós:

- centraliza validações no backend;
- reduz necessidade de acesso direto ao banco;
- pode registrar auditoria de quem criou ou alterou profiles;
- prepara uma base mais próxima do modelo operacional futuro.

Contras:

- exige desenho de segurança mais completo;
- exige deploy de Edge Function;
- exige secrets e políticas muito bem controladas;
- é mais complexo que a necessidade inicial de poucos usuários.

Riscos:

- expor endpoint administrativo indevidamente;
- falha de autorização permitir criação ou alteração indevida de profiles;
- usar service role de forma ampla demais;
- criar dependência de backend antes do login/Auth estar maduro.

Necessidade de autenticação forte:

- a função não deve aceitar chamada anônima;
- deve validar o usuário autenticado e sua permissão administrativa;
- deve recusar criação por usuários sem autorização explícita;
- não deve confiar apenas em dados enviados pelo frontend.

Necessidade de auditoria:

- registrar quem solicitou a criação;
- registrar quem foi criado;
- registrar role, store, data e resultado;
- registrar erro sem expor secrets.

### Opção 4 — Painel administrativo futuro

Descrição: criar profiles por uma UI administrativa no ERP, com fluxo de confirmação, validação e auditoria.

Prós:

- melhor experiência operacional no longo prazo;
- reduz dependência de Rodrigo/Codex para mudanças simples;
- permite confirmações visuais e histórico de alterações;
- pode integrar criação, bloqueio e revisão de permissões.

Contras:

- exige login real funcionando com segurança;
- exige autorização de admin bem definida;
- exige RLS/policies revisadas;
- aumenta a superfície de risco se vier cedo demais.

Riscos:

- painel permitir criação de admin indevido;
- UI esconder erro de role/store e gravar dado perigoso;
- confundir `app_users` atual com `app_profiles` futuro;
- liberar gestão de permissões antes de o banco estar protegido.

Por que não deve vir antes do login/Auth/RLS estar bem resolvido:

- um painel administrativo só é seguro se o sistema souber com confiança quem está logado;
- o login atual ainda usa `app_users`/PIN/localStorage e não deve ser migrado nesta etapa;
- antes de UI administrativa, é preciso consolidar Supabase Auth, policies, auditoria e critérios de admin;
- criar painel cedo adiciona complexidade sem resolver as pendências de matriz e e-mail.

## Recomendação inicial

A estratégia mais prudente para a Pane & Salute neste momento é:

1. Não inserir profiles ainda.
2. Fechar matriz e e-mails.
3. Criar usuários Supabase Auth em etapa separada.
4. Criar profiles apenas para pessoas com e-mail confirmado.
5. Usar primeiro uma estratégia controlada e revisável.
6. Só depois pensar em painel administrativo.

Justificativa:

- a operação é pequena e tem poucos usuários;
- caixa e tempo são limitados;
- mexer no login atual agora aumenta risco operacional;
- `app_profiles` ainda não é usado pelo app;
- ainda existem e-mails pendentes;
- ainda há decisões abertas sobre Elis, Atendimento EX, Marselle e admins;
- auditabilidade é mais importante do que velocidade nesta etapa.

Caminho provável recomendado para uma tarefa futura:

1. Aprovar a matriz final em documentação.
2. Confirmar todos os e-mails.
3. Criar usuários Supabase Auth em uma tarefa separada, sem alterar login.
4. Validar IDs dos usuários criados.
5. Criar profiles por um método controlado, pequeno e revisável.
6. Documentar resultado, rollback conceitual e validações.

Entre as opções, a escolha inicial provável deve ser uma migration controlada ou um script administrativo temporário, dependendo da decisão sobre versionar nomes/e-mails reais. Edge Function e painel administrativo devem ficar para depois da fundação de Auth/RLS e da migração planejada de login.

## Ponto de parada obrigatório

O Codex deve parar antes de qualquer ação que:

- crie usuário no Supabase Auth;
- insira profile;
- execute SQL;
- aplique migration;
- altere login;
- altere `app_users`;
- altere `src/`;
- use Supabase MCP;
- leia ou altere secrets.

Só prosseguir com aprovação explícita do Rodrigo em tarefa futura.

## Escopo permitido nesta tarefa

Pode:

- criar ou editar documentação em `docs/`;
- comparar estratégias futuras;
- registrar riscos e pontos de parada;
- atualizar `docs/codex-tasks/README.md`;
- rodar validações locais de documentação.

Não pode:

- executar Supabase MCP;
- executar SQL;
- executar `supabase db push`;
- executar `supabase migration up`;
- executar `psql`;
- alterar `.env`;
- alterar `src/`;
- alterar migrations;
- alterar `app_users`;
- inserir dados em `app_profiles`;
- criar usuários no Supabase Auth;
- fazer commit sem autorização.

## Validação local

Como esta tarefa é apenas documentação, rodar no mínimo:

```bash
git diff --check
git status -sb
git diff --stat
```

Não rodar Supabase MCP, SQL, `supabase db push`, `supabase migration up` ou `psql`.

## Entrega esperada

Ao final, mostrar:

- arquivos criados;
- arquivos alterados;
- `git status -sb`;
- `git diff --stat`;
- confirmação de que nenhuma ação remota foi executada;
- confirmação de que nenhum dado real foi inserido;
- confirmação de que nenhum usuário foi criado.

Não fazer commit sem autorização.
