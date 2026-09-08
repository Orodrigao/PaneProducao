---
name: nova-funcionalidade
description: Guiar o Rodrigo do desejo bruto ao plano aprovado e ao briefing de execução para qualquer funcionalidade nova do PaneERP. Usar SEMPRE que o Rodrigo pedir algo novo no sistema — "quero uma tela para...", "dá pra fazer...", "seria bom ter...", "quero automatizar...", novo relatório, novo fluxo, campo novo que muda comportamento — mesmo que o pedido pareça pequeno e mesmo que ele não fale em "planejar". Também quando, no meio de outra conversa, um pedido de ajuste se revelar funcionalidade nova.
---

# Nova funcionalidade — do desejo ao briefing

Esta skill transforma um pedido bruto do Rodrigo em três coisas, nesta
ordem: entendimento fechado do problema, plano em fases coberto pela autorização
e briefing autocontido para o agente executor. Ela operacionaliza o fluxo
"Descoberta → Plano" do AGENTS.md — as regras de lá continuam valendo;
aqui está o roteiro de como percorrê-las.

Lembrete de risco: funcionalidade nova nunca é risco baixo. Diga o nível
(médio ou alto) em voz alta logo no início, e por quê. Risco alto muda o
jogo: explicite escopo, ambiente, efeitos e reversão das fases. Rodrigo pode
autorizar essas fases em conjunto; não repita aprovação das já cobertas.

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

**Coordene com os outros agentes.** Consulte Status/Show da portaria,
mandato, passagens, worktrees e PRs; confira arquivos, contratos e recursos.
Use o coordenador vigente e os registros para resolver dependências. Não
pergunte rotineiramente a Rodrigo quem está trabalhando onde. Só solicite
informação se houver uma lacuna material que os registros não resolvam.

## Etapa 1 — Descoberta

O pedido é sintoma, não especificação. O objetivo desta etapa é você
conseguir contar a história completa do fluxo — quem faz o quê, quando,
com que dado, o que dá errado hoje — sem inventar nenhum pedaço.
Investigue lacunas nos registros antes de perguntar. Suposições técnicas
reversíveis cabem ao agente; decisões de negócio relevantes ainda ausentes
cabem a Rodrigo. Não invente requisitos nem reabra decisões respondidas.

**Formato das perguntas:** uma por vez. Quando houver alternativas
claras, use AskUserQuestion com opções clicáveis (Rodrigo responde do
celular); quando a resposta for aberta, pergunte em texto livre no chat.
Linguagem leiga, cenário concreto da padaria.

**Use o caso real já fornecido.** Se faltar contexto operacional que mude
a solução, peça um exemplo concreto. Não repita uma pergunta respondida.

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

**Módulo com nome de mercado: benchmark obrigatório.** Se o pedido é
um módulo que qualquer sistema tem — contas a pagar, contas a receber,
estoque, caixa, folha —, a descoberta não parte só da cabeça do
Rodrigo: parte do padrão do mercado. Monte primeiro a lista do que
qualquer sistema desse tipo oferece e apresente-a para ele decidir
item a item: entra agora, fica para uma fase futura ou fica fora. A
entrevista serve para cortar e adaptar o padrão, não para reinventá-lo
— o que o Rodrigo não pedir por esquecimento vira decisão consciente
registrada, nunca omissão silenciosa. Plano que chegou pronto de fora
(outra ferramenta, outro agente, conversa antiga) passa pelo mesmo
checklist antes de virar código. Para fluxo que só existe na
Pane&Salute, pesquise ferramentas consolidadas quando trouxer valor
real. (Regra nascida do contas a pagar: a entrevista cobriu só o que
foi lembrado, e o módulo nasceu sem juros de atraso, sem data real de
pagamento e sem tela dos itens da NF.)

**Percorra o ciclo de vida completo de cada registro central.** Não só
o caminho feliz: liste todos os estados pelos quais o registro passa e
o que o usuário faz em cada um. Um boleto, por exemplo: emitido, a
vencer, pago no dia, pago atrasado, pago parcial, renegociado,
cancelado. Para registro de dinheiro a regra é fixa: sempre existem o
previsto E o realizado — data prevista e data real, valor previsto e
valor real. Modelo que guarda só um dos dois está errado por
definição.

