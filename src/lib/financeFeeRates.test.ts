import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { supabase } from './supabase'
import { buildFeeRateRequest, feeRateErrorMessage, formatFeeRate, parseFeeRate, loadFinanceFeeRates, saveFinanceFeeRate, feeRateImpact, feeRateAppliedImpact, type FinanceFeeRates } from './financeFeeRates'
const draft = { method: 'stone' as const, rate: '3,5125', validFrom: '2026-09-01', expectedLatestId: 'old' }
describe('taxas do fechamento', () => {
  it('preserva quatro casas e distingue vazio de zero', () => {
    expect(parseFeeRate('3,5125%')).toBe(3.5125)
    expect(parseFeeRate('')).toBeNull()
    expect(parseFeeRate('0')).toBe(0)
    expect(formatFeeRate(null)).toBe('Não informada')
    expect(formatFeeRate(0)).toBe('0%')
    expect(formatFeeRate(3.51)).toBe('3,51%')
  })
  it.each(['-1', '100,0001', '3,12345', 'NaN', '1.000,00', 'abc'])('recusa %s sem arredondar', raw => {
    expect(() => parseFeeRate(raw)).toThrow()
  })
  it('monta o envio com versão otimista e chave do pedido', () => {
    expect(buildFeeRateRequest(draft, 'request', '2026-09-01')).toEqual({ p_request_id: 'request', p_method: 'stone', p_rate: 3.5125, p_valid_from: '2026-09-01', p_expected_latest_id: 'old' })
  })
  it.each(['2026-08-31', '2026-02-30', '2026-13-01', ''])('recusa vigência %s', validFrom => {
    expect(() => buildFeeRateRequest({ ...draft, validFrom }, 'request', '2026-09-01')).toThrow()
  })
  it('traduz atualização, conflito, permissão e preserva recusa do banco', () => {
    expect(feeRateErrorMessage({ code: 'PGRST202' })).toContain('atualização do sistema terminar')
    expect(feeRateErrorMessage({ status: 404 })).toContain('atualização do sistema terminar')
    expect(feeRateErrorMessage({ code: 'PT409' })).toContain('Recarregue')
    expect(feeRateErrorMessage({ code: '42501' })).toContain('Sem permissão')
    expect(feeRateErrorMessage({ code: '42501', message: 'Sem permissão para consultar as taxas.' })).toBe('Sem permissão para consultar as taxas.')
    expect(feeRateErrorMessage({ code: '22023', message: 'Vigência inválida' })).toBe('Vigência inválida.')
  })
  it('lê o painel completo e envia RPC sem perder percentual', async () => {
    const panel = { can_edit: true, bridge: { enabled: true, start_date: '2026-09-01' }, methods: [], history: [], pending: [] }
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: panel, error: null } as never)
    expect(await loadFinanceFeeRates()).toEqual(panel)
    expect(supabase.rpc).toHaveBeenCalledWith('get_finance_fee_rates')
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { fees_created: 1 }, error: null } as never)
    expect(await saveFinanceFeeRate(draft, 'request', '2026-09-01')).toEqual({ fees_created: 1 })
    expect(supabase.rpc).toHaveBeenLastCalledWith('save_finance_fee_rate', expect.objectContaining({ p_rate: 3.5125, p_expected_latest_id: 'old' }))
  })
  it('calcula impacto por meio desde o mês de vigência com lojas e meses fora da janela', () => {
    const panel = {
      can_edit: true, bridge: { enabled: true, start_date: '2026-09-01' }, methods: [], history: [],
      pending: [
        { method: 'stone' as const, store: 'jc' as const, competence_month: '2026-09-01', amount: 100, quantity: 1 },
        { method: 'stone' as const, store: 'ja' as const, competence_month: '2026-10-01', amount: 200, quantity: 2 },
        { method: 'banrisul' as const, store: 'jc' as const, competence_month: '2026-10-01', amount: 900, quantity: 1 },
      ],
    }
    expect(feeRateImpact(panel, 'stone', '2026-09-15')).toEqual({
      upperBound: true, amount: 300, stores: 'JA e JC', months: 'setembro de 2026 e outubro de 2026',
    })
    expect(feeRateImpact(panel, 'stone', '2026-10-01')).toEqual({
      upperBound: false, amount: 200, stores: 'JA', months: 'outubro de 2026',
    })
    expect(feeRateImpact(panel, 'stone', '2026-11-01')).toEqual({ upperBound: false, amount: 0, stores: '', months: '' })
  })
  const pendingPanel: FinanceFeeRates = {
    can_edit: true, bridge: { enabled: true, start_date: '2026-09-01' }, methods: [], history: [],
    pending: [
      { method: 'stone', store: 'jc', competence_month: '2026-08-01', amount: 50, quantity: 1 },
      { method: 'stone', store: 'jc', competence_month: '2026-09-01', amount: 100, quantity: 2 },
      { method: 'stone', store: 'ja', competence_month: '2026-09-01', amount: 200, quantity: 2 },
      { method: 'stone', store: 'ja', competence_month: '2026-10-01', amount: 400, quantity: 1 },
      { method: 'pix', store: 'jc', competence_month: '2026-09-01', amount: 900, quantity: 1 },
    ],
  }
  it('dia 1 sem próxima versão é exato e exclui mês anterior e outro meio', () => {
    expect(feeRateImpact(pendingPanel, 'stone', '2026-09-01')).toEqual({
      amount: 700, stores: 'JA e JC', months: 'setembro de 2026 e outubro de 2026', upperBound: false,
    })
  })
  it('usa a próxima vigência do mesmo meio, mesmo com histórico fora de ordem', () => {
    const version = { id: 'v', method: 'stone' as const, rate: 3, valid_from: '2026-11-01', author_name: 'Teste', created_at: '' }
    const panel = { ...pendingPanel, history: [version,
      { ...version, method: 'pix' as const, valid_from: '2026-09-02' },
      { ...version, valid_from: '2026-10-01' },
      { ...version, valid_from: '2026-09-01' },
    ] }
    expect(feeRateImpact(panel, 'stone', '2026-09-01')).toEqual({
      amount: 300, stores: 'JA e JC', months: 'setembro de 2026', upperBound: false,
    })
    panel.history = [{ ...version, valid_from: '2026-10-15' }]
    expect(feeRateImpact(panel, 'stone', '2026-09-01')).toMatchObject({ amount: 700, upperBound: true })
  })
  it('compara pendências relidas, incluindo redução parcial, sem repetir meses inalterados', () => {
    const after = { ...pendingPanel, pending: pendingPanel.pending
      .filter(row => !(row.method === 'stone' && row.store === 'ja' && row.competence_month === '2026-09-01'))
      .map(row => row.method === 'stone' && row.competence_month === '2026-09-01'
        ? { ...row, amount: 40, quantity: 1 } : row) }
    expect(feeRateAppliedImpact(pendingPanel, after, 'stone')).toEqual({
      amount: 260, stores: 'JA e JC', months: 'setembro de 2026',
    })
    expect(feeRateAppliedImpact(pendingPanel, pendingPanel, 'stone')).toEqual({ amount: 0, stores: '', months: '' })
    expect(feeRateAppliedImpact(after, pendingPanel, 'stone')).toEqual({ amount: 0, stores: '', months: '' })
  })
  it('propaga status HTTP da função ausente', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'missing' }, status: 404 } as never)
    await expect(loadFinanceFeeRates()).rejects.toMatchObject({ status: 404 })
  })
})
