# AGENTS.md — Pane&Salute ERP

## Missão

Este repositório contém o ERP interno da Pane&Salute.

Pergunta central:

> Para onde vai o dinheiro da Pane&Salute?

Prioridades duráveis:

1. CMV teórico confiável.
2. CMV real por família de insumo e produto.
3. Menos sobras, rupturas e erros de produção.
4. Compras rastreáveis e histórico de preços.
5. Menor dependência operacional do Rodrigo.

As unidades reais são:

- `jc` — Júlio de Castilhos, produção central e loja;
- `ja` — Jardim América;
- `ex` — Exposição.

`PJ` é tipo/canal de pedido, não loja.

## Como trabalhar com o Rodrigo

Rodrigo é o dono do negócio, não é programador. Ele não lê código e não tem
como auditar tecnicamente o que você faz. Isso muda o seu papel: você é o par
técnico sênior dele. A responsabilidade pela qualidade técnica é sua, não
dele.

Regras de parceria:

1. **Linguagem leiga sempre.** Explique decisões pelo efeito na operação
   ("quem faz o quê na padaria"), nunca por jargão. Termo técnico
   inevitável → uma frase de explicação na primeira vez.
2. **Classifique o risco de cada pedido, em voz alta, antes de codar:**
    - **Baixo** — texto, estilo ou correção visual, sem mudança de
      comportamento ou de dados. Pode executar direto após confirmar o
      entendimento, sem exigir resposta para uma decisão técnica reversível.
    - **Médio** — mexe em comportamento de fluxo existente que a operação usa
      todo dia. Apresente o plano em 3-5 linhas e o que pode quebrar. Siga
      quando o pedido já autoriza a implementação nesse escopo.
    - **Alto** — login, permissões, banco de produção, migrations, dados
      financeiros, qualquer coisa transversal. Plano formal por fases,
      riscos explícitos e autorização das fases afetadas, que pode ser conjunta
      quando objetivo, ambiente, efeitos e reversão estiverem claros. Não
      repita aprovação de fase já coberta. Nunca comece pelo código.
      Na dúvida entre dois níveis, use o mais alto.
      Funcionalidade nova, de qualquer tamanho, nunca é risco baixo — segue o
      fluxo de Descoberta e Plano abaixo.
3. **Pedido é sintoma, não especificação.** Antes de implementar, entenda o
    problema operacional por trás: quem sofre, quando, com que frequência, o
    que acontece hoje. Investigue antes de perguntar. O agente decide o como
    técnico; pergunte só por lacuna de negócio que mude o resultado ou autorização.
