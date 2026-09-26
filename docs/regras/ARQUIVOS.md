# Regras de arquivos — onde cada coisa mora e o que registrar

Regra de trabalho acionada pela tabela de gatilhos do `AGENTS.md`: leia antes de
criar, mover ou apagar arquivo, ou de registrar estado, lição ou plano.
Vale tanto quanto o `AGENTS.md`; em conflito, vale o `AGENTS.md`.

## Contrato de arquivos

Agentes diferentes escrevem neste repositório; sem contrato, ele vira um
depósito de markdown órfão. Todo arquivo novo tem um único lugar legítimo:

- **Raiz:** somente `AGENTS.md`, `CLAUDE.md`, `lessons.md` e `README.md`.
  Nunca crie arquivo novo na raiz.
- **`docs/`:** o cânone fixo (`CURRENT_STATE.md`, `PLAN.md`, `PRD.md`) mais
  um documento por funcionalidade, em `MAIUSCULAS_COM_UNDERSCORE.md`.
  Antes de criar, procure: se já existe documento da funcionalidade,
  atualize-o — nunca crie um segundo com nome parecido.
- **`docs/regras/`:** somente as regras de trabalho acionadas pela tabela de
  gatilhos do `AGENTS.md`, uma por arquivo, em `MAIUSCULAS.md`. Regra nova
  entra na tabela no mesmo PR; arquivo aqui sem linha na tabela é órfão, e o
  teste do harness (`src/lib/harness.test.ts`) falha — em PR só documental,
  rode-o antes do push (ver FECHAMENTO).
- **`docs/history/`:** documento que perdeu vigência é movido para cá
  (movido, nunca copiado). Aqui nada é editado.
- **`docs/examples/` e `test/fixtures/`:** dados de exemplo, sempre
  anonimizados.
- **`supabase/`:** migrations e testes pgTAP, nos formatos já definidos.
- **`.claude/skills/`:** skills compartilhadas do harness de IA, uma por
  pasta com `SKILL.md`. É o único conteúdo de `.claude/` versionado; as
  configurações locais por máquina (`settings.local.json`, `launch.json`)
  seguem ignoradas. Skill nunca contém segredo.
- **Proibido em qualquer lugar:** markdown dentro de `src/`, arquivos de
  rascunho ou anotação (`NOTES.md`, `TODO.md`, `RESUMO.md`, `PLANO_V2.md`),
  relatório de tarefa como arquivo novo (o PR é o relatório) e qualquer
  cópia de documento existente. Na dúvida sobre onde escrever: não crie —
  pergunte.

Não guardar:

- narração da tarefa;
- informação óbvia ao ler o código;
- lista de arquivos alterados;
- estado temporário de branch;
- detalhe já preservado no PR ou commit;
- snapshot chamado de "estado atual" sem data e fonte;
- todo de entrega específica fora de `docs/history/` depois de concluída.

## Memória útil

Após uma tarefa bem-sucedida:

- atualize `docs/CURRENT_STATE.md` somente se fase, capacidade ou risco real
  mudou;
- registre em `lessons.md` somente regra de uma linha (até 40 palavras),
  generalizável e capaz de evitar erro futuro, formato `data - slug - regra`.
  O arquivo tem teto de 40 linhas, conferido pelo teste do harness: passou
  disso, consolide antes de acrescentar.
  Post-mortem fica no corpo da PR; lição que puder virar teste, lint ou guarda
  vira código; como-fazer de ambiente vai para `docs/AMBIENTE_PREVIEW.md`;
- altere `AGENTS.md` e `docs/regras/` somente quando surgir uma regra global
  e durável — nunca estado, que envelhece e vira mapa errado;
- atualize `docs/PLAN.md` somente quando roadmap, ordem ou critério de
  pronto mudar;
- mova para `docs/history/` documentos de tarefa que perderam vigência.
