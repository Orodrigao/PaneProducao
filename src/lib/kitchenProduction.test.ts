import { describe, expect, it } from 'vitest'
import {
  buildKitchenSavePlan,
  canLaunchKitchenProduction,
  describeKitchenError,
  groupKitchenItems,
  isEmptyKitchenSavePlan,
  isKitchenDateOpen,
  kitchenStoresForUser,
  normalizeKitchenStore,
  sanitizeKitchenQuantity,
  shiftDateKey,
  totalKitchenQuantity,
  type KitchenEntry,
} from './kitchenProduction'

const entry = (overrides: Partial<KitchenEntry> & Pick<KitchenEntry, 'id' | 'product_id' | 'quantity'>): KitchenEntry => ({
  recorded_by_name: 'Cozinha',
  updated_at: '2026-07-22T18:00:00Z',
  ...overrides,
})

describe('kitchenStoresForUser', () => {
  it('libera só a loja concedida', () => {
    const stores = kitchenStoresForUser([
      { permission_key: 'producao_cozinha.lancar', scope: 'jc' },
    ], false)

    expect(stores).toEqual(['jc'])
  })

  it('escopo curinga vale para as três lojas', () => {
    const stores = kitchenStoresForUser([
      { permission_key: 'producao_cozinha.lancar', scope: '*' },
    ], false)

    expect(stores).toEqual(['jc', 'ja', 'ex'])
  })

  it('ignora permissão de outro módulo', () => {
    const stores = kitchenStoresForUser([
      { permission_key: 'romaneio.criar', scope: '*' },
    ], false)

    expect(stores).toEqual([])
  })

  it('administrador alcança todas as lojas sem concessão explícita', () => {
    expect(kitchenStoresForUser([], true)).toEqual(['jc', 'ja', 'ex'])
  })
})

describe('canLaunchKitchenProduction', () => {
  const permissions = [{ permission_key: 'producao_cozinha.lancar', scope: 'jc' }]

  it('permite lançar na loja concedida', () => {
    expect(canLaunchKitchenProduction(permissions, 'jc', false)).toBe(true)
  })

  it('bloqueia lançamento em outra loja', () => {
    expect(canLaunchKitchenProduction(permissions, 'ja', false)).toBe(false)
  })

  it('bloqueia quem não tem a permissão', () => {
    expect(canLaunchKitchenProduction([], 'jc', false)).toBe(false)
  })

  it('bloqueia loja desconhecida mesmo para administrador', () => {
    expect(canLaunchKitchenProduction([], 'pj', true)).toBe(false)
  })
})

describe('sanitizeKitchenQuantity', () => {
  it('corta fração, negativo e texto', () => {
    expect(sanitizeKitchenQuantity(7.9)).toBe(7)
    expect(sanitizeKitchenQuantity(-3)).toBe(0)
    expect(sanitizeKitchenQuantity('abc')).toBe(0)
    expect(sanitizeKitchenQuantity(null)).toBe(0)
  })

  it('respeita o mesmo teto do banco', () => {
    expect(sanitizeKitchenQuantity(5000)).toBe(999)
  })
})

