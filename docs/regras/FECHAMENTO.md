# Regras de fechamento — verificação, entrega e revisão

Regra de trabalho acionada pela tabela de gatilhos do `AGENTS.md`: leia antes de
declarar pronto, rodar a bateria, abrir ou atualizar PR, pedir `Check` ou
integrar.
Vale tanto quanto o `AGENTS.md`; em conflito, vale o `AGENTS.md`.

A bateria de comandos e a ordem fixa do fechamento estão no `AGENTS.md`
(seção Verificação e entrega). Este arquivo detalha o resto.

## Verificação

Os comandos da bateria pertencem ao fechamento, não ao diagnóstico. Durante a
investigação, rode direto na worktree o menor teste que reproduz a falha
(`npx vitest run <arquivo>`, `npx tsc --noEmit`, `npx eslint <arquivo>`) e prove
vermelho-verde quando couber. As dependências já foram instaladas pelo `npm ci` no
nascimento do worktree; pacote novo só entra pela caixa isolada. O `Diagnose` da
Portaria reconstrói a caixa inteira a cada chamada e fica reservado à prova que
exigir isolamento.

Não repita a bateria completa sem mudança relevante de código, dado ou ambiente,
salvo instabilidade ou falha de infraestrutura identificada e registrada. Conte e
explique no fechamento qualquer repetição completa. `tsc` e `build` sempre em
sequência, nunca em paralelo.

Além disso:

- testar no navegador (no preview do PR quando existir) o fluxo completo
  alterado;
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

O agente executa essa matriz, inclusive no navegador com contas fictícias;
o acesso segue `docs/AMBIENTE_PREVIEW.md`. Mocks provam apenas cenários simulados.
Quando houver gravação alterada, confirme persistência real no ambiente de teste
após recarregar/reler e confirme que entradas rejeitadas não gravam indevidamente.
Registre revisão testada, ambiente, perfis, resultados e lacunas no PR. Teste
ignorado não conta como aprovado; repetição que passa não elimina instabilidade.
Uma lacuna técnica relevante impede declarar prontidão e exige investigação,
não um pedido genérico para Rodrigo testar. A avaliação humana não substitui prova.

Antes de testar, consulte `PlanChecks` da Portaria. Mudança exclusivamente em
`README.md`, `AGENTS.md`, `CLAUDE.md`, `lessons.md` ou Markdown sob `docs/`
recebe conferência documental: diff, estrutura, referências adicionadas e consistência.
Não instala dependências, executa testes do ERP, build, navegador ou prepara preview.
Os caminhos anteriores de renomeações também contam; qualquer código, configuração,
lista incompleta ou caminho fora dessa lista impede a dispensa. Cleanup de recursos
que já existiam permanece obrigatório.

A dispensa não confere as regras: quem muda `AGENTS.md`, `CLAUDE.md`,
`lessons.md`, `docs/regras/` ou `.claude/skills/` roda
`npx vitest run src/lib/harness.test.ts` no worktree antes do push e registra o
resultado no PR, porque o CI de PR só documental não roda o `npm test`.

Markdown que altera autoridade (`AGENTS.md`, `CLAUDE.md` e `docs/regras/`)
continua protegido e exige revisão independente,
registrada em `-ReviewEvidence` no Check. Código da Portaria/instalador exige provas
dos mecanismos alterados; isso não torna obrigatória a bateria do ERP.

Após 15 minutos sem nova evidência, o responsável reavalia hipótese, ferramenta e
divisão do trabalho. Registre tempos observados e contribuição por provedor nas
três primeiras entregas do novo fluxo. Não estime tokens por PR nem repita bateria
idêntica sem causa concreta de infraestrutura, instabilidade ou dados registrada.

**Lógica de workflow se testa na máquina, não empurrando.** Passo de
workflow que decide alguma coisa (um guarda que barra, um filtro que escolhe
o que roda) só era exercitado abrindo PR e esperando o semáforo: caro e
lento, e impossível de repetir à vontade enquanto todas as PRs disputavam um
banco de teste só. O que esses passos decidem depende só dos dados que chegam, então
copie o trecho do workflow ao pé da letra para um script de teste e troque
apenas a fonte dos dados por casos fabricados. Cubra sempre os três que a
realidade não oferece: lista vazia, campo ausente e lista truncada no
limite de paginação. Trava de serialização falha FECHADA — na dúvida barra,
porque deixar passar o que ela existe para impedir é pior que barrar à toa.
Isso testa a regra, não a sintaxe: continue dizendo, ao declarar pronto,
que o trecho real não foi executado.

