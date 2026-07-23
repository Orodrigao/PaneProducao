---
name: nova-funcionalidade
description: Guiar o Rodrigo do desejo bruto ao plano aprovado e ao briefing de execução para qualquer funcionalidade nova do PaneERP. Usar SEMPRE que o Rodrigo pedir algo novo no sistema — "quero uma tela para...", "dá pra fazer...", "seria bom ter...", "quero automatizar...", novo relatório, novo fluxo, campo novo que muda comportamento — mesmo que o pedido pareça pequeno e mesmo que ele não fale em "planejar". Também quando, no meio de outra conversa, um pedido de ajuste se revelar funcionalidade nova.
---

# Nova funcionalidade — do desejo ao briefing

Esta skill transforma um pedido bruto do Rodrigo em três coisas, nesta
ordem: entendimento fechado do problema, plano em fases aprovado por ele
e briefing autocontido para o agente executor. Ela operacionaliza o fluxo
"Descoberta → Plano" do AGENTS.md — as regras de lá continuam valendo;
aqui está o roteiro de como percorrê-las.

Lembrete de risco: funcionalidade nova nunca é risco baixo. Diga o nível
(médio ou alto) em voz alta logo no início, e por quê. Risco alto muda o
jogo: aprovação passa a ser fase a fase, nunca só do plano geral.

## Etapa 0 — Checagem de conflitos (imediata)

Antes de qualquer pergunta: `git status -sb`, `git fetch origin`, PRs
abertas, branches e worktrees ativos, `docs/CURRENT_STATE.md`,
`lessons.md`. Procure sobreposição com trabalho em andamento; se houver,
pare e proponha como isolar antes da descoberta.

O preflight completo do AGENTS.md (os 10 passos da seção "Hierarquia da
documentação", incluindo diffs, commits recentes e auditoria de código,
migrations e testes) deve estar concluído antes de apresentar qualquer
solução ou plano — mas a auditoria profunda pode esperar as primeiras
respostas da descoberta, porque um pedido vago ainda não diz onde olhar.

**Coordene com o outro agente.** No PaneERP, Claude e Codex (Sol)
trabalham em paralelo, e o AGENTS.md proíbe os dois de tocar o mesmo
fluxo — sobreposição de área, não só de arquivo. As branches `codex/*`,
os worktrees e as PRs abertas mostram onde o outro está mexendo agora,
mas o git só revela o presente: as próximas fases planejadas do outro
agente não estão em lugar nenhum que você possa ler. Por isso, pergunte
ao Rodrigo se há trabalho paralelo em andamento e qual área ele cobre,
antes de recomendar por onde começar. Isso muda a ordem das fases, não
só o isolamento da branch: uma fase que mexe na área do outro agente
espera ele terminar. (Nesta skill isso já mordeu uma vez — uma sequência
recomendada colidiu com a frente de segurança do Sol sobre custos, e só
não virou retrabalho porque o Rodrigo avisou a tempo.)

## Etapa 1 — Descoberta

O pedido é sintoma, não especificação. O objetivo desta etapa é você
conseguir contar a história completa do fluxo — quem faz o quê, quando,
com que dado, o que dá errado hoje — sem inventar nenhum pedaço.
Enquanto houver pedaço inventado, há pergunta a fazer.

**Formato das perguntas:** uma por vez. Quando houver alternativas
claras, use AskUserQuestion com opções clicáveis (Rodrigo responde do
celular); quando a resposta for aberta, pergunte em texto livre no chat.
Linguagem leiga, cenário concreto da padaria.

**Comece sempre pelo caso real:** "Me conta a última vez que isso fez
falta — o que aconteceu?" O caso concreto ancora todas as perguntas
seguintes e evita discussão abstrata.

**Entenda primeiro o caminho normal, depois as exceções.** Exceção só
entra na conversa se puder mudar a solução, e uma de cada vez — despejar
"feriado, férias, falta de produto, internet" de uma vez vira
questionário cansativo.

**O que precisa estar respondido antes de fechar** — pule o que o pedido
já respondeu, aprofunde onde houver contradição:

- Que dor existe hoje? Quem sofre, em qual loja (jc/ja/ex), quando e
  com que frequência?
- Como isso é resolvido hoje — papel, WhatsApp, planilha, memória de
  alguém?
- O que custa não fazer nada? (dinheiro, tempo, erro, dependência do
  Rodrigo)
- Quem vai usar o fluxo novo, em que aparelho e em que momento do dia?
- Sobre os dados, pergunte em termos operacionais, nunca abstratos:
  o que a pessoa precisa enxergar na tela? O que ela preenche? Quem
  fica sabendo dessa informação primeiro?
- Permissões e erro (quase sempre mudam banco, policies e testes):
  quem pode ver, criar, corrigir e cancelar? Quem NÃO pode acessar?
  O que acontece quando alguém erra um lançamento? Registros antigos
  também entram? Qual o volume por dia ou semana?
- Como saberemos que resolveu? (sucesso observável na operação)
- O que fica explicitamente FORA do escopo — registre, é o que protege
  o plano de inchar.