describe('isKitchenDateOpen', () => {
  it('aceita hoje e ontem', () => {
    expect(isKitchenDateOpen('2026-07-22', '2026-07-22')).toBe(true)
    expect(isKitchenDateOpen('2026-07-21', '2026-07-22')).toBe(true)
  })

  it('recusa anteontem e datas futuras', () => {
    expect(isKitchenDateOpen('2026-07-20', '2026-07-22')).toBe(false)
    expect(isKitchenDateOpen('2026-07-23', '2026-07-22')).toBe(false)
  })

  it('atravessa a virada de mês', () => {
    expect(isKitchenDateOpen('2026-06-30', '2026-07-01')).toBe(true)
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('buildKitchenSavePlan', () => {
  const base = {
    store: 'jc' as const,
    recordDate: '2026-07-22',
    recordedBy: 'user-1',
    recordedByName: 'Cozinha JC',
  }

  it('grava apenas o item novo', () => {
    const plan = buildKitchenSavePlan({
      ...base,
      quantities: { 'prod-a': 6, 'prod-b': 0 },
      entries: [],
    })

    expect(plan.upserts).toEqual([{
      store: 'jc',
      product_id: 'prod-a',
      record_date: '2026-07-22',
      quantity: 6,
      recorded_by: 'user-1',
      recorded_by_name: 'Cozinha JC',
    }])
    expect(plan.deleteIds).toEqual([])
  })

  it('ignora item que não mudou', () => {
    const plan = buildKitchenSavePlan({
      ...base,
      quantities: { 'prod-a': 6 },
      entries: [entry({ id: 'row-1', product_id: 'prod-a', quantity: 6 })],
    })

    expect(isEmptyKitchenSavePlan(plan)).toBe(true)
  })

  it('atualiza a quantidade corrigida', () => {
    const plan = buildKitchenSavePlan({
      ...base,
      quantities: { 'prod-a': 8 },
      entries: [entry({ id: 'row-1', product_id: 'prod-a', quantity: 6 })],
    })

    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].quantity).toBe(8)
    expect(plan.deleteIds).toEqual([])
  })

  it('apaga o lançamento zerado em vez de gravar zero', () => {
    const plan = buildKitchenSavePlan({
      ...base,
      quantities: { 'prod-a': 0 },
      entries: [entry({ id: 'row-1', product_id: 'prod-a', quantity: 6 })],
    })

    expect(plan.upserts).toEqual([])
    expect(plan.deleteIds).toEqual(['row-1'])
  })

  it('não deixa passar quantidade fora do limite aceito pelo banco', () => {
    const plan = buildKitchenSavePlan({
      ...base,
      quantities: { 'prod-a': 4000 },
      entries: [],
    })

    expect(plan.upserts[0].quantity).toBe(999)
  })
})

describe('agrupamento e totais', () => {
  it('agrupa por categoria e usa Outros quando falta', () => {
    const groups = groupKitchenItems([
      { id: '1', name: 'Bruschetta Parma', category: 'Bruschettas', unit: 'un' },
      { id: '2', name: 'Pastinha de Frango', category: null, unit: 'pote' },
      { id: '3', name: 'Bruschetta Brie', category: 'Bruschettas', unit: 'un' },
    ])

    expect(groups).toEqual([
      { category: 'Bruschettas', items: [
        { id: '1', name: 'Bruschetta Parma', category: 'Bruschettas', unit: 'un' },
        { id: '3', name: 'Bruschetta Brie', category: 'Bruschettas', unit: 'un' },
      ] },
      { category: 'Outros', items: [
        { id: '2', name: 'Pastinha de Frango', category: null, unit: 'pote' },
      ] },
    ])
  })

  it('soma o total do dia ignorando lixo', () => {
    expect(totalKitchenQuantity({ a: 6, b: 4, c: -2 })).toBe(10)
  })
})

describe('describeKitchenError', () => {
  it('explica a tabela ausente em vez de culpar a internet', () => {
    expect(describeKitchenError({ code: 'PGRST205' })).toContain('liberada no banco')
    expect(describeKitchenError({ code: '42P01' })).toContain('liberada no banco')
    expect(describeKitchenError({ message: 'relation "public.kitchen_production" does not exist' }))
      .toContain('liberada no banco')
  })

  it('aponta a permissão quando o banco nega o acesso', () => {
    expect(describeKitchenError({ code: '42501' })).toContain('Produção da Cozinha')
  })

  it('cai na mensagem de rede só quando não sabe a causa', () => {
    expect(describeKitchenError(new Error('Failed to fetch'))).toContain('internet')
    expect(describeKitchenError(null)).toContain('internet')
  })
})

describe('normalizeKitchenStore', () => {
  it('aceita as três lojas reais e recusa o resto', () => {
    expect(normalizeKitchenStore('JC')).toBe('jc')
    expect(normalizeKitchenStore(' ja ')).toBe('ja')
    expect(normalizeKitchenStore('pj')).toBeNull()
    expect(normalizeKitchenStore(null)).toBeNull()
  })
})
