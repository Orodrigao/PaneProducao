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
  assert.match(guard, /b\.name=e\.source_name/)
  assert.match(guard, /b\.active is not distinct from e\.source_active/)
  assert.match(guard, /p\.name=e\.source_name/)
  assert.match(guard, /p\.active is not distinct from e\.source_active/)
  assert.match(guard, /i\.product_source=e\.source/)
  assert.match(guard, /i\.product_id=e\.source_id/)
  assert.match(guard, /t\.name=e\.context_name/)
  assert.match(guard, /i\.pack_size=e\.pack_size/)
  assert.doesNotMatch(guard, /i\.unit_price=e\.unit_price/)
  assert.doesNotMatch(guard, /i\.active is not distinct from e\.price_active/)
})

test('a ponte do Pão de Hotdog só muda depois de validar e aposentar o cadastro duplicado', () => {
  const legacyProductId = 'a4f323b7-16cb-4454-8e66-d2c98ccef960'
  const masterProductId = '888f9a70-ff75-45eb-b5fc-add486dc287c'
  const legacyBreadId = 'paodehotdog1779743021606'

  assert.match(migration, /Ponte do Pão de Hotdog/)
  assert.match(
    migration,
    /lock table public\.orders, public\.price_tier_items, public\.customer_price_overrides in share row exclusive mode/,
  )
  assert.match(migration, new RegExp(`id='${legacyProductId}'`))
  assert.match(migration, new RegExp(`legacy_bread_id='${legacyBreadId}'`))
  assert.match(migration, new RegExp(`id='${masterProductId}'`))

  const retireBridge = migration.indexOf(
    `update public.products set active=false, legacy_bread_id=null\n    where id='${legacyProductId}'`,
  )
  const assignBridge = migration.indexOf(`where id='${masterProductId}'`)
  assert.ok(retireBridge >= 0 && assignBridge > retireBridge, 'a ponte duplicada sai antes de ser atribuída ao item mestre')
  assert.match(migration, /Pão de Hotdog mudou desde a auditoria/)
  assert.match(migration, /pedido aberto ligado ao cadastro duplicado/)
  assert.match(migration, /preço ativo ligado ao cadastro duplicado/)
})
