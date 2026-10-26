import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import {
  buildPjLaunchRequest,
  clearPjLaunchPending,
  createPjOrderByExpedition,
  describePjLaunchOrigin,
  PjLaunchRefusedError,
  pjLaunchPhysicalQuantity,
  readPjLaunchPendings,
  savePjLaunchPending,
  describePjLaunchQuantity,
  hasSimilarPjOrder,
  parsePjLaunchCatalog,
  parsePjLaunchQuantity,
  pjLaunchLineProblem,
  type PjLaunchItem,
} from './pjExpeditionLaunch'

const base: PjLaunchItem = {
  customerId: 'c1',
  productSource: 'bread',
  productId: 'pao-a',
  saleOptionId: null,
  productName: 'Pão A',
  saleOptionName: null,
  pricingUnit: 'un',
  packSize: 1,
  packRuleSize: null,
  packRuleMin: null,
  packRuleMultiple: null,
  unitWeightKg: null,
  blockedReason: null,
}

const brioche: PjLaunchItem = {
  ...base,
  productSource: 'product',
  productId: 'brioche',
  saleOptionId: 'hamburguer-kg',
  productName: 'Brioche',
  saleOptionName: 'Hamburguer kg',
  pricingUnit: 'kg',
  packRuleSize: 12,
  packRuleMin: 2,
  packRuleMultiple: 2,
  unitWeightKg: 0.08,
}

describe('catálogo da Expedição', () => {
  const row = {
    customer_id: 'c1', product_source: 'bread', product_id: 'pao-a', sale_option_id: null,
    product_name: 'Pão A', sale_option_name: null, pricing_unit: 'un', pack_size: 1,
    pack_rule_size: null, pack_rule_min: null, pack_rule_multiple: null, unit_weight_kg: null, blocked_reason: null,
  }

  it('lê clientes e produtos sem nenhum campo de preço', () => {
    const catalog = parsePjLaunchCatalog({
      today: '2026-10-26',
      customers: [{ id: 'c1', name: 'Cliente', blocked_reason: null }],
      items: [row],
    })
    expect(catalog.items[0]).toEqual(base)
    expect(JSON.stringify(catalog)).not.toMatch(/price/i)
  })

  it('recusa resposta incompleta em vez de montar a tela pela metade', () => {
    expect(() => parsePjLaunchCatalog({ today: '2026-10-26', customers: [] })).toThrow(/incompleta/)
    expect(() => parsePjLaunchCatalog({ today: '2026-10-26', customers: [], items: [{ ...row, pack_size: 0 }] }))
      .toThrow(/incompleta/)
    expect(() => parsePjLaunchCatalog({ today: '2026-10-26', customers: [], items: [{ ...row, pricing_unit: 'cx' }] }))
      .toThrow(/incompleta/)
  })
})

describe('quantidade digitada', () => {
  it('pacote fechado e unidade aceitam só inteiros, sem arredondar', () => {
    expect(parsePjLaunchQuantity('4', brioche)).toBe(4)
    expect(parsePjLaunchQuantity('1,5', brioche)).toBeNull()
    expect(parsePjLaunchQuantity('3', base)).toBe(3)
    expect(parsePjLaunchQuantity('2.5', base)).toBeNull()
    expect(parsePjLaunchQuantity('0', base)).toBeNull()
    expect(parsePjLaunchQuantity('-1', base)).toBeNull()
  })

  it('quilo sem pacote fechado aceita até três casas, com vírgula', () => {
    const kg = { ...base, pricingUnit: 'kg' as const }
    expect(parsePjLaunchQuantity('2,5', kg)).toBe(2.5)
    expect(parsePjLaunchQuantity('0,125', kg)).toBe(0.125)
    expect(parsePjLaunchQuantity('0,1234', kg)).toBeNull()
    expect(parsePjLaunchQuantity('0', kg)).toBeNull()
  })
})

