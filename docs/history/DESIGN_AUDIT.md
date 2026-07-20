# DESIGN_AUDIT.md — Auditoria de design do ERP

## Diagnóstico

O app está correto na direção operacional: mobile-first, botões grandes, cards e navegação inferior.

O problema é a coexistência de dois sistemas visuais:

1. CSS antigo: `.topbar`, `.bread-row`, `.btn-*`.
2. Redesign Pane&Salute: `.ps-canvas`, `.ps-shell`, `.ps-card`, `.ps-nav`.

## Decisão

Não reescrever tudo.

Regra:

- Módulos novos usam `ps-*`.
- Módulos antigos só migram quando forem tocados por necessidade do CMV.
- Não fazer redesign como tarefa isolada antes de CMV.

## Componentes desejados

Criar gradualmente:

- `PageHeader`
- `KpiStrip`
- `StatusBanner`
- `ActionCard`
- `ConfirmSheet`
- `EmptyState`
- `ImportReviewTable`
- `ProductMatchRow`
- `StoreStatusChip`
- `MoneyValue`

## UX por perfil

### Operação

- poucos campos;
- botões grandes;
- input numérico simples;
- fluxo rápido;
- confirmação para ações irreversíveis.

### Rodrigo/financeiro

- dashboard;
- filtros por período/loja/canal;
- KPIs;
- alertas;
- explicações;
- exportação.
