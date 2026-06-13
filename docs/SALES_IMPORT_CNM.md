# SALES_IMPORT_CNM.md — Importação de vendas Controle Na Mão

## Problema

O ERP ainda não tem integração com o PDV Controle Na Mão. Para calcular CMV, precisamos trazer vendas diárias para dentro do ERP com o máximo de automação possível sem depender, no primeiro momento, de API do PDV.

## Estratégia em fases

### Fase 1 — Upload manual padronizado

- Exportar CSV/Excel do CNM.
- Subir no ERP em `/financeiro/importar-vendas`.
- Escolher loja e data.
- Mostrar prévia.
- Mapear produtos não reconhecidos.
- Confirmar importação.

Nomenclatura sugerida:

```text
CNM_YYYY-MM-DD_JULIO.xlsx
CNM_YYYY-MM-DD_EXPOSICAO.xlsx
CNM_YYYY-MM-DD_JARDIM_AMERICA.xlsx
```

### Fase 2 — E-mail ou pasta monitorada

- CNM exporta ou usuário salva arquivo em pasta padrão.
- Automação com n8n/Make/script local pega o arquivo.
- Arquivo vai para Supabase Storage.
- ERP cria importação pendente para revisão.

### Fase 3 — RPA

- Robô local abre CNM, exporta relatório e salva o arquivo.
- Usar apenas se o CNM não oferecer API/export agendado confiável.

### Fase 4 — API direta

- Só implementar se CNM oferecer API/documentação/credenciais oficiais.

## Schema sugerido

```sql
sales_imports (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  source text not null default 'cnm',
  file_name text not null,
  file_hash text,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  imported_by text,
  imported_at timestamptz default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  raw_summary jsonb
);

sales_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references sales_imports(id),
  sale_date date not null,
  sale_time time,
  store text not null,
  channel text,
  product_id text,
  product_source text,
  product_name_raw text not null,
  quantity numeric not null,
  unit_price numeric,
  gross_total numeric,
  discount_total numeric default 0,
  net_total numeric,
  payment_method text,
  raw_row jsonb
);

sales_product_aliases (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'cnm',
  store text,
  raw_name text not null,
  product_id text not null,
  product_source text not null,
  confidence numeric,
  approved_by text,
  approved_at timestamptz default now(),
  unique(source, store, raw_name)
);
```

## Regras críticas

- Não confirmar importação com produto sem vínculo se o item impactar CMV.
- Bloquear duplicidade por loja + data + hash de arquivo.
- Permitir substituir importação, mas com log.
- Guardar linha bruta em JSON para auditoria.
- Nunca usar dados de venda para alterar preço automaticamente.
