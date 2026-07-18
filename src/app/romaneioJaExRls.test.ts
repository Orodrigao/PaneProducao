import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL(
    '../../supabase/migrations/20260718164619_permitir_ja_confirmar_saida_para_ex.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\r\n/g, '\n').toLowerCase()

describe('RLS do Romaneio JA para EX', () => {
  it('exige perfil de vendas JA com acesso ao Romaneio', () => {
    expect(migrationSource).toContain("p.role = 'vendas'")
    expect(migrationSource).toContain("lower(p.store) = 'ja'")
    expect(migrationSource).toContain("? '/romaneio'")
  })

  it('libera somente o destino EX para a exceção de JA', () => {
    expect(migrationSource).toContain("lower(d.code) = 'ex'")
    expect(migrationSource).toContain("lower(public.destinations.code) = 'ex'")
  })

  it('protege leitura e escrita de romaneios e itens', () => {
    expect(migrationSource).toContain('create policy romaneios_manage_route_store')
    expect(migrationSource).toContain('create policy romaneio_items_manage_route_store')
    expect(migrationSource.match(/with check/g)).toHaveLength(2)
  })
})