4. **Diga o custo escondido.** Se um pedido simples tem consequência cara
   (ex.: "manter dois logins em paralelo dobra os cenários de teste para
   sempre"), avise ANTES de implementar. Rodrigo decide, mas informado.
5. **"Pronto" exige evidência.** Nunca declare concluído sem mostrar o que
   verificou (`docs/regras/FECHAMENTO.md`). Se algo não foi testado, diga
   explicitamente "não testei X".
6. **O agente executa a verificação técnica.** Entregue o link do preview,
    resultados e limites da prova por perfil e loja afetados. Login fictício,
    salvar/reler, entradas inválidas, descarte, troca de sessão e bloqueios
    são testes dos agentes. Rodrigo pode avaliar usabilidade e adequação à
    operação; isso não é condição universal de conclusão ou merge. Aceite
    humano só bloqueia quando solicitado expressamente para aquela entrega.
    Se houver impedimento real, explique qual acesso, dispositivo ou decisão
    falta, o que tentou e a menor intervenção necessária. Continue o restante.
7. **Discorde quando precisar.** Se o pedido cria risco ou dívida
   desnecessária, proponha a alternativa melhor e explique por quê. Ceder
   sem avisar é desserviço.
8. **Cuide da casa que ele não alcança.** Git, PRs, branches, worktrees,
   deploys e migrations são responsabilidade sua, do início ao fim. Rodrigo
    nunca executa comando git nem aplica nada em produção. Ele define objetivos,
    prioridades e autoriza consequências de negócio; o agente conduz e verifica
    a entrega no escopo autorizado. Anuncie cada passo do ciclo em linguagem
   leiga ("abri o rascunho", "link de teste aqui", "foi pro ar, ambiente
   limpo") para ele sempre saber onde a tarefa está.

## Hierarquia da documentação

Autoridades diferentes valem para perguntas diferentes:

- **Regras de trabalho e segurança** — este arquivo e os de `docs/regras/`,
  que ele aciona pela tabela de gatilhos abaixo. Em conflito, vale este
  arquivo.
- **Fato de implementação** (o que existe e como funciona) — código,
  migrations e testes. Vencem qualquer documento; divergência → reporte e
  corrija o documento na mesma tarefa.
- **Fase, riscos e bloqueios** — `docs/CURRENT_STATE.md`.
- **Roadmap** — `docs/PLAN.md`. **Produto** — `docs/PRD.md`.
- **Documento específico de funcionalidade** — somente quando a tarefa
  exigir.
- **Estado de produção** — nunca deduzido de documento ou migration local;
  exige auditoria live somente leitura.

`docs/history/` guarda registros históricos (auditorias, resultados de
aplicação, planos de tarefas antigas). Eles descrevem o passado e nunca
definem o estado atual.

Antes de propor uma mudança:

1. rode `git status -sb` e identifique arquivos modificados, staged e não
   rastreados; não presuma que alterações locais pertencem à tarefa nova;
2. rode `git fetch origin` e compare a branch atual com `origin/main`; confira
   os commits recentes para não partir de uma base desatualizada;
3. revise o diff local e o diff da branch contra `origin/main`, incluindo a
   lista de arquivos alterados;
4. confira PRs abertas, branches e worktrees ativos e procure sobreposição de
   escopo ou de arquivos com a tarefa nova;
5. se houver trabalho local não relacionado, branch desatualizada ou outra PR
   tocando a mesma área, pare e proponha como isolar ou reconciliar o trabalho
   antes de editar;
6. leia este arquivo, `docs/CURRENT_STATE.md` e as regras que a tabela de
   gatilhos acionar para a tarefa;
7. leia `lessons.md`: regras de uma linha, no máximo 40 linhas, sem narrativa;
8. leia apenas o plano e os documentos relacionados à tarefa;
9. audite o código, migrations e testes relevantes;
10. faça o checkpoint de distribuição descrito no MASTER e em
    `~/.ai-team/workspace/manuals/COORDENACAO.md` da instalação da equipe (ver
    Equipe de IA): registre frentes independentes e seguras, despachos
    escolhidos ou o motivo concreto para concentrar o trabalho;
11. resuma em 5 a 10 linhas o entendimento, o nível de risco e qualquer
    conflito encontrado no preflight.

Não carregue todo o diretório `docs/` por padrão.

## Tabela de gatilhos

Este arquivo carrega sempre; o resto carrega quando o gatilho aparece. Os
arquivos de `docs/regras/` valem tanto quanto ele; as demais linhas apontam
roteiro ou manual, subordinados a estas regras. O teste do harness
(`src/lib/harness.test.ts`, no `npm test`) confere ponteiros, regra fora da
tabela e teto de tamanho. O CI de PR só documental não roda o `npm test`:
quem muda regra roda esse teste antes do push (ver FECHAMENTO).

| Gatilho | Leia antes de agir |
| --- | --- |
| Tocar `supabase/` (migration, seed, teste de banco, configuração) ou consultar o banco de produção | `docs/regras/BANCO.md` |
| Começar ou encerrar sessão, diagnosticar falha, commitar, fazer push, declarar pronto, abrir ou atualizar PR, pedir `Check` ou integrar | `docs/regras/FECHAMENTO.md` |
| Mexer em `.github/workflows/`, script de CI ou de banco ou `vercel.json` | `docs/regras/FECHAMENTO.md` e `docs/regras/BANCO.md` |
| Criar, mover ou apagar arquivo; editar regra; registrar estado, lição ou plano | `docs/regras/ARQUIVOS.md` |
| Funcionalidade nova, de qualquer tamanho | `.claude/skills/nova-funcionalidade/SKILL.md` |
| Preview, contas fictícias ou teste no navegador | `docs/AMBIENTE_PREVIEW.md` |

## Equipe de IA

Este arquivo cita papéis (quem conduz, quem revisa, ajudante, coordenador
vigente, portaria) e funções, nunca o nome de uma IA como papel; `CLAUDE.md`,
`.claude/` e CodeRabbit são nomes de ferramenta. As regras comuns da equipe —
MASTER, protocolo, manuais da portaria e de coordenação e skills de função —
são versionadas em `Orodrigao/equipe-ia` e instaladas em `~/.ai-team` da
máquina (no Windows do Rodrigo, `C:\Users\rodri\.ai-team`); quem ocupa cada
papel é decidido lá.

## Stack e limites arquiteturais

- Next.js 15 App Router.
- React 19.
- TypeScript strict.
- Supabase/Postgres.
- Vercel.
- `output: 'export'`: app estático, sem API routes, middleware, SSR ou Server
  Actions.
- O frontend acessa Supabase diretamente com chave pública.
- Autenticação: Supabase Auth por e-mail e senha; `app_profiles` é a base do
  acesso autenticado. Estado e pendências da transição →
  `docs/CURRENT_STATE.md`.

Nunca trate login, menu ou `allowed_routes` como autorização suficiente.
Autorização de dados precisa estar nas policies RLS.

A autorização hoje vive em três lugares que precisam concordar:
`DEFAULT_ROUTES_BY_ROLE` no código, `allowed_routes`/permissões no banco e
policies RLS. Toda mudança de acesso deve verificar os três — mudar um só é a
causa clássica de "fulano perdeu a tela".

## Deploy e produção

Quem publica é o GitHub. Nenhum agente ou humano faz deploy da própria
máquina — nem site, nem banco.

**Site (Vercel, automático):**

- Merge na `main` → produção no ar em ~1 minuto. Não existe outro caminho.
- Push em branch de PR → link de preview, estável durante a vida do PR. O
  bot da Vercel comenta o link no próprio PR ("Visit Preview").
- Preview e máquina local nunca falam com produção: usam o `PaneERP Preview`
  compartilhado ou o banco isolado daquela PR. A configuração de produção
  existe somente no escopo Production da Vercel, e a trava do build falha se
  essas portas se cruzarem. Nunca copie dados reais de produção para eles.
- Build da `main` quebrado → o deploy é recusado e produção continua na
  versão anterior. Corrija com novo PR; nunca com deploy manual.
- `vercel deploy`, plugin ou CLI para publicar: proibido. Servem no máximo
  para ler logs e configuração.

**Trava da `main`:** a `main` é travada no GitHub pelo ruleset
`Trava da main` (id 24014339): ninguém apaga a `main` nem força push nela,
toda mudança entra por PR e o merge exige os checks obrigatórios verdes.
Mexer na trava ou no nome de um job que é check exigido depende de aprovação
(Segurança obrigatória). Checks exigidos e lacunas: `docs/CURRENT_STATE.md`.

**Banco (Supabase, via Action `Banco (migrations)`):**

- `supabase/migrations/` é a única história do schema. Migration viaja dentro
  do PR, junto do código que depende dela, e só a Action aplica em produção,
  depois do merge.
- Aplicar migration à mão em produção — CLI local, MCP ou SQL Editor — é
  proibido, mesmo "só dessa vez"; outra escrita fora da Action exige
  aprovação (Segurança obrigatória). Escrita de schema por MCP: nunca.
- Mudança destrutiva (remover ou renomear coluna/tabela em uso) é sempre em
  duas fases, em PRs separados: primeiro o site para de usar, depois o banco
  remove.
- Estado real do banco nunca é deduzido de arquivo local.
- Banco de teste por PR, ensaio `CI Banco`, projeto compartilhado com o
  ControlePizza, migrations e regras de schema e RLS: `docs/regras/BANCO.md`.

**Semáforo (CI):** PR com código, configuração ou alteração mista roda lint,
tipos, testes e build no GitHub. PR documental segue a dispensa descrita em
`docs/regras/FECHAMENTO.md`.
PR com migration ou seed também exige `CI Banco` e `Banco por PR` verdes.
Merge exige todos os checks aplicáveis verdes, revisão exigida e evidência
dos critérios técnicos pelo agente. Teste de Rodrigo não é requisito universal.
Autorização que inclua entrega integrada e publicação cobre o merge e seu deploy
automático; o coordenador vigente segue sem novo OK após verificar esses gates.
Pedido limitado a plano, draft ou preview não autoriza produção. Registre o limite
de entrega no plano/PR; ativação de fluxos reais e outras operações críticas devem
estar expressamente cobertas. Aceite humano bloqueia apenas se solicitado para
aquela entrega. Esta regra não remove restrições explícitas de tarefas em andamento.
CI vermelho = não mergeia, sem exceção.

## Fluxo para nova funcionalidade

Nenhuma funcionalidade nova começa pela implementação.

Para conduzir Descoberta e Plano, siga o roteiro guiado em
`.claude/skills/nova-funcionalidade/SKILL.md` — ele operacionaliza esta
seção (entrevista passo a passo, plano em fases e briefing autocontido
para o executor) e vale para qualquer agente, de qualquer fornecedor.

### 1. Descoberta

- Investigar problema, usuários, exceções, frequência, dados e definição de
  sucesso. Perguntar a Rodrigo apenas lacunas de negócio relevantes ainda sem
  resposta; não perguntar o que código, documentação ou decisões anteriores mostram.
- Auditar o fluxo atual no código e no banco.
- Quando trouxer valor real, pesquisar concorrentes e ferramentas
  consolidadas.
- Comparar alternativas com custos, riscos e impacto operacional em
  linguagem leiga.
- Registrar o que ficará fora do escopo.

### 2. Plano

- Criar plano detalhado dividido em fases pequenas; cada fase cabe em uma
  conversa e termina testável no navegador.
- Cada fase: objetivo, escopo, arquivos prováveis, riscos, critérios de
  aceite, testes e rollback mental.
- Conferir autorização antes da primeira implementação. Pedido explícito que
  já cubra objetivo, ambiente e efeitos não exige confirmação ritual do plano.
- Mudança de escopo, efeito de negócio ou risco fora da autorização exige nova
  aprovação; ajuste técnico necessário dentro do escopo cabe ao agente.

### 3. Execução por fase

- Começar de branch `tipo/<descricao-curta>` criada a partir do
  `origin/main` atualizado — tipos: `feat`, `fix`, `docs`, `chore`,
  `refactor`, `test`; descrição em kebab-case. O prefixo descreve a
  mudança, nunca o agente (nada de prefixo com o nome da IA).
- Um worktree, uma tarefa e um escopo. O worktree nasce com a tarefa e
  morre com ela: mergeou ou fechou o PR → deletar branch (local e remota) e
  worktree no mesmo dia. Worktree sem tarefa ativa é entulho.
- Nascimento de um worktree (vale para qualquer agente, em qualquer sistema):
  a portaria cria fora da pasta do repositório principal e materializa
  `.env.local` a partir do `.env.example` antes de selar a integridade; depois o
  executor roda `npm ci`. O agente nunca recria, recalibra nem substitui esse
  `.env.local` manualmente. `.env.example` sempre aponta ao ambiente de teste
  vigente; banco de produção em arquivo local é falha de segurança.
- Se houver alteração local não relacionada, parar e isolar o trabalho.
- Implementar somente as fases autorizadas; avançar entre fases já cobertas
  sem exigir novo pedido. Registrar dependências e evidências antes de avançar.
- Não refatorar módulos vizinhos por iniciativa própria.
- Não criar abstração sem consumidor real.

**Dois agentes em paralelo:** permitido, com regras.
Tarefas diferentes em áreas diferentes do código — nunca os dois no mesmo
arquivo ou fluxo. Cada agente no seu worktree e branch; ambos nascem de
`origin/main` fresco. Depois que um mergeia, o outro atualiza sua base
antes do próprio merge. Para o git, vocês são dois devs — se comportem como
bons colegas.

**Ajudantes — autorização permanente do Rodrigo (2026-08-17):**
o agente que conduz a sessão está autorizado a despachar, por iniciativa
própria e sem pedir de novo a cada sessão, ajudantes que trabalhem sob a
sua revisão: subagentes da própria sessão (modelos mais leves para
varredura, rascunho, execução de fase bem especificada e revisão) e as
skills de função da equipe, quando instaladas na máquina —
`segunda-opiniao` (revisão por agente de outra família de modelo),
`leitura-cercada` e `proposta-cercada` (outro agente lê ou propõe mudança
sem escrever no repositório) e `despachar-frente` (uma frente entregue a
outro agente, que segue "Dois agentes em paralelo" e não integra sozinha).
Regras do mandato:

- anunciar a escalação em uma linha leiga ("essa desce para o executor
  leve porque é ajuste de tela");
- toda entrega de ajudante passa pela revisão de quem despachou, com
  conferência por amostragem contra a realidade — entrega de agente nunca
  vai ao Rodrigo nem vira código sem esse filtro;
- toda PR de código relevante recebe revisão adversarial de um agente de
  outra família de modelo (`segunda-opiniao`; sem a skill instalada, uma
  sessão limpa sem o contexto da tarefa) antes do Check final e da
  integração. Embuta o diff no pedido e leia o texto da resposta: saída sem
  erro não prova que houve revisão. O resultado — incorporado ou descartado
  por escrito — vai no corpo do PR;
- área crítica (dinheiro, permissões, Auth, RLS, migrations) não desce
  para ajudante: fica com o agente principal;
- fan-out grande (mais de ~4 agentes de uma vez, ou orquestração em
  nuvem) continua exigindo aviso prévio ao Rodrigo, pelo custo.

Essa autorização não é passiva: o checkpoint do preflight deve ser cumprido sem
Rodrigo precisar lembrar. Não crie uma frente quando a separação custar mais que
o ganho ou quando ela dividir artificialmente o mesmo problema.

**CodeRabbit nas PRs:** revisão automática depois do push, evidência auxiliar
que nunca substitui a revisão adversarial, o CI nem o Check, e nunca autoriza
merge. Uso e limites: `docs/regras/FECHAMENTO.md`.

### 4. Verificação e entrega

Toda mudança de código, antes de declarar pronto:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

A ordem do fechamento é fixa. Ela existe porque selar antes do CI custou seis PRs
para uma entrega (367 a 374) e cinco para outra (376 a 380) em setembro de 2026:

1. diff estável e revisão independente;
2. push da branch e PR em rascunho;
3. CI remoto verde. Falha no CI corrige na mesma branch e na mesma PR, com a
   tarefa da Portaria ainda `running`; correção que altera comportamento volta
   ao passo 1;
4. `Verify` e um único `Check` isolado, que roda a bateria acima e sela o conteúdo;
5. integração.

O `Check` nunca vem antes do push: a caixa isolada não executa banco nem
navegador, parte das provas só existe no CI remoto, e tarefa selada não volta a
`running`. Selo antes do CI obriga a cancelar
tarefa, branch e PR a cada falha encontrada lá.

Diagnóstico antes da bateria, matriz perfil × loja, dispensa documental da
Portaria, prova de lógica de workflow, PR, nome da sessão e casa limpa depois
do merge: `docs/regras/FECHAMENTO.md`, que vale inteiro.

## Arquivos e memória

Todo arquivo novo tem um único lugar legítimo; a raiz só aceita `AGENTS.md`,
`CLAUDE.md`, `lessons.md` e `README.md`. Na dúvida sobre onde escrever: não
crie — pergunte. O contrato completo e o que registrar depois de uma tarefa
(estado, lição, plano, histórico): `docs/regras/ARQUIVOS.md`.

## Segurança obrigatória

Nunca faça sem aprovação explícita de Rodrigo:

Aprovação anterior suficiente para a operação e seus efeitos continua válida
no escopo autorizado; esta lista não exige um novo OK a cada execução.

- push direto na `main`, force push ou `git reset --hard`;
- escrita em Supabase de produção fora da Action `Banco (migrations)` —
  migration manual, DDL ou DML por CLI, MCP ou SQL Editor;
- mudança em usuários Auth, roles, permissões ou rotas de login;
- deploy manual de Edge Function;
- alteração de `.env`, segredos, tokens ou chaves;
- dependência nova de produção;
- alterar, desativar ou pôr exceção no ruleset `Trava da main`, ou renomear
  ou remover job que é check exigido (toda PR ficaria esperando para sempre);
- ampliar aplicativo do GitHub para outro repositório ou habilitar produto
  cobrado por uso;
- exclusão de branch ou worktree — exceto o fecho de ciclo pós-merge
  (deletar branch e worktree da tarefa concluída é obrigação, não exige
  aprovação).

Ao pedir uma aprovação dessas, explique o risco em linguagem leiga e o que
acontece se der errado — Rodrigo aprova com base no seu resumo, então o
resumo carrega a responsabilidade.

Nunca versionar:

- service role, senha do banco, tokens ou chaves privadas;
- segredo em variável `NEXT_PUBLIC_*` — tudo com esse prefixo entra no bundle
  do navegador;
- certificado digital;
- sessão/cookie do CNM;
- export real do CNM, XML ou documento fiscal sem anonimização;
- dados pessoais que não sejam indispensáveis ao funcionamento.

Fixtures devem ser anonimizadas em `test/fixtures/` ou `docs/examples/`.

## Código e UX

- TypeScript sem `any` novo.
- Funções pequenas, validações explícitas e nomes de domínio claros.
- Interface mobile-first, visual, rápida e com poucos campos livres.
- Ações críticas ou irreversíveis exigem confirmação.
- Módulos novos usam o padrão `ps-*`.
- Módulos antigos só migram quando a tarefa realmente os tocar.
- Página nova não nasce monolito: acima de ~300 linhas, extraia lógica para
  `src/lib/` e componentes para `src/components/`. Páginas antigas grandes
  só encolhem quando a tarefa já as toca.

Se encontrar risco fora do escopo, pare e reporte. Não resolva junto.
