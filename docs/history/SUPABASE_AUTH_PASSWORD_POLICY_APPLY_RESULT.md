# Supabase Auth — política de senha aplicada

Data: 2026-06-22

## Objetivo

Espelhar no Supabase Auth a política de senha já publicada no frontend do ERP, para que a regra não dependa apenas da tela de login.

## Projeto alvo

- Projeto Supabase: `PanePedidosLojas`
- Project ref: `gohluceldchoitihrimw`

## Configuração aplicada

Via Supabase Management API:

```json
{
  "password_min_length": 10,
  "password_required_characters": "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~"
}
```

Na prática, novas senhas precisam ter:

- pelo menos 10 caracteres;
- letra minúscula;
- letra maiúscula;
- número;
- símbolo.

## Configuração não aplicada

Foi tentado ativar:

```json
{
  "password_hibp_enabled": true
}
```

O Supabase recusou com HTTP 402 porque proteção contra senhas vazadas via HaveIBeenPwned exige plano Pro ou superior.

Estado final validado:

```json
{
  "password_min_length": 10,
  "password_required_characters": "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
  "password_hibp_enabled": false,
  "security_update_password_require_reauthentication": false
}
```

## Fontes consultadas

- Supabase Password Security: `https://supabase.com/docs/guides/auth/password-security`
- Supabase Management API: `https://supabase.com/docs/reference/api/introduction`
- Supabase Auth Rate Limits guide, usado como referência do padrão `GET/PATCH /v1/projects/{ref}/config/auth`: `https://supabase.com/docs/guides/auth/rate-limits`

## O que não foi alterado

- Nenhum usuário Supabase Auth foi criado, removido ou editado.
- Nenhum `app_profile` foi criado, removido ou editado.
- Nenhuma linha em `app_users` foi alterada.
- Nenhum PIN foi alterado.
- Nenhum SQL foi executado.
- Nenhuma migration foi aplicada.
- Nenhum segredo foi gravado no repositório.
- Nenhum arquivo de código (`src/`) foi alterado nesta tarefa.

## Observações

- A proteção contra senhas comuns/óbvias continua existindo também no frontend.
- Se o projeto Supabase migrar para plano Pro, habilitar `password_hibp_enabled` deve ser reavaliado.
- Antes de remover o PIN como fallback, revisar sessões, RLS e fluxo de recuperação de acesso.
