# TODO — Completar /admin/usuarios

**Criado:** 2026-05-20
**Status:** done (aguardando teste manual)

## Contexto / objetivo

Completar o painel admin pra dar autonomia total ao Rodrigão / Suélen sobre usuários. Hoje pra mudar role ou routes de alguém eu rodo SQL na mão.

Alvo: editar **role** e **routes** por usuário direto na UI, com checkboxes por módulo. De quebra, corrigir bug latente em `createUserInSupabase` (mapping de coluna errado) que provavelmente faz criação pelo modal falhar silenciosamente.

## Plano

### Backend ([src/lib/auth.ts](src/lib/auth.ts))

- [x] `updateUserInSupabase`: aceitar também `routes` e `displayName`/`name` no Partial<>
- [x] `createUserInSupabase`: corrigir `username` → `name` no body POST; gerar `id` a partir do username (slugify); incluir `routes` opcional
- [x] Não mexer em `fetchUsersFromSupabase` (já lê routes corretamente)

### UI ([src/app/admin/usuarios/page.tsx](src/app/admin/usuarios/page.tsx))

- [x] `NewUserModal`: adicionar `financeiro` e `expedicao` no dropdown de role (via `ALL_ROLES`)
- [x] `NewUserModal`: checkboxes de routes — pré-marca os defaults da role selecionada, admin pode adicionar/tirar antes de criar
- [x] Lista de usuários: adicionar botão **"Editar"** ao lado do "PIN" e "Desativar"
- [x] Novo componente `EditUserModal`: edita role (dropdown), displayName (text), routes (checkboxes). Username e id ficam imutáveis após criação.

### Verificação

- [x] `npm run build` verde
- [x] `npx tsc --noEmit` verde
- [ ] Manual test pelo Rodrigão (admin): logar, abrir /admin/usuarios, editar routes de algum user, recarregar, conferir persistência

## Fora de escopo

- **Edit-vs-Visualiza por rota** — feature separada e deferida
- **Deletar usuário** — sempre usar Desativar (não perde audit trail)
- **Mudar username/id após criação** — quebra referências históricas; força recriação se precisar
- **Editar `color`** — fica auto-derivado da role via `roleColor()` (visual da bolinha do avatar). Não vale o ruído no form.
- **Audit log** ("quem editou o quê e quando") — tabela nova, fora do escopo desta tarefa

## Estimativa

- `auth.ts`: ~25 linhas adicionadas
- `NewUserModal`: ~25 linhas adicionadas (dropdown estendido + checkboxes de routes)
- `EditUserModal`: ~80 linhas (novo componente)
- Lista: ~5 linhas (botão "Editar")
- **Total:** ~135 linhas. Arquivo `admin/usuarios/page.tsx` cresce de 194 → ~330 linhas. Manageable.

## Notas durante execução

- (preenchido conforme avanço)
