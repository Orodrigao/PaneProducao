# Supabase Auth por e-mail — resultado da primeira leva

Data: 2026-06-18

## Resultado

Foram criados 13 usuários no Supabase Auth e 13 perfis em `public.app_profiles`.

O login por e-mail foi preparado em paralelo ao login atual por PIN. O login por PIN continua disponível e `app_users` não foi alterada nesta etapa.

Atualização em 2026-06-18: o magic link direto deixou de ser o fluxo de entrada do dia a dia. O e-mail agora deve ser usado para primeiro acesso/recuperação de senha, e o login normal passa a ser e-mail + senha.

## Usuários criados

| Usuário | E-mail | Role | Store |
| --- | --- | --- | --- |
| Rodrigão | `rodrigao@gmail.com` | `admin` | `null` |
| Suélen | `dra.suelen.oliveira@gmail.com` | `admin` | `null` |
| Elis | `financeiro@paneesalute.com.br` | `financeiro` | `null` |
| Geolar | `producao1@paneesalute.com.br` | `producao` | `jc` |
| Sander | `forno@paneesalute.com.br` | `producao` | `jc` |
| Fran | `cozinha@paneesalute.com.br` | `producao` | `jc` |
| Brian | `expedicao1@paneesalute.com.br` | `expedicao` | `jc` |
| Gustavo | `expedicao2@paneesalute.com.br` | `expedicao` | `jc` |
| Liara | `atendiment@paneesalute.com.br` | `vendas` | `jc` |
| Samuca | `atendimento2@paneesalute.com.br` | `vendas` | `jc` |
| Cleo | `atendimento3@paneesalute.com.br` | `vendas` | `ja` |
| Conferência EX | `producao2@paneesalute.com.br` | `vendas` | `ex` |
| Marselle | `borges@paneesalute.com.br` | `vendas` | `ex` |

## Segurança

- Nenhuma senha foi definida ou registrada.
- O acesso por e-mail usa senha criada pelo próprio usuário.
- O link enviado por e-mail deve ser usado apenas para primeiro acesso ou recuperação de senha.
- Nenhum segredo foi gravado no repositório.
- `app_users`, PINs e login legado não foram alterados.
- RLS/policies existentes não foram alteradas.

## Validação

- `public.app_profiles` contém 13 linhas.
- Cada profile está vinculado a um usuário existente em `auth.users`.
- Todos os profiles estão ativos.
- `store` usa somente `null`, `jc`, `ja` ou `ex`.