describe('o que a Expedição vê em cada linha', () => {
  it('mostra pacotes, unidades e quilos do pacote fechado (2 x 12 x 80 g = 1,92 kg)', () => {
    expect(describePjLaunchQuantity(brioche, 2)).toBe('2 pacotes = 24 unidades = 1,92 kg')
  })

  it('mostra unidades ou quilos quando não há pacote', () => {
    expect(describePjLaunchQuantity(base, 3)).toBe('3 unidades')
    expect(describePjLaunchQuantity(base, 1)).toBe('1 unidade')
    expect(describePjLaunchQuantity({ ...base, pricingUnit: 'kg' }, 2.5)).toBe('2,5 kg')
    expect(describePjLaunchQuantity({ ...base, packSize: 6 }, 2)).toBe('2 pacotes = 12 unidades')
  })

  it('antecipa mínimo e múltiplo do pacote fechado', () => {
    expect(pjLaunchLineProblem(brioche, 1)).toBe('O mínimo deste produto é 2 pacotes.')
    expect(pjLaunchLineProblem(brioche, 3)).toBe('Este produto sai em múltiplos de 2 pacotes.')
    expect(pjLaunchLineProblem(brioche, 4)).toBeNull()
    expect(pjLaunchLineProblem(base, null)).toBe('Informe um número inteiro maior que zero.')
    expect(pjLaunchLineProblem({ ...base, blockedReason: 'Avise o Financeiro.' }, 1)).toBe('Avise o Financeiro.')
  })
})

