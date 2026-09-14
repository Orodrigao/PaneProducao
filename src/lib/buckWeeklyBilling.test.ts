import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// O módulo cria o cliente Supabase ao ser importado; aqui ele é substituído.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import { supabase } from '@/lib/supabase'
import {
  BUCK_MAX_ADJUSTMENT_AMOUNT,
  BUCK_MAX_ADJUSTMENTS,
  buckAdjustmentAmount,
  buckAdjustmentsPayload,
  buckWeekBlock,
  buckWeekLabel,
  createBuckWeeklyReceivable,
  emptyBuckAdjustmentDraft,
  loadBuckWeeksToBill,
  summarizeBuckWeek,
  validateBuckAdjustment,
  validateBuckAdjustments,
  type BuckAdjustmentDraft,
} from './buckWeeklyBilling'

function ajuste(parcial: Partial<BuckAdjustmentDraft>): BuckAdjustmentDraft {
  return { ...emptyBuckAdjustmentDraft(parcial.kind ?? 'acerto'), ...parcial }
}

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
})

describe('valor do ajuste', () => {
  it('pão sem romaneio vale quantidade vezes preço, em centavos', () => {
    expect(buckAdjustmentAmount(ajuste({ kind: 'produto_sem_romaneio', quantity: '10', unitPrice: '1,50' }))).toBe(15)
    expect(buckAdjustmentAmount(ajuste({ kind: 'produto_sem_romaneio', quantity: '0,333', unitPrice: '38' }))).toBe(12.65)
  })

  it('preço combinado e acerto aceitam valor negativo', () => {
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: '-7,34' }))).toBe(-7.34)
    expect(buckAdjustmentAmount(ajuste({ kind: 'preco_combinado', amount: '12,34' }))).toBe(12.34)
  })

  it('ajuste incompleto ainda não tem valor', () => {
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: '' }))).toBeNull()
    expect(buckAdjustmentAmount(ajuste({ kind: 'produto_sem_romaneio', quantity: '2', unitPrice: '' }))).toBeNull()
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: 'dez reais' }))).toBeNull()
  })

  it('arredonda como o numeric do Postgres, sem erro de ponto flutuante', () => {
    // Em ponto flutuante 10,075 x 100 dá 1007,4999..., que arredondaria para 10,07.
    expect(buckAdjustmentAmount(ajuste({ kind: 'produto_sem_romaneio', quantity: '1', unitPrice: '10,075' }))).toBe(10.08)
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: '-10,075' }))).toBe(-10.08)
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: '1,005' }))).toBe(1.01)
    expect(buckAdjustmentAmount(ajuste({ kind: 'produto_sem_romaneio', quantity: '0,125', unitPrice: '1' }))).toBe(0.13)
  })

  it('número que não cabe numa conta exata é recusado em vez de arredondado errado', () => {
    expect(buckAdjustmentAmount(ajuste({ kind: 'acerto', amount: '1234567890123456' }))).toBeNull()
  })
})

describe('validação espelhando o banco', () => {
  it('motivo é obrigatório', () => {
    expect(validateBuckAdjustment(ajuste({ description: 'ok', amount: '10' }), 1))
      .toBe('Ajuste 1: descreva o motivo com 3 a 200 letras.')
  })

  it('valor zero ou acima de 5.000 é recusado, para mais ou para menos', () => {
    const recado = 'Ajuste 2: informe um valor diferente de zero, até R$ 5.000,00 para mais ou para menos.'
    expect(validateBuckAdjustment(ajuste({ description: 'Acerto', amount: '0' }), 2)).toBe(recado)
    expect(validateBuckAdjustment(ajuste({ description: 'Acerto', amount: '5000,01' }), 2)).toBe(recado)
    expect(validateBuckAdjustment(ajuste({ description: 'Acerto', amount: '-5000,01' }), 2)).toBe(recado)
    expect(validateBuckAdjustment(ajuste({ description: 'Acerto', amount: '-5000' }), 2)).toBeNull()
  })

  it('pão sem romaneio exige produto, quantidade e preço', () => {
    const base = { kind: 'produto_sem_romaneio' as const, description: 'Saiu sem romaneio' }
    expect(validateBuckAdjustment(ajuste({ ...base, quantity: '1', unitPrice: '2' }), 1))
      .toBe('Ajuste 1: informe o produto que saiu sem romaneio.')
    expect(validateBuckAdjustment(ajuste({ ...base, productName: 'Baguete', quantity: '0', unitPrice: '2' }), 1))
      .toBe('Ajuste 1: quantidade precisa ser maior que zero.')
    expect(validateBuckAdjustment(ajuste({ ...base, productName: 'Baguete', quantity: '3', unitPrice: '' }), 1))
      .toBe('Ajuste 1: preço precisa ser maior que zero.')
    expect(validateBuckAdjustment(ajuste({ ...base, productName: 'Baguete', quantity: '3000', unitPrice: '2' }), 1))
      .toBe('Ajuste 1: cada ajuste vai até R$ 5.000,00.')
    expect(validateBuckAdjustment(ajuste({ ...base, productName: 'Baguete', quantity: '3', unitPrice: '2' }), 1)).toBeNull()
  })

  it('no máximo 20 ajustes por semana', () => {
    const muitos = Array.from({ length: 21 }, (_, n) => ajuste({ description: `Acerto ${n}`, amount: '1' }))
    expect(validateBuckAdjustments(muitos)).toBe('No máximo 20 ajustes por semana.')
    expect(validateBuckAdjustments(muitos.slice(0, 20))).toBeNull()
  })
})

