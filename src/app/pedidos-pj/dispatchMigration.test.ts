import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260721154418_adicionar_envio_pedidos_pj.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration do envio de Pedidos PJ', () => {
  it('registra quando e por quem o pedido foi enviado', () => {
    expect(migration).toContain('add column if not exists dispatched_at timestamptz')
    expect(migration).toContain('add column if not exists dispatched_by uuid')
    expect(migration).toContain('add column if not exists dispatched_by_name text')
  })

  it('concede a tela e a ação somente para a Expedição da JC', () => {
    expect(migration).toContain("'pedidos_pj.confirmar_envio'")
    expect(migration).toContain("profile.role = 'expedicao'")
    expect(migration).toContain("profile.store = 'jc'")
    expect(migration).toContain("'pedidos_pj.acessar'")
    expect(migration).toContain('/pedidos-pj')
  })

  it('expõe somente leitura operacional sem preços', () => {
    const functionStart = migration.indexOf('create or replace function public.list_pj_orders_for_dispatch()')
    const functionEnd = migration.indexOf('revoke all on function public.list_pj_orders_for_dispatch()', functionStart)
    const operationalFunction = migration.slice(functionStart, functionEnd)

    expect(functionStart).toBeGreaterThan(-1)
    expect(functionEnd).toBeGreaterThan(functionStart)
    expect(operationalFunction).not.toContain('unit_price')
  })

  it('impede a Expedição de contornar a fila e ler o Pedido PJ com preço', () => {
    expect(migration).toContain('drop policy if exists orders_select_authenticated_profiles on public.orders')
    expect(migration).toContain("profile.role <> 'expedicao'")
    expect(migration).toContain("public.orders.order_type <> 'pj'")
  })

  it('protege a confirmação, inclusive contra repetição e grupo inválido', () => {
    expect(migration).toContain('create or replace function public.confirm_pj_order_dispatch')
    expect(migration).toContain("security definer\nset search_path = ''")
    expect(migration).toContain("order_row.order_type = 'pj'")
    expect(migration).toContain('for update')
    expect(migration).toContain('v_dispatched_count = v_row_count')
    expect(migration).toContain('revoke all on function public.confirm_pj_order_dispatch(uuid) from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.confirm_pj_order_dispatch(uuid) to authenticated')
  })

  it('impede que a confirmação seja forjada por uma alteração comum do pedido', () => {
    expect(migration).toContain('create or replace function private.guard_pj_dispatch_write()')
    expect(migration).toContain('create trigger guard_pj_dispatch_write')
    expect(migration).toContain("set_config('pane.pj_dispatch_rpc', 'on', true)")
  })

  it('trava edição, cancelamento e exclusão depois da conclusão', () => {
    expect(migration).toContain('create or replace function private.guard_dispatched_pj_order_changes()')
    expect(migration).toContain('create trigger guard_dispatched_pj_order_changes')
    expect(migration).toContain("old.order_type = 'pj' and old.dispatched_at is not null")
  })
})
