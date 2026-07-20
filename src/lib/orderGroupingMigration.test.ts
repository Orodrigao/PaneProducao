import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL(
    '../../supabase/migrations/20260720230027_adicionar_identidade_cancelamento_pedidos.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration da identidade de pedidos', () => {
  it('adiciona a identidade e os dados futuros de cancelamento sem obrigar pedidos diários', () => {
    expect(migrationSource).toContain('add column if not exists order_group_id uuid')
    expect(migrationSource).toContain('add column if not exists cancelled_at timestamptz')
    expect(migrationSource).toContain('add column if not exists cancelled_by text')
    expect(migrationSource).toContain('add column if not exists cancel_reason text')
    expect(migrationSource).not.toMatch(/order_group_id uuid\s+not null/)
  })

  it('preenche somente PJ e encomendas ainda sem etiqueta', () => {
    expect(migrationSource).toContain("o.order_type in ('pj', 'encomenda')")
    expect(migrationSource.match(/o\.order_group_id is null/g)).toHaveLength(2)
  })

  it('gera um único uuid materializado por chave legada antes de atualizar as linhas', () => {
    expect(migrationSource).toContain('select distinct')
    expect(migrationSource).toContain('legacy_groups as materialized')
    expect(migrationSource.match(/gen_random_uuid\(\)/g)).toHaveLength(1)
    expect(migrationSource).toContain('o.order_date is not distinct from g.order_date')
    expect(migrationSource).toContain('o.delivery_date is not distinct from g.delivery_date')
  })
})
