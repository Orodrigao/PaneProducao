import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guarda as invariantes vivas do banco contra o schema versionado ATIVO
// (baseline + migrations posteriores), nunca contra docs/history/.
// O baseline usa o dialeto do pg_dump (aspas duplas, casts ::text);
// a normalização abaixo permite escrever asserções legíveis.

const migrationsDir = resolve(process.cwd(), 'supabase/migrations')

function normalize(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/::text/g, '')
    .replace(/\s+/g, ' ')
}

const schema = normalize(
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8'))
    .join('\n'),
)

describe('RLS da lista de produção de itens', () => {
  it('nega escrita anônima e concede a tabela ao usuário autenticado', () => {
    expect(schema).toContain(
      'grant select,insert,delete,update on table public.product_production to authenticated',
    )
    expect(schema).not.toMatch(/grant [a-z,]* on table public\.product_production to anon/)
  })

  it('permite leitura a perfis ativos e escrita somente a administradores', () => {
    expect(schema).toContain('create policy product_production_select_active_profiles')
    expect(schema).toContain('create policy product_production_insert_admins')
    expect(schema).toContain('create policy product_production_update_admins')
    expect(schema).toContain('create policy product_production_delete_admins')
  })
})

describe('RLS do pedido de produção da loja', () => {
  it('permite que vendas grave produção somente para a própria loja', () => {
    expect(schema).toContain("p.role = 'vendas'")
    expect(schema).toContain("orders.order_type = 'producao'")
    expect(schema.match(/p\.store = orders\.store/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('preserva o acesso de administradores e financeiro, inclusive a encomendas', () => {
    expect(schema).toContain("p.role = any (array['admin', 'financeiro'])")
    expect(schema).toContain("orders.order_type = 'encomenda'")
  })
})

describe('permissões granulares do Romaneio', () => {
  it('protege saída e recebimento com funções transacionais autenticadas', () => {
    expect(schema).toContain('create or replace function public.confirm_romaneio_departure')
    expect(schema).toContain('create or replace function public.confirm_romaneio_receipt')
    expect(schema).toContain('private.current_user_has_permission')
    expect(schema).toContain('for update of romaneio')
  })
})

describe('conciliação de sobras pelo Forno', () => {
  it('concilia pelo lote real com função interna sem execução pública', () => {
    expect(schema).toContain('create or replace trigger reconcile_bread_leftovers_after_oven')
    expect(schema).toContain('set lot_id = new.id')
    expect(schema).toContain(
      'revoke all on function public.reconcile_bread_leftovers_after_oven() from public',
    )
    expect(schema).not.toMatch(
      /grant [a-z,]* on function public\.reconcile_bread_leftovers_after_oven\(\) to authenticated/,
    )
  })
})

describe('envio de Pedidos PJ pela Expedição', () => {
  it('registra quando e por quem o pedido foi enviado', () => {
    expect(schema).toContain('dispatched_at timestamp with time zone')
    expect(schema).toContain('dispatched_by uuid')
    expect(schema).toContain('dispatched_by_name')
  })

  it('expõe leitura operacional sem preços', () => {
    const start = schema.indexOf('create or replace function public.list_pj_orders_for_dispatch')
    const end = schema.indexOf('$$;', start)
    expect(start).toBeGreaterThan(-1)
    expect(schema.slice(start, end)).not.toContain('unit_price')
  })

  it('protege a confirmação com RPC transacional e triggers de guarda', () => {
    expect(schema).toContain('create or replace function public.confirm_pj_order_dispatch')
    expect(schema).toContain(
      'grant all on function public.confirm_pj_order_dispatch(p_order_group_id uuid) to authenticated',
    )
    expect(schema).toContain('create or replace trigger guard_pj_dispatch_write')
    expect(schema).toContain('create or replace trigger guard_dispatched_pj_order_changes')
    expect(schema).toContain("set_config('pane.pj_dispatch_rpc', 'on', true)")
  })
})

describe('identidade e cancelamento de pedidos', () => {
  it('mantém identidade de grupo opcional e dados de cancelamento', () => {
    expect(schema).toContain('order_group_id uuid')
    expect(schema).not.toMatch(/order_group_id uuid not null/)
    expect(schema).toContain('cancelled_at timestamp with time zone')
    expect(schema).toContain('cancel_reason')
  })
})

describe('gestão de acesso por usuário', () => {
  it('salva a substituição da matriz em uma única transação SQL', () => {
    expect(schema).toContain('create or replace function public.replace_user_permissions')
  })

  it('reproduz o catálogo completo de permissões do sistema', () => {
    const catalog = normalize(
      readFileSync(
        resolve(migrationsDir, '20260722193805_catalogo_permissoes_sistema.sql'),
        'utf8',
      ),
    )
    for (const key of [
      'producao.acessar',
      'romaneio.visualizar',
      'romaneio.confirmar_saida',
      'romaneio.conferir_recebimento',
      'romaneio.aprovar_divergencia',
      'romaneio.administrar',
      'pedidos_pj.confirmar_envio',
      'usuarios.gerenciar',
    ]) {
      expect(catalog).toContain(`'${key}'`)
    }
    expect(catalog.match(/\('[a-z_.]+',/g)?.length).toBe(26)
    expect(catalog).toContain('on conflict (key) do update')
  })
})
