# Tarefa: instalar Vitest + primeiro teste (baixa em cascata de kits)

Aprovada pelo usuário em 09/06/26. Branch: `feat/vitest-baixa-kits`.

## Plano

- [x] 1. `npm install -D vitest` (sem jsdom — primeiro teste é de lógica pura)
- [x] 2. `vitest.config.ts` com alias `@/*` → `./src/*` (mesmo do tsconfig)
- [x] 3. Scripts no `package.json`: `test` (vitest run) e `test:watch` (vitest)
- [x] 4. Extrair cálculo da cascata de descarte de kit de `src/app/sobras/page.tsx`
      para `src/lib/kitCascade.ts` (funções puras `filterKitDiscards` +
      `buildKitCascadeMovements`) — revisão multi-agente confirmou equivalência 100%
- [x] 5. Teste `src/lib/kitCascade.test.ts` — 14 testes (12 originais + 2 da revisão
      adversarial: mutante de loja/responsável fixos e pão compartilhado entre kits)
- [x] 6. Prova: `npm test` (14/14) + `npx tsc --noEmit` verdes. Lint roda (config nova).
- [x] 7. Commits pequenos no branch (setup / extração+teste)

## ⛔ BLOQUEADO — aguardando decisão do Rodrigão

- `.eslintrc.json` novo faz o `next build` passar a rodar lint, e 2 erros
  PRÉ-EXISTENTES em `src/app/page.tsx:1054` (aspas sem escape no JSX) derrubam
  o build. Main em produção NÃO é afetada (não tem o config). Opções:
  (a) escapar as 2 aspas (1 linha, fora do escopo declarado → precisa de OK);
  (b) `eslint.ignoreDuringBuilds` no next.config (esconde o gate — não recomendo).

## Fora do escopo (anotado, não mexer)

- Cascata do romaneio (`src/app/romaneio/page.tsx:310-356`) tem lógica própria
  parecida (duas pernas: -central/+destino). Candidata a compartilhar a lib no
  futuro — exige aprovação antes.
- 85 usos de `any` pré-existentes (14 arquivos) — dívida anotada em 09/06/26.
