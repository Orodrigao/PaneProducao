# SALES_IMPORT_CNM.md — Importação de vendas Controle Na Mão

**Natureza:** especificação da funcionalidade. Para saber o que já existe e o
que ainda falta, consulte [CURRENT_STATE.md](CURRENT_STATE.md).

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

#### Coletor local validado para JC

O fluxo gravado em 11/07/2026 confirmou:

- relatório `Vendas` exibido por `Produto`;
- local `Pane Salute` corresponde a `jc`;
- o botão XLS só habilita depois de selecionar o local e aplicar os filtros;
- o arquivo gerado é um `.xls` real e pode ser validado pelo leitor do ERP.

O coletor usa um perfil de Chrome dedicado em `storage/cnm/profile/`, ignorado
pelo Git. Usuário, senha, cookies e estado autenticado nunca entram no código.

Primeiro uso ou renovação da sessão:

```bash
npm run cnm:login
```

Na janela aberta, faça o login autorizado no CNM e pressione Enter no terminal
quando a tela inicial estiver disponível.

Download de uma data:

```bash
npm run cnm:download -- --date 2026-07-10
```

Para acompanhar visualmente ou investigar mudança de layout:

```bash
npm run cnm:download -- --date 2026-07-10 --headed
```

O resultado fica em:

```text
storage/cnm/downloads/CNM_2026-07-10_JC.xls
```

Ao repetir a mesma data, o coletor compara SHA-256. Arquivo idêntico é mantido
sem duplicação. Um arquivo diferente é preservado como `CONFLITO` e não
sobrescreve o anterior; `--replace` deve ser usado somente após revisão humana.
Se o CNM informar que outra exportação ainda está em processamento, o coletor
aguarda o intervalo exigido pelo site e tenta novamente uma vez.

Variáveis opcionais, sempre locais:

| Variável | Uso |
|---|---|
| `CNM_PROFILE_DIR` | Caminho do perfil autenticado dedicado |
| `CNM_DOWNLOAD_DIR` | Pasta dos relatórios brutos |
| `CNM_TIMEOUT_MS` | Limite de espera do CNM; padrão 60000 ms |
| `CNM_CHROME_PATH` | Executável do Chrome quando fora do local padrão |

Falhas salvam uma captura local em `storage/cnm/downloads/errors/`. Essa pasta
pode conter dados operacionais e não deve ser compartilhada nem versionada.

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
