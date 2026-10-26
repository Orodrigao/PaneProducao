import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { PjLaunchRefusedError, type PjLaunchCatalog, type PjLaunchItem } from './pjExpeditionLaunch'
import {
  cancelPjOrderByExpedition,
  describePjOrderHistoryEntry,
  parsePjExpeditionOrderState,
  pjCancelReasonProblem,
  pjPacksFromQuantity,
  replacePjOrderByExpedition,
  restorePjExpeditionLines,
  type PjExpeditionOrder,
} from './pjExpeditionOrderChange'

const pao: PjLaunchItem = {
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
  ...pao,
  productSource: 'product',
  productId: 'brioche',
  saleOptionId: 'hamburguer-kg',
  productName: 'Brioche',
  saleOptionName: 'Hamburguer kg',
  pricingUnit: 'kg',
  packRuleSize: 12,
  packRuleMin: 1,
  packRuleMultiple: 1,
  unitWeightKg: 0.08,
}

const order: PjExpeditionOrder = {
  customerId: 'c1',
  customerName: 'Bistrô',
  deliveryDate: '2026-10-28',
  obs: 'Entregar cedo',
  expectedRows: [{ id: 'r1', updated_at: '2026-10-26T12:00:00Z' }, { id: 'r2', updated_at: '2026-10-26T12:00:00Z' }],
  lines: [
    { productSource: 'bread', productId: 'pao-a', saleOptionId: null, productName: 'Pão A', quantity: 3, unit: 'un' },
    { productSource: 'product', productId: 'brioche', saleOptionId: 'hamburguer-kg', productName: 'Brioche', quantity: 1.92, unit: 'kg' },
  ],
}

const catalog = (items: PjLaunchItem[]): PjLaunchCatalog => ({
  today: '2026-10-26',
  customers: [{ id: 'c1', name: 'Bistrô', blockedReason: null }],
  items,
})

describe('leitura do pedido para corrigir', () => {
  const body = {
    order_group_id: 'g1',
    history: [{ action: 'create_expedition', by_name: 'Rafaela', by_me: true, at: '2026-10-26T12:00:00Z' }],
    can_change: true,
    change_blocked_reason: null,
    order: {
      customer_id: 'c1', customer_name: 'Bistrô', delivery_date: '2026-10-28', obs: null,
      expected_rows: [{ id: 'r1', updated_at: '2026-10-26T12:00:00Z' }],
      lines: [{ product_source: 'bread', product_id: 'pao-a', sale_option_id: null, product_name: 'Pão A', quantity: 3, unit: 'un' }],
    },
  }

  it('lê autoria, versão e linhas sem preço', () => {
    const state = parsePjExpeditionOrderState(body)
    expect(state.canChange).toBe(true)
    expect(state.order?.obs).toBe('')
    expect(state.order?.expectedRows).toEqual([{ id: 'r1', updated_at: '2026-10-26T12:00:00Z' }])
    expect(state.history[0]).toEqual({ action: 'create_expedition', byName: 'Rafaela', byMe: true, at: '2026-10-26T12:00:00Z' })
  })

  it('pedido que não pode mais mudar chega com o motivo e sem formulário', () => {
    const state = parsePjExpeditionOrderState({ ...body, can_change: false, order: null,
      change_blocked_reason: 'A conferência deste pedido já começou.' })
    expect(state.order).toBeNull()
    expect(state.changeBlockedReason).toBe('A conferência deste pedido já começou.')
  })

  it('recusa resposta que libera a correção sem o pedido', () => {
    expect(() => parsePjExpeditionOrderState({ ...body, order: null })).toThrow('Resposta incompleta')
  })
})

describe('reabrir as linhas no formulário', () => {
  it('converte a quantidade gravada de volta em pacotes pelo cadastro atual', () => {
    expect(pjPacksFromQuantity(pao, 3)).toBe(3)
    expect(pjPacksFromQuantity(brioche, 1.92)).toBe(2)
    expect(pjPacksFromQuantity({ ...pao, pricingUnit: 'kg', packSize: 2.5 }, 5)).toBe(2)
  })

  it('pacote que mudou no cadastro reabre com número quebrado, que o formulário marca', () => {
    expect(pjPacksFromQuantity({ ...brioche, packRuleSize: 10 }, 1.92)).toBe(2.4)
  })

  it('reabre cada linha com o produto do catálogo e a quantidade em pacotes', () => {
    const restored = restorePjExpeditionLines(order, catalog([pao, brioche]))
    expect(restored.warnings).toEqual([])
    expect(restored.lines.map(line => [line.item.productId, line.raw])).toEqual([['pao-a', '3'], ['brioche', '2']])
  })

  it('produto fora da tabela ou bloqueado fica de fora com aviso, nunca escondido', () => {
    const restored = restorePjExpeditionLines(order, catalog([{ ...pao, blockedReason: 'Avise o Financeiro.' }]))
    expect(restored.lines).toEqual([])
    expect(restored.warnings).toEqual([
      'Pão A não está mais disponível na tabela do cliente e ficou fora da correção.',
      'Brioche não está mais disponível na tabela do cliente e ficou fora da correção.',
    ])
  })

  it('quantidade que não fecha com o pacote atual reabre vazia, nunca arredondada', () => {
    const quilo: PjExpeditionOrder = { ...order, lines: [
      { productSource: 'bread', productId: 'pao-a', saleOptionId: null, productName: 'Pão A', quantity: 1, unit: 'kg' },
    ] }
    // 1 kg com pacote novo de 3 kg: 0,333 pacote reenviaria 0,999 kg sem ninguém digitar.
    const restored = restorePjExpeditionLines(quilo, catalog([{ ...pao, pricingUnit: 'kg', packSize: 3 }]))
    expect(restored.lines.map(line => line.raw)).toEqual([''])
    expect(restored.warnings).toEqual([
      'O pacote de Pão A mudou no cadastro e a quantidade anterior (1 kg) não fecha com ele. Informe a quantidade de novo.',
    ])
    // Pacote de 2,5 kg e 5 kg gravados fecham em 2 pacotes exatos.
    expect(restorePjExpeditionLines({ ...quilo, lines: [{ ...quilo.lines[0], quantity: 5 }] },
      catalog([{ ...pao, pricingUnit: 'kg', packSize: 2.5 }])).lines[0].raw).toBe('2')
  })

  it('unidade trocada no cadastro reabre a linha vazia, para a quantidade ser digitada de novo', () => {
    const restored = restorePjExpeditionLines(order, catalog([{ ...pao, pricingUnit: 'kg' }, brioche]))
    expect(restored.lines[0].raw).toBe('')
    expect(restored.warnings).toEqual(['A unidade de Pão A mudou no cadastro. Informe a quantidade de novo.'])
  })
})

