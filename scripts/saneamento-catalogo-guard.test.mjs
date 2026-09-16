import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20260916164741_saneamento_catalogo_decisoes.sql', import.meta.url),
  'utf8',
)
const guardStart = migration.indexOf('do $$')
const guardEnd = migration.indexOf('end $$;', guardStart)
const guard = migration.slice(guardStart, guardEnd + 'end $$;'.length)

test('a trava confere somente o catálogo e a estrutura de preço que o saneamento atinge', () => {
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'o bloco de trava da migration existe')
  assert.match(guard, /if v_found <> v_expected/)
  assert.doesNotMatch(guard, /<> 99|<> 88|<> 207/)
  assert.match(guard, /i\.product_source=e\.source/)
  assert.match(guard, /i\.product_id=e\.source_id/)
  assert.match(guard, /t\.name=e\.context_name/)
  assert.doesNotMatch(guard, /i\.unit_price=e\.unit_price/)
  assert.doesNotMatch(guard, /i\.active is not distinct from e\.price_active/)
})
