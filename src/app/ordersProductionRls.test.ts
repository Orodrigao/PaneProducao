import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL(
    '../../supabase/migrations/20260718095446_permitir_vendas_salvar_producao_da_loja.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase()

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8').toLowerCase()

describe('RLS do pedido de produção da loja', () => {
  it('identifica explicitamente o pedido comum como produção', () => {
    expect(pageSource).toContain("order_date: date, order_type: 'producao', obs")
  })

  it('permite que vendas grave produção somente para a própria loja', () => {
    expect(migrationSource).toContain("p.role = 'vendas'")
    expect(migrationSource).toContain("public.orders.order_type = 'producao'")
    expect(migrationSource).toContain('p.store = public.orders.store')
  })

  it('aplica a restrição de loja em insert, update e delete', () => {
    expect(migrationSource.match(/p\.store = public\.orders\.store/g)).toHaveLength(4)
    expect(migrationSource).toContain('create policy orders_insert_authenticated_profiles')
    expect(migrationSource).toContain('create policy orders_update_authenticated_profiles')
    expect(migrationSource).toContain('create policy orders_delete_authenticated_profiles')
  })

  it('preserva o acesso existente de administradores, financeiro e encomendas', () => {
    expect(migrationSource).toContain("p.role in ('admin', 'financeiro')")
    expect(migrationSource).toContain("public.orders.order_type = 'encomenda'")
  })
})
