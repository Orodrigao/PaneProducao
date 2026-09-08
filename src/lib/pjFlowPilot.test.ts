import { describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { discoverPjFlowPilot, parsePjFlowQuantity, pjFlowStatus, readPjFlowPilot, transitionPjFlowPilot, type PjFlow } from './pjFlowPilot'

describe('preparação da jornada PJ', () => {
  it('descoberta preserva rotina anterior somente quando contrato ou acesso não existem', async () => {
    for (const code of ['PGRST202', '42501']) {
      rpc.mockReset().mockResolvedValue({ data: null, error: { code } })
      await expect(discoverPjFlowPilot()).resolves.toEqual([])
    }
    rpc.mockReset().mockResolvedValue({ data: null, error: { code: '503' } })
    await expect(discoverPjFlowPilot()).rejects.toThrow('Não foi possível identificar')
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
    await expect(discoverPjFlowPilot()).rejects.toThrow('Resposta incompleta')
  })
  it('distingue campo vazio de zero e rejeita entradas ambíguas', () => {
    expect(parsePjFlowQuantity('')).toBeNull()
    expect(parsePjFlowQuantity('0')).toBe(0)
    expect(parsePjFlowQuantity('3,120')).toBe(3.12)
    for (const value of ['-1', 'NaN', 'Infinity', '1e3', '1.000,50', '1.0001']) {
      expect(() => parsePjFlowQuantity(value)).toThrow()
    }
  })
  it('correção que retirou a liberação volta a bloquear saída', () => {
    expect(pjFlowStatus({ checked_at: null, released_at: null, departed_at: null })).toContain('saída bloqueada')
    expect(pjFlowStatus({ checked_at: 'x', released_at: null, departed_at: null })).toContain('Elis')
    expect(pjFlowStatus({ checked_at: 'x', released_at: 'x', departed_at: null })).toContain('Liberado')
    expect(pjFlowStatus({ checked_at: 'x', released_at: 'x', departed_at: 'x' })).toBe('Saída física registrada')
  })
  it('banco antigo fica indisponível sem tentar o despacho antigo', async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'function not found' } })
    await expect(readPjFlowPilot()).rejects.toThrow('Nenhuma ação do fluxo antigo')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['read_pj_flow_pilot'])
  })
  it('não aceita uma ficha incompleta para agir', async () => {
    rpc.mockReset().mockResolvedValue({ data: [{ id: 'pedido', version: 1 }], error: null })
    await expect(readPjFlowPilot()).rejects.toThrow('Resposta incompleta')
  })
  it('repetição preserva pedido, versão, prazo e identificador da revisão', async () => {
    rpc.mockReset().mockResolvedValue({ data: {}, error: null })
    const flow = { id: 'pedido', version: 3, payment_term_days: 7 } as PjFlow
    await transitionPjFlowPilot(flow, 'release', 'mesma-tentativa', [], true)
    await transitionPjFlowPilot(flow, 'release', 'mesma-tentativa', [], true)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_version: 3, p_review_term_days: 7, p_nf_confirmed: true })
  })
  it('envia crédito separado do valor dos produtos e não inventa crédito nas outras etapas', async () => {
    rpc.mockReset().mockResolvedValue({ data: {}, error: null })
    const flow = { id: 'pedido', version: 3, payment_term_days: 7 } as PjFlow
    await transitionPjFlowPilot(flow, 'release', 'credito', [], true,
      { amount: 20, sourceGroupId: 'origem', reason: 'Crédito aceito pelo cliente' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_credit_amount: 20,
      p_credit_source_group_id: 'origem', p_credit_reason: 'Crédito aceito pelo cliente' })
    await transitionPjFlowPilot(flow, 'check', 'sem-credito', [], false)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_credit_amount: 0,
      p_credit_source_group_id: null, p_credit_reason: null })
  })
})