describe('histórico e motivo', () => {
  it('diz quem fez o quê, sem repetir o selo de origem, e mostra a chave crua de uma ação nova', () => {
    const at = '2026-10-26T15:00:00Z'
    expect(describePjOrderHistoryEntry({ action: 'replace_expedition', byName: 'Rafaela', byMe: false, at }))
      .toMatch(/^Rafaela corrigiu pela Expedição · /)
    expect(describePjOrderHistoryEntry({ action: 'create_expedition', byName: 'Rafaela', byMe: true, at }))
      .toMatch(/^Você lançou pela Expedição · /)
    expect(describePjOrderHistoryEntry({ action: 'acao_nova', byName: 'Elis', byMe: false, at }))
      .toMatch(/^Elis acao_nova · /)
  })

  it('motivo do cancelamento tem de 3 a 500 caracteres', () => {
    expect(pjCancelReasonProblem('  ok ')).toBe('Informe o motivo do cancelamento, com pelo menos 3 letras.')
    expect(pjCancelReasonProblem('Cliente desistiu')).toBeNull()
    expect(pjCancelReasonProblem('x'.repeat(501))).toBe('O motivo passa de 500 caracteres.')
  })
})

describe('resposta do banco', () => {
  beforeEach(() => rpc.mockReset())
  const request = { deliveryDate: '2026-10-29', obs: '', lines: [{ product_source: 'bread', product_id: 'pao-a',
    packs: 5, quantity: 5, unit: 'un' as const, pack_units: null }] }

  it('a correção envia só data, observação, linhas e a versão lida', async () => {
    rpc.mockResolvedValue({ data: { order_group_id: 'g1', repeated: false }, error: null })
    await replacePjOrderByExpedition({ requestId: 'req' }, 'g1', request, order.expectedRows)
    expect(rpc).toHaveBeenCalledWith('replace_pj_order_by_expedition', {
      p_request_id: 'req', p_order_group_id: 'g1', p_delivery_date: '2026-10-29', p_obs: '',
      p_lines: request.lines, p_expected_rows: order.expectedRows,
    })
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/price|valor/)
  })

  it('recusa com a dica prova que nada gravou; versão velha também', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'O pedido mudou.', hint: 'pj-launch-not-saved' } })
    const error = await replacePjOrderByExpedition({ requestId: 'req' }, 'g1', request, []).catch(e => e)
    expect(error).toBeInstanceOf(PjLaunchRefusedError)
    expect(error.notSaved).toBe(true)
  })

  it('acesso retirado é recusa sem a dica, com mensagem própria', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sem permissao', hint: '' } })
    const error = await cancelPjOrderByExpedition({ requestId: 'req' }, 'g1', 'Cliente desistiu').catch(e => e)
    expect(error).toBeInstanceOf(PjLaunchRefusedError)
    expect(error.notSaved).toBe(false)
    expect(error.message).toBe('Seu acesso não permite cancelar Pedido PJ. Peça ao administrador.')
  })

  it('falha de rede pede repetir a mesma tentativa', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } })
    const failure = cancelPjOrderByExpedition({ requestId: 'req' }, 'g1', 'Cliente desistiu')
    await expect(failure).rejects.not.toBeInstanceOf(PjLaunchRefusedError)
    await expect(failure).rejects.toThrow(/o mesmo pedido não é cancelado duas vezes/)
  })

  it('resposta de outro pedido não conta como cancelada', async () => {
    rpc.mockResolvedValue({ data: { order_group_id: 'outro' }, error: null })
    await expect(cancelPjOrderByExpedition({ requestId: 'req' }, 'g1', 'Cliente desistiu'))
      .rejects.not.toBeInstanceOf(PjLaunchRefusedError)
  })
})
