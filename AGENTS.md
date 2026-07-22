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
      entendimento.
    - **Médio** — mexe em comportamento de fluxo existente que a operação usa
      todo dia. Apresente o plano em 3-5 linhas e o que pode quebrar. Espere
      o OK.
    - **Alto** — login, permissões, banco de produção, migrations, dados
      financeiros, qualquer coisa transversal. Plano formal por fases,
      riscos explícitos, aprovação por fase. Nunca comece pelo código.
      Na dúvida entre dois níveis, use o mais alto.
      Funcionalidade nova, de qualquer tamanho, nunca é risco baixo — segue o
      fluxo de Descoberta e Plano abaixo.
3. **Pedido é sintoma, não especificação.** Antes de implementar, entenda o
   problema operacional por trás: quem sofre, quando, com que frequência, o
   que acontece hoje. Faça perguntas até o cenário fechar. Rodrigo prefere
   responder perguntas a receber a feature errada.
4. **Diga o custo escondido.** Se um pedido simples tem consequência cara
   (ex.: "manter dois logins em paralelo dobra os cenários de teste para
   sempre"), avise ANTES de implementar. Rodrigo decide, mas informado.
5. **"Pronto" exige evidência.** Nunca declare concluído sem mostrar o que
   verificou (seção Verificação). Se algo não foi testado, diga
   explicitamente "não testei X".
6. **Entregue com roteiro de teste.** Toda entrega termina com um checklist
   que o Rodrigo executa no celular: passos concretos, por perfil e loja
   afetados ("entre como vendas na JA e confira se..."). Ele é o QA final —
   dê a ele o roteiro, nunca suponha que ele saberá o que conferir.
7. **Discorde quando precisar.** Se o pedido cria risco ou dívida
   desnecessária, proponha a alternativa melhor e explique por quê. Ceder
   sem avisar é desserviço.

## Hierarquia da documentação

Autoridades diferentes valem para perguntas diferentes:

- **Regras de trabalho e segurança** — este arquivo, e somente ele.
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
6. leia este arquivo e `docs/CURRENT_STATE.md`;
7. leia `lessons.md` — as lições registradas existem para a próxima sessão
   não repetir o erro; gravar sem ler não protege ninguém;
8. leia apenas o plano e os documentos relacionados à tarefa;
9. audite o código, migrations e testes relevantes;
10. resuma em 5 a 10 linhas o entendimento, o nível de risco e qualquer
    conflito encontrado no preflight.

Não carregue todo o diretório `docs/` por padrão.

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

## Fluxo para nova funcionalidade

Nenhuma funcionalidade nova começa pela implementação.

### 1. Descoberta

- Entrevistar Rodrigo: problema, usuários, exceções, frequência, dados e
  definição de sucesso. Encha-o de perguntas — uma por vez, concretas.
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
- Esperar aprovação explícita de Rodrigo antes da primeira implementação.
- Mudança relevante de direção exige nova aprovação.

### 3. Execução por fase

- Começar de branch `codex/<descricao-curta>` criada a partir do
  `origin/main` atualizado.
- Um worktree, uma tarefa e um escopo.
- Se houver alteração local não relacionada, parar e isolar o trabalho.
- Implementar somente a fase aprovada.
- Não refatorar módulos vizinhos por iniciativa própria.
- Não criar abstração sem consumidor real.

### 4. Verificação

Toda mudança de código, antes de declarar pronto:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Além disso:

- testar no navegador o fluxo completo alterado;
- testar a matriz afetada: cada perfil × cada loja que a mudança toca — não
  apenas admin. Mudança em permissão, rota ou dado compartilhado testa no
  mínimo um perfil restrito (vendas, expedição ou romaneio);
- revisar o diff como revisão de código;
- confirmar estados de carregamento, vazio, erro, sucesso e repetição de
  ação;
- não considerar concluído com teste quebrado — exceção única: falha
  comprovadamente pré-existente, reproduzida na `main`, reportada e sem
  relação com o diff; não a corrija junto (risco fora do escopo);
- mudança de Auth, permissão ou RLS só conta como verificada com ao menos um
  perfil que deve conseguir E um que deve ser bloqueado, ambos testados no
  navegador;
- listar para o Rodrigo o que foi verificado e o que ficou sem teste.

Mudança somente de documentação dispensa os comandos acima; exige no mínimo
`git diff --check`.

### 5. Entrega

- Commits pequenos e em português.
- Push somente da branch da tarefa.
- Pull request sempre draft, salvo pedido explícito em contrário.
- Nunca fazer push direto na `main`.
- Preencher todas as seções aplicáveis do template de PR; seção não
  aplicável recebe `N/A` com justificativa curta, nunca é apagada.
- Informar em linguagem leiga: o que mudou para a operação, arquivos
  alterados, verificações executadas e riscos restantes.
- Fechar com o roteiro de teste para o Rodrigo (regra 6 da parceria).

## Memória útil

Após uma tarefa bem-sucedida:

- atualize `docs/CURRENT_STATE.md` somente se fase, capacidade ou risco real
  mudou;
- registre em `lessons.md` somente aprendizado não óbvio, generalizável e
  capaz de evitar erro futuro — formato `data - slug - Trap/Rule`;
- altere `AGENTS.md` somente quando surgir uma regra global e durável —
  nunca estado, que envelhece e vira mapa errado;
- atualize `docs/PLAN.md` somente quando roadmap, ordem ou critério de
  pronto mudar;
- mova para `docs/history/` documentos de tarefa que perderam vigência.

Não guardar:

- narração da tarefa;
- informação óbvia ao ler o código;
- lista de arquivos alterados;
- estado temporário de branch;
- detalhe já preservado no PR ou commit;
- snapshot chamado de "estado atual" sem data e fonte;
- todo de entrega específica fora de `docs/history/` depois de concluída.

## Segurança obrigatória

Nunca faça sem aprovação explícita de Rodrigo:

- push direto na `main`, force push ou `git reset --hard`;
- escrita em Supabase de produção, incluindo migration, DDL ou DML;
- mudança em usuários Auth, roles, permissões ou rotas de login;
- deploy manual de Edge Function;
- alteração de `.env`, segredos, tokens ou chaves;
- dependência nova de produção;
- exclusão de branch ou worktree.

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

## Supabase

- Toda tabela em schema exposto deve ter RLS antes de receber dados.
- Grants da Data API e policies RLS são controles diferentes; migrations
  devem tratar ambos explicitamente.
- Não usar policy genérica permissiva para `anon` ou `authenticated`.
- Policies de escrita devem validar o perfil e o escopo da operação.
- `UPDATE` precisa de policy de leitura e de `WITH CHECK`.
- Função crítica precisa de validação de entrada, tratamento de erro e
  privilégio mínimo.
- `SECURITY DEFINER` exige revisão específica, `search_path` seguro e grants
  explícitos.
- Antes de nova informação financeira, concluir o hardening indicado em
  `docs/CURRENT_STATE.md`.
- Não deduza o estado de produção pelas migrations locais; tarefa de
  segurança compara migration, resultado documentado, código cliente e
  auditoria live somente leitura.

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