describe('soma e pedido enviado ao banco', () => {
  const ajustes = [
    ajuste({ kind: 'produto_sem_romaneio', description: 'Pão francês sem romaneio', productName: 'Pão francês', quantity: '10', unitPrice: '1,5' }),
    ajuste({ kind: 'preco_combinado', description: 'Brioche no preço combinado', amount: '12,34' }),
    ajuste({ kind: 'acerto', description: 'Arredondamento', amount: '-7,34' }),
  ]

  it('romaneios mais ajustes, o mesmo exemplo do teste de banco', () => {
    expect(summarizeBuckWeek(280, ajustes)).toEqual({ romaneios: 280, ajustes: 20, total: 300 })
  })

  it('soma em centavos não acumula erro de ponto flutuante', () => {
    const miudos = [
      ajuste({ description: 'Um', amount: '0,10' }),
      ajuste({ description: 'Dois', amount: '0,20' }),
    ]
    expect(summarizeBuckWeek(0.1, miudos)).toEqual({ romaneios: 0.1, ajustes: 0.3, total: 0.4 })
  })

  it('ajuste incompleto não soma', () => {
    expect(summarizeBuckWeek(280, [...ajustes, ajuste({ description: 'Ainda digitando', amount: '' })]).total).toBe(300)
  })

  it('pão sem romaneio vai com produto, quantidade, unidade e preço; os outros só com valor', () => {
    expect(buckAdjustmentsPayload(ajustes)).toEqual([
      { kind: 'produto_sem_romaneio', description: 'Pão francês sem romaneio', product_name: 'Pão francês', quantity: 10, unit: 'un', unit_price: 1.5 },
      { kind: 'preco_combinado', description: 'Brioche no preço combinado', amount: 12.34 },
      { kind: 'acerto', description: 'Arredondamento', amount: -7.34 },
    ])
  })

  it('a confirmação envia o valor e a composição que a tela mostrou', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: 'cobranca-1', error: null } as never)
    const semana = { period_start: '2026-08-31', period_end: '2026-09-06', amount: 280, composicao: 'abc123' }
    await expect(createBuckWeeklyReceivable(semana, ajustes.slice(2), 'pedido-1')).resolves.toBe('cobranca-1')
    expect(supabase.rpc).toHaveBeenCalledWith('create_buck_weekly_receivable', {
      p_request_id: 'pedido-1',
      p_de: '2026-08-31',
      p_ate: '2026-09-06',
      p_total_romaneios_conferencia: 280,
      p_composicao_conferencia: 'abc123',
      p_ajustes: [{ kind: 'acerto', description: 'Arredondamento', amount: -7.34 }],
    })
  })
})

describe('janela do deploy', () => {
  it('sem a função no banco, a lista de semanas vem vazia em vez de derrubar a tela', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } as never)
    await expect(loadBuckWeeksToBill()).resolves.toEqual([])
  })

  it('outro erro continua subindo', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } } as never)
    await expect(loadBuckWeeksToBill()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('bloqueio da semana', () => {
  const semana = { amount: 280, linhas: 2, problemas: [] as string[] }

  it('semana sem problema pode ser cobrada', () => {
    expect(buckWeekBlock(semana)).toBeNull()
  })

  it('produto sem preço leva à Tabela Buck', () => {
    expect(buckWeekBlock({ ...semana, problemas: ['missing_price'] })?.href).toBe('/tabelas-preco')
  })

  it('unidade e peso levam ao Fechamento EX', () => {
    expect(buckWeekBlock({ ...semana, problemas: ['unit_mismatch'] })?.href).toBe('/relatorios/romaneios')
    expect(buckWeekBlock({ ...semana, problemas: ['suspicious_quantity'] })?.href).toBe('/relatorios/romaneios')
  })

  it('problema desconhecido bloqueia em vez de liberar', () => {
    expect(buckWeekBlock({ ...semana, problemas: ['motivo_novo'] })).not.toBeNull()
  })

  it('semana em zero bloqueia', () => {
    expect(buckWeekBlock({ ...semana, amount: 0 })).not.toBeNull()
  })

  it('rótulo da semana', () => {
    expect(buckWeekLabel({ period_start: '2026-08-31', period_end: '2026-09-06' })).toBe('Semana de 31/08 a 06/09')
  })
})

describe('limites iguais aos da migration', () => {
  it('a tela usa os mesmos 20 ajustes e R$ 5.000 que o banco', () => {
    const pasta = join(process.cwd(), 'supabase', 'migrations')
    const corpos = readdirSync(pasta)
      .filter(nome => nome.endsWith('.sql'))
      .sort()
      .map(nome => readFileSync(join(pasta, nome), 'utf8'))
      .filter(sql => sql.includes('function public.create_buck_weekly_receivable'))
    expect(corpos.length, 'nenhuma migration define create_buck_weekly_receivable').toBeGreaterThan(0)
    const ultima = corpos[corpos.length - 1]
    expect(ultima).toContain(`jsonb_array_length(v_ajustes_entrada) > ${BUCK_MAX_ADJUSTMENTS}`)
    expect(ultima).toContain(`abs(v_valor) > ${BUCK_MAX_ADJUSTMENT_AMOUNT}`)
  })
})
