# Tarefa: subir ESLint pro modo strict + proibir `any`

Aprovada pelo usuário em 09/06/26 ("Faça"). Branch: `feat/eslint-strict` (baseado em
`feat/vitest-baixa-kits` — depende do `.eslintrc.json` daquele PR #50).

## Decisão

Adotar **`next/typescript`** (preset oficial TS do Next) **+ `next/core-web-vitals`** já
existente. Para regras que pegariam código pré-existente em peso, **inicialmente `warn`** —
não barram o build, mas aparecem no `npm run lint`. Migração progressiva sem PR gigante.

`@typescript-eslint/no-explicit-any` fica como **warn** (85 ocorrências pré-existentes
em 14 arquivos). Cada nova entrega remove um pouquinho da dívida; quando chegar a
zero, sobe pra error.

## Plano

- [x] 1. ~~`npm install -D @typescript-eslint/eslint-plugin @typescript-eslint/parser`~~
      Já vinham via `eslint-config-next` 15.3.2 (`@typescript-eslint/*` 8.59.4)
- [x] 2. `.eslintrc.json`: extends = `["next/core-web-vitals", "next/typescript"]`;
      rules: `no-explicit-any: warn`, `no-unused-vars: warn` com `^_` ignorado.
- [x] 3. `npm run lint`: **0 erros, 183 warnings** (todos pré-existentes). Build não
      barra mas a dívida fica visível.
- [x] 4. `npm test` 14/14 ✅, `npx tsc --noEmit` ✅, `npm run build` ✅ 29 páginas.
- [x] 5. Commit + push + PR contra `main` empilhado em #50.

## Fora do escopo (anotado, NÃO mexer agora)

- Limpar os 85 `any` — entra como dívida visível via `npm run lint`.
- Migrar `next lint` pro ESLint CLI (deprecação no Next 16) — tarefa própria.
- Atualizar `eslint-config-next` 15.3.2 → 15.5.x — fora do escopo da regra.