**Regra da volta do dado.** Todo dado que entra no sistema precisa de
um lugar onde é visto de novo. Se o plano importa ou grava algo e
nenhuma tela mostra, ou não precisava entrar, ou está faltando tela —
o plano não fecha com essa ponta solta. (Também do contas a pagar: os
itens da NF eram salvos no banco e nenhuma tela os mostrava.)

**Custo escondido:** se o pedido simples tiver consequência cara, diga
ANTES de o plano fechar. Se a descoberta revelar que o problema real é
outro, diga isso claramente e proponha o caminho melhor — ceder sem
avisar é desserviço.

## Etapa 2 — Plano

Primeiro, feche o entendimento: resuma em 5–10 linhas leigas o problema,
quem é afetado, o nível de risco e o que ficou fora do escopo. Confira a
autorização existente; não peça confirmação ritual de entendimento já claro.

Depois, quando existirem alternativas reais, apresente-as antes do plano
detalhado, com custo, risco e efeito na operação, em linguagem leiga.
O agente escolhe e fundamenta a solução técnica. Rodrigo decide quando
houver diferença material de negócio, gasto ou consequência fora do escopo.

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
- limite autorizado: plano, preview ou integração/publicação; registrar
  separadamente ativação de fluxo real e eventual aceite humano solicitado.

Para plano de módulo inteiro (mais de duas fases, ou qualquer coisa
com dado financeiro), antes de pedir a aprovação do Rodrigo peça uma
revisão adversarial a um segundo agente — o Claude consulta o Sol, o
Sol consulta o Claude; sem ponte disponível, uma sessão nova sem o
contexto desta serve — com uma pergunta única: "o que falta neste
plano que qualquer sistema desse tipo tem?" Cada lacuna apontada
entra no plano ou é descartada por escrito, nunca ignorada.

Apresente o plano em linguagem leiga primeiro; o detalhe técnico vem
depois, como apoio. Risco médio: o pedido suficiente já pode autorizar o plano
e a execução, sem novo OK ritual.
Risco alto: as fases precisam estar explicitamente cobertas, podendo receber
autorização conjunta com seus efeitos e limites. Ajuste técnico dentro do
escopo cabe ao agente. Mudança de escopo ou consequência não autorizada exige
nova aprovação, com recomendação concreta, sem transferir julgamento técnico.

## Etapa 3 — Briefing de execução

Com o plano aprovado, gere o briefing da fase 1 e das seguintes já cobertas
pela autorização, sem esperar novo pedido a cada etapa. O briefing é um bloco
de texto no chat — nunca um
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
`CI Banco`, `Banco por PR` e `Usuarios do Banco por PR` verdes, grants
explícitos, teste com perfil permitido E bloqueado>

## Estados da tela
<carregando, vazio, erro, sucesso e repetição de ação — o que o
usuário vê em cada um>

## Critérios de aceite
<lista verificável>

## Verificação
<comandos exatos em sequência (lint → tsc → test → build), matriz
perfil × loja, fluxo que o agente executa no preview, prova de persistência
real quando afetada e evidência sanitizada por revisão; avaliação humana
complementar ou dependência concreta, sem transferir testes técnicos>

## Limite autorizado da entrega
<referência à autorização, ambiente, efeitos cobertos, integração/publicação
incluídas ou não, ativação de fluxo real e eventual aceite humano solicitado>

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
  plano autorizado (fases de risco alto explicitamente cobertas) e, se for na mesma
  conversa, seguindo o fluxo normal do AGENTS.md (branch, worktree,
  verificação, PR draft).
- Interrogatório não é o objetivo: pergunta boa é a que muda o plano.
  Se a resposta não mudaria nada, não pergunte.
- Se no meio da descoberta surgir risco fora do escopo (segurança, dado
  financeiro exposto), pare e reporte antes de continuar.