describe('envio', () => {
  it('manda só produto e pacotes, nunca preço nem pacote da tabela', () => {
    const request = buildPjLaunchRequest('c1', '2026-10-28', '  Entregar cedo ', [
      { item: base, packs: 3 },
      { item: brioche, packs: 4 },
    ])
    expect(request).toEqual({
      customerId: 'c1',
      deliveryDate: '2026-10-28',
      obs: 'Entregar cedo',
      lines: [
        { product_source: 'bread', product_id: 'pao-a', packs: 3, quantity: 3, unit: 'un', pack_units: null },
        { product_source: 'product', product_id: 'brioche', sale_option_id: 'hamburguer-kg', packs: 4, quantity: 3.84, unit: 'kg', pack_units: 12 },
      ],
    })
  })

  it('a quantidade física enviada segue a mesma conta do banco', () => {
    expect(pjLaunchPhysicalQuantity(brioche, 2)).toBe(1.92)
    expect(pjLaunchPhysicalQuantity({ ...brioche, pricingUnit: 'un' }, 2)).toBe(24)
    expect(pjLaunchPhysicalQuantity({ ...base, pricingUnit: 'kg' }, 0.125)).toBe(0.125)
    expect(pjLaunchPhysicalQuantity({ ...base, packSize: 6 }, 2)).toBe(12)
    expect(pjLaunchPhysicalQuantity({ ...brioche, unitWeightKg: null }, 2)).toBeNull()
    expect(pjLaunchLineProblem({ ...brioche, unitWeightKg: null }, 2)).toMatch(/peso da unidade/)
  })

  it('cada tentativa pendente fica guardada à parte, para duas abas não se apagarem', () => {
    const memoria = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() { return memoria.size },
      key: (index: number) => Array.from(memoria.keys())[index] ?? null,
      getItem: (key: string) => memoria.get(key) ?? null,
      setItem: (key: string, value: string) => { memoria.set(key, value) },
      removeItem: (key: string) => { memoria.delete(key) },
    })
    const request = buildPjLaunchRequest('c1', '2026-10-28', '', [{ item: base, packs: 3 }])
    savePjLaunchPending('u1', { attempt: { requestId: 'a', orderGroupId: 'ga' }, request, customerName: 'Cliente' })
    savePjLaunchPending('u1', { attempt: { requestId: 'b', orderGroupId: 'gb' }, request, customerName: 'Cliente' })
    savePjLaunchPending('u2', { attempt: { requestId: 'c', orderGroupId: 'gc' }, request, customerName: 'Cliente' })
    clearPjLaunchPending('u1', 'a')
    expect(readPjLaunchPendings('u1').map(pending => pending.attempt.requestId)).toEqual(['b'])
    vi.unstubAllGlobals()
  })

  it('avisa quando o aparelho não guarda a tentativa, para a tela não enviar o pedido', () => {
    vi.stubGlobal('localStorage', {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => undefined,
    })
    const request = buildPjLaunchRequest('c1', '2026-10-28', '', [{ item: base, packs: 3 }])
    const pending = { attempt: { requestId: 'a', orderGroupId: 'ga' }, request, customerName: 'Cliente' }
    expect(savePjLaunchPending('u1', pending)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('avisa pedido parecido ainda em andamento, ignorando o que já saiu', () => {
    const flows = [
      { customer: 'Bistrô Centro', delivery_date: '2026-10-28', departed_at: null },
      { customer: 'Café Sul', delivery_date: '2026-10-28', departed_at: '2026-10-28T10:00:00Z' },
    ]
    expect(hasSimilarPjOrder(flows, 'bistrô centro ', '2026-10-28')).toBe(true)
    expect(hasSimilarPjOrder(flows, 'Café Sul', '2026-10-28')).toBe(false)
    expect(hasSimilarPjOrder(flows, 'Bistrô Centro', '2026-10-29')).toBe(false)
  })

  describe('resposta do banco', () => {
    const attempt = { requestId: 'r1', orderGroupId: 'g1' }
    const request = buildPjLaunchRequest('c1', '2026-10-28', '', [{ item: base, packs: 3 }])
    beforeEach(() => rpc.mockReset())

    it('envia só o que a Expedição escolheu', async () => {
      rpc.mockResolvedValue({ data: { repeated: false, order_group_id: 'g1' }, error: null })
      await expect(createPjOrderByExpedition(attempt, request)).resolves.toEqual({ orderGroupId: 'g1', repeated: false })
      expect(rpc).toHaveBeenCalledWith('create_pj_order_by_expedition', {
        p_request_id: 'r1', p_order_group_id: 'g1', p_customer_id: 'c1', p_delivery_date: '2026-10-28',
        p_obs: '', p_lines: [{ product_source: 'bread', product_id: 'pao-a', packs: 3, quantity: 3, unit: 'un', pack_units: null }],
      })
    })

    it('recusa com a dica do contrato prova que nada gravou e libera corrigir', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Informe pacotes inteiros.', hint: 'pj-launch-not-saved' } })
      const failure = createPjOrderByExpedition(attempt, request)
      await expect(failure).rejects.toBeInstanceOf(PjLaunchRefusedError)
      await expect(failure).rejects.toThrow('Informe pacotes inteiros.')
      await expect(failure).rejects.toMatchObject({ notSaved: true })
    })

    it('recusa sem a dica não prova nada sobre a tentativa anterior', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sem permissao', hint: null } })
      await expect(createPjOrderByExpedition(attempt, request)).rejects.toMatchObject({ notSaved: false })
      rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
      await expect(createPjOrderByExpedition(attempt, request)).rejects.toMatchObject({ notSaved: false })
      rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Identificador ja usado para outra operacao.' } })
      await expect(createPjOrderByExpedition(attempt, request)).rejects.toMatchObject({ notSaved: false })
    })

    it('falha de rede pede repetir a mesma tentativa', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } })
      const failure = createPjOrderByExpedition(attempt, request)
      await expect(failure).rejects.not.toBeInstanceOf(PjLaunchRefusedError)
      await expect(failure).rejects.toThrow(/não é gravado duas vezes/)
    })
  })

  it('descreve a origem para quem lançou e para o Financeiro', () => {
    expect(describePjLaunchOrigin({ orderGroupId: 'g', launchedByName: 'expedicao', launchedByMe: true })).toBe('Lançado por você')
    expect(describePjLaunchOrigin({ orderGroupId: 'g', launchedByName: 'expedicao', launchedByMe: false }))
      .toBe('Lançado pela Expedição · expedicao')
  })
})