**Em paralelo, audite você mesmo:** leia as telas, tabelas, policies e
migrations do fluxo atual. Nunca pergunte ao Rodrigo o que o código faz —
vá ler. A pergunta boa nasce da auditoria ("hoje o fechamento grava X;
o que você quer aparece antes ou depois disso?"). Se a funcionalidade já
existir parcialmente, mostre o que existe antes de propor construir.

**Quando trouxer valor real**, pesquise como ferramentas consolidadas
resolvem o mesmo problema e traga a comparação em linguagem leiga.

**Custo escondido:** se o pedido simples tiver consequência cara, diga
ANTES de o plano fechar. Se a descoberta revelar que o problema real é
outro, diga isso claramente e proponha o caminho melhor — ceder sem
avisar é desserviço.

## Etapa 2 — Plano

Primeiro, feche o entendimento: resuma em 5–10 linhas leigas o problema,
quem é afetado, o nível de risco e o que ficou fora do escopo. Peça
confirmação do Rodrigo.

Depois, quando existirem alternativas reais, apresente-as antes do plano
detalhado — tipicamente "não fazer nada", "solução mínima" e "solução
completa" — cada uma com custo, risco e efeito na operação, em linguagem
leiga. Rodrigo escolhe informado; só então detalhe o plano do caminho
escolhido.

O plano segue o AGENTS.md: fases pequenas, cada uma cabe numa conversa e
termina testável no navegador. Para cada fase:

- objetivo em uma frase leiga;
- escopo (o que entra e o que NÃO entra);
- arquivos e tabelas prováveis, com caminhos reais vindos da auditoria;
- dependências de fases anteriores, de bloqueios conhecidos e da área
  coberta pelo outro agente (uma fase espera o outro liberar a área);
- riscos e o que pode quebrar;
- critérios de aceite;
- testes: a matriz perfil × loja afetada, nunca só admin; mudança de
  permissão ou RLS exige testar um perfil que deve conseguir E um que
  deve ser bloqueado;
- recuperação se der errado — lembrando que migration mergeada não se
  desfaz nem se edita: recuperação de banco é sempre migration nova.

Apresente o plano em linguagem leiga primeiro; o detalhe técnico vem
depois, como apoio. Risco médio: aprovação do plano libera a execução.
Risco alto: cada fase precisa da própria aprovação antes de começar.
Mudança relevante de direção depois de aprovado exige nova aprovação.

## Etapa 3 — Briefing de execução

Com o plano aprovado, gere o briefing da fase 1 (e das seguintes quando
o Rodrigo pedir). O briefing é um bloco de texto no chat — nunca um
arquivo novo no repositório — e precisa ser autocontido: quem o recebe
não vê esta conversa nem a auditoria que você fez. Tudo que o executor
precisa saber vai no texto. Ele serve tanto para esta mesma sessão
executar quanto para colar numa sessão nova (Claude ou Sol/Codex).

Estrutura:

```
# Briefing — <funcionalidade>, fase <n>

## Contexto do negócio
<2–4 linhas: o problema operacional e quem sofre>

## Objetivo desta fase
<uma frase>

## Fluxo esperado
<passo a passo: pessoa → gatilho → ação → resultado, com as regras de
negócio e ao menos um exemplo concreto com números reais da operação>

## O que a auditoria encontrou
<comportamento atual, arquivos e tabelas consultados, divergências ou
dívidas encontradas no caminho>

## Decisões já tomadas
<lista com o porquê de cada uma. Não reabrir sem evidência nova; se o
código contradisser este briefing, pare e reporte — código vence
documento>

## Escopo
Entra: ...
NÃO entra: ...
Depende de: <fases anteriores ou bloqueios conhecidos>

## Permissões
<quem pode ver/criar/corrigir/cancelar e quem deve ser bloqueado —
cada linha desta seção vira um teste na matriz perfil × loja>

## Onde mexer
<arquivos, tabelas, policies, com caminhos reais>

## Riscos e cuidados
<incluindo lições do lessons.md que mordem nesta área; se houver
migration, RLS ou dado financeiro, listar aqui as exigências extras:
CI Banco e Banco Preview verdes, grants explícitos, teste com perfil
permitido E bloqueado>

## Estados da tela
<carregando, vazio, erro, sucesso e repetição de ação — o que o
usuário vê em cada um>

## Critérios de aceite
<lista verificável>

## Verificação
<comandos exatos em sequência (lint → tsc → test → build), matriz
perfil × loja, fluxo a testar no navegador e o roteiro de preview que
o Rodrigo executa no celular>

## Recuperação
<como voltar atrás com segurança se der errado; migration é só ida —
correção de banco é migration nova>

## Regras da casa
Siga o AGENTS.md do repositório. Branch tipo/<descricao-curta> a partir
de origin/main atualizado; PR sempre draft; nunca push na main.
```

O briefing traz decisões e critérios, não receita de código: o executor
decide o "como" técnico dentro das decisões já tomadas.

## Regras

- Esta skill termina no briefing. Implementação só começa depois do
  plano aprovado (fase a fase, se risco alto) e, se for na mesma
  conversa, seguindo o fluxo normal do AGENTS.md (branch, worktree,
  verificação, PR draft).
- Interrogatório não é o objetivo: pergunta boa é a que muda o plano.
  Se a resposta não mudaria nada, não pergunte.
- Se no meio da descoberta surgir risco fora do escopo (segurança, dado
  financeiro exposto), pare e reporte antes de continuar.
