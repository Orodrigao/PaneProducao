import { describe, expect, it } from 'vitest'
import {
  buildKitchenBatchRequests,
  buildKitchenDaySummary,
  canLaunchKitchenProduction,
  describeKitchenError,
  groupKitchenItems,
  isEmptyKitchenBatchRequest,
  isKitchenDateOpen,
  kitchenStoresForUser,
  kitchenTotalsByProduct,
  normalizeKitchenStore,
  sanitizeKitchenQuantity,
  shiftDateKey,
  totalKitchenQuantity,
  type KitchenEntry,
} from './kitchenProduction'

const entry = (
  overrides: Partial<KitchenEntry> & Pick<KitchenEntry, 'id' | 'product_id' | 'quantity'>,
): KitchenEntry => ({
  recorded_by: 'user-1',
  recorded_by_name: 'Cozinha',
  produced_at: '2026-07-22T18:00:00Z',
  corrected_at: null,
  corrected_by: null,
  cancelled_at: null,
  cancelled_by: null,
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

describe('buildKitchenBatchRequests', () => {
  it('cada salvamento gera somente os novos lotes informados', () => {
    const firstSave = buildKitchenBatchRequests({
      quantities: { 'prod-a': 4, 'prod-b': 0 },
    })
    const secondSave = buildKitchenBatchRequests({
      quantities: { 'prod-a': 3, 'prod-b': 0 },
    })

    expect(firstSave).toEqual([{ product_id: 'prod-a', quantity: 4 }])
    expect(secondSave).toEqual([{ product_id: 'prod-a', quantity: 3 }])
  })

  it('ignora zero e limita cada lote ao teto aceito pelo banco', () => {
    const batches = buildKitchenBatchRequests({
      quantities: { zero: 0, negative: -2, maximum: 4000 },
    })

    expect(batches).toEqual([{ product_id: 'maximum', quantity: 999 }])
    expect(isEmptyKitchenBatchRequest([])).toBe(true)
  })
})

describe('kitchenTotalsByProduct', () => {
  it('soma lotes independentes e desconsidera os cancelados', () => {
    const totals = kitchenTotalsByProduct([
      entry({ id: 'row-1', product_id: 'prod-a', quantity: 4 }),
      entry({ id: 'row-2', product_id: 'prod-a', quantity: 3 }),
      entry({
        id: 'row-3',
        product_id: 'prod-a',
        quantity: 8,
        cancelled_at: '2026-07-22T19:00:00Z',
        cancelled_by: 'user-1',
      }),
      entry({ id: 'row-4', product_id: 'prod-b', quantity: 2 }),
    ])

    expect(totals).toEqual({ 'prod-a': 7, 'prod-b': 2 })
  })

  it('a correção muda a quantidade sem apagar o horário original', () => {
    const corrected = entry({
      id: 'row-1',
      product_id: 'prod-a',
      quantity: 5,
      produced_at: '2026-07-22T18:00:00Z',
      corrected_at: '2026-07-22T18:15:00Z',
      corrected_by: 'user-1',
    })

    expect(kitchenTotalsByProduct([corrected])).toEqual({ 'prod-a': 5 })
    expect(corrected.produced_at).toBe('2026-07-22T18:00:00Z')
  })
})

describe('buildKitchenDaySummary', () => {
  it('mostra o que foi produzido por produto e ignora lotes cancelados', () => {
    const summary = buildKitchenDaySummary(
      [
        { id: 'prod-a', name: 'Bruschetta Caprese', category: 'Bruschettas', unit: 'un' },
        { id: 'prod-b', name: 'Pastinha de Frango', category: 'Pastinhas', unit: 'pote' },
      ],
      [
        entry({ id: 'row-1', product_id: 'prod-a', quantity: 4 }),
        entry({ id: 'row-2', product_id: 'prod-a', quantity: 3 }),
        entry({
          id: 'row-3',
          product_id: 'prod-a',
          quantity: 8,
          cancelled_at: '2026-07-22T19:00:00Z',
          cancelled_by: 'user-1',
        }),
        entry({ id: 'row-4', product_id: 'prod-b', quantity: 2 }),
      ],
    )

    expect(summary).toEqual([
      { product_id: 'prod-a', name: 'Bruschetta Caprese', unit: 'un', quantity: 7 },
      { product_id: 'prod-b', name: 'Pastinha de Frango', unit: 'pote', quantity: 2 },
    ])
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

  it('soma o total dos campos ignorando lixo', () => {
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