## Entrega

- Commits pequenos e em português.
- Push somente da branch da tarefa.
- **A sessão se identifica pela tarefa, e pela PR assim que ela existir.**
  Renomeie a própria sessão para o assunto ao começar (`banco de teste por PR`)
  e para `#<numero> <assunto curto>` logo depois de abrir a PR
  (`#296 manual do banco por PR`). O Rodrigo acompanha várias frentes ao mesmo
  tempo e a lista de sessões é o índice dele; sessão com nome genérico o obriga
  a abrir uma por uma para achar a que ele quer. Vale para qualquer agente cuja
  ferramenta permita renomear a sessão.
- Pull request sempre draft, salvo pedido explícito em contrário.
- Nunca fazer push direto na `main`.
- Preencher todas as seções aplicáveis do template de PR; seção não
  aplicável recebe `N/A` com justificativa curta, nunca é apagada.
- Informar em linguagem leiga: o que mudou para a operação, arquivos
  alterados, verificações executadas e riscos restantes.
- Fechar com o link do preview, a evidência dos testes executados pelos agentes
  e as lacunas concretas (regra 6 do `AGENTS.md`). Sugestões de avaliação humana são opcionais,
  salvo aceite humano explicitamente solicitado para a entrega.
- Depois do merge: confirmar que o deploy ficou "Ready" (e, se houve
  migration, que a Action `Banco (migrations)` passou), deletar branch e
  worktree, e avisar o Rodrigo: "no ar, ambiente limpo". A entrega só
  termina com a casa limpa.

Uma sessão cobre uma entrega lógica. PR substituta da mesma entrega pode
continuar nela; entrega integrada, cancelada ou encerrada exige fechamento e fim
da sessão. Nova fase ou novo objetivo que abra outra PR nasce em nova
sessão, com passagem curta e sem logs extensos. Acompanhe jobs por esperas ou
consultas compactas, com intervalo crescente, e comunique somente transições
relevantes.

No fechamento, quando observável, separe tempo de implementação, diagnóstico,
testes específicos, baterias completas, espera externa, retrabalho e bloqueio
por cota. Não estime retrospectivamente o que não foi medido.

## Revisão automática (CodeRabbit)

**CodeRabbit nas PRs:** o aplicativo do GitHub está autorizado somente no
repositório público `Orodrigao/PaneProducao` e faz revisão automática das PRs
novas elegíveis. Como o fluxo deste projeto abre toda PR em rascunho, o check
pode responder `Review skipped: draft pull request`; nesse caso, com o diff
estável, publique o comentário `@coderabbitai full review` e aguarde o parecer.
Como ele só atua depois do push, é evidência adicional e não substitui a revisão
adversarial anterior à PR, testes, CI, Check da Portaria nem decisão do agente
responsável.

- aguarde o check do CodeRabbit quando ele aparecer e classifique cada achado;
  sugestão genérica ou incompatível com o projeto deve ser descartada por escrito,
  problema real causado ou exposto pelo diff deve ser corrigido antes do
  fechamento, e achado fora do escopo deve ser registrado e tratado conforme as
  demais regras do `AGENTS.md` e deste arquivo;
- o CodeRabbit não pode aprovar PR, aplicar correção, gerar teste, criar commit ou
  abrir PR derivada por iniciativa própria. Comandos como `@coderabbitai autofix`,
  caixas de *Finishing Touches* e recursos de agente só podem ser acionados quando
  fizerem parte do escopo autorizado e continuam sujeitos à revisão normal;
- para uma PR aberta que nasceu antes da instalação, `@coderabbitai full review`
  pede uma leitura completa. Não dispare revisão em massa nem reabra PR encerrada;
- não amplie a instalação para outro repositório, especialmente um privado, nem
  habilite produto cobrado por uso sem conferir preço, dados enviados, permissões
  e obter autorização explícita do Rodrigo;
- comentário ou check verde do CodeRabbit é evidência auxiliar. Nunca é autorização
  para merge, publicação, mudança de permissão ou operação em produção.
