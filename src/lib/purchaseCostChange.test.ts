import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCostHistory,
  classifyRatio,
  compareWithLastPurchase,
  daysBefore,
  formatUnitCost,
  formatVariation,
  isLaterNote,
  LARGE_VARIATION,
  MINIMUM_INCREASE,
  noteProductCosts,
  packagingLabel,
  recentCostChanges,
  toCents,
  type CostHistoryRow,
} from '@/lib/purchaseCostChange'
import type { NfeDraft, NfeItemDraft } from '@/lib/nfeXml'
import { loadCostHistory, loadRecentCostChanges } from '@/lib/purchaseCostChangeClient'

const supabaseMocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseMocks.from } }))

const TOMATE = 'tomate'
const MANJERICAO = 'manjericao'

type PurchaseFields = Extract<NonNullable<CostHistoryRow['purchase']>, { id: string }>

function row(overrides: Omit<Partial<CostHistoryRow>, 'purchase'> & { purchase?: Partial<PurchaseFields> } = {}): CostHistoryRow {
  const { purchase, ...rest } = overrides
  return {
    product_id: TOMATE,
    acquisition_value: 50,
    line_total: 50,
    usable_quantity: 10,
    source_unit: 'KG',
    conversion_factor: 1,
    cost_applied: true,
    product: { name: '[TESTE] Tomate cereja', unit: 'kg' },
    ...rest,
    purchase: {
      id: purchase?.id ?? 'nota-a',
      // Chave por nota, como na NF-e de verdade: a própria nota nunca é a anterior.
      nfe_key: `chave-${purchase?.id ?? 'nota-a'}`,
      nfe_number: '100',
      nfe_issued_at: '2026-10-10',
      nfe_issued_timestamp: '2026-10-10T10:00:00-03:00',
      created_at: '2026-10-10T14:00:00.123+00:00',
      status: 'aberta',
      origin: 'xml',
      suppliers: { name: 'Hortifruti Fictício' },
      ...purchase,
    },
  }
}

function item(overrides: Partial<NfeItemDraft> = {}): NfeItemDraft {
  return {
    lineNumber: 1, supplierCode: 'T-1', ean: null, description: 'TOMATE CEREJA', ncm: null,
    quantity: 10, purchaseUnit: 'KG', taxQuantity: null, taxUnit: null, unitPrice: 6,
    grossLineTotal: 60, discountValue: 0, lineTotal: 60,
    baseProductId: TOMATE, baseProductName: '[TESTE] Tomate cereja', baseUnit: 'kg', category: 'Insumos',
    conversionBasis: 'simple', conversionFactor: 1, usableQuantity: 10, mappingStatus: 'mapeado',
    rememberConversion: true, factorConfirmed: false, recognized: false,
    fiscal: { discount: 0, freight: 0, insurance: 0, otherExpenses: 0, importTax: 0, icmsSt: 0, fcpSt: 0, ipi: 0, ipiReturned: 0, icmsExempt: 0, deductsExemption: null, composesTotal: '1' },
    ...overrides,
  }
}

function draft(items: NfeItemDraft[], overrides: Partial<NfeDraft> = {}): NfeDraft {
  return {
    accessKey: 'chave-nova', number: '200', series: '1', issueDate: '2026-10-20', issuedAt: '2026-10-20T09:00:00-03:00',
    supplierName: 'Hortifruti Fictício', supplierCnpj: '00000000000000', total: 0, paymentMethod: 'boleto', dueDateSource: 'xml',
    items, installments: [], totals: {} as NfeDraft['totals'],
    ...overrides,
  }
}

const novaNota = { issueDate: '2026-10-20', issuedAt: '2026-10-20T09:00:00-03:00', createdAt: null, nfeKey: 'chave-nova' }

describe('histórico de custo por nota, como o banco troca o custo', () => {
  it('soma as linhas do mesmo cadastro na nota e usa o valor pago com impostos', () => {
    const history = buildCostHistory([
      row({ acquisition_value: 33, line_total: 30, usable_quantity: 5 }),
      row({ acquisition_value: 22, line_total: 20, usable_quantity: 5, source_unit: 'CX', conversion_factor: 5 }),
    ])
    const [point] = history.get(TOMATE) ?? []
    expect(point.unitCost).toBeCloseTo(5.5)
    expect(point.packaging).toEqual([{ sourceUnit: 'KG', factor: 1 }, { sourceUnit: 'CX', factor: 5 }])
    expect(point.supplierName).toBe('Hortifruti Fictício')
  })

  it('compra anterior à fase 3A, sem valor pago, usa o valor do item', () => {
    const [point] = buildCostHistory([row({ acquisition_value: null, line_total: 40, usable_quantity: 10 })]).get(TOMATE) ?? []
    expect(point.unitCost).toBe(4)
  })

  it('fica de fora conta cancelada, compra manual, item sem cadastro e quantidade útil zero', () => {
    const history = buildCostHistory([
      row({ purchase: { id: 'cancelada', status: 'cancelada' } }),
      row({ purchase: { id: 'manual', origin: 'manual' } }),
      row({ product_id: null }),
      row({ usable_quantity: 0 }),
    ])
    expect(history.size).toBe(0)
  })

  it('aceita o fornecedor e a nota em lista, como o PostgREST às vezes devolve', () => {
    const history = buildCostHistory([{ ...row(), purchase: [{ ...(row().purchase as object), suppliers: [{ name: 'Em lista' }] } as never] }])
    expect(history.get(TOMATE)?.[0].supplierName).toBe('Em lista')
  })
})

describe('ordem das notas, pela regra do banco', () => {
  const base = { issueDate: '2026-10-10', issuedAt: '2026-10-10T10:00:00-03:00', createdAt: '2026-10-10T14:00:00Z' }

  it('data de emissão decide primeiro', () => {
    expect(isLaterNote({ ...base, issueDate: '2026-10-11' }, base)).toBe(true)
    expect(isLaterNote(base, { ...base, issueDate: '2026-10-11' })).toBe(false)
  })

  it('no mesmo dia decide a hora de emissão, mesmo lançada antes', () => {
    expect(isLaterNote({ ...base, issuedAt: '2026-10-10T11:00:00-03:00', createdAt: '2026-10-09T00:00:00Z' }, base)).toBe(true)
  })

  it('sem a hora de uma das duas, vale a ordem de lançamento, e a nota ainda não lançada é a última', () => {
    expect(isLaterNote({ ...base, issuedAt: null, createdAt: '2026-10-10T15:00:00Z' }, base)).toBe(true)
    expect(isLaterNote({ ...base, issuedAt: null }, { ...base, issuedAt: null, createdAt: null })).toBe(false)
    expect(isLaterNote({ ...base, issuedAt: null, createdAt: null }, base)).toBe(true)
  })
})

describe('o que conta como alta', () => {
  it('5% ou mais é alta; abaixo, não', () => {
    expect(MINIMUM_INCREASE).toBe(0.05)
    expect(classifyRatio(1.05)).toBe('subiu')
    expect(classifyRatio(10.5 / 10)).toBe('subiu')
    expect(classifyRatio(1.0499)).toBe('sem_alta')
    expect(classifyRatio(1)).toBe('sem_alta')
    expect(classifyRatio(0.9)).toBe('sem_alta')
  })

  it('50% para cima ou um terço para baixo pede conferir a embalagem', () => {
    expect(LARGE_VARIATION).toBe(1.5)
    expect(classifyRatio(1.5)).toBe('muito_diferente')
    expect(classifyRatio(1.4999)).toBe('subiu')
    expect(classifyRatio(1 / 1.5)).toBe('muito_diferente')
    expect(classifyRatio(0.7)).toBe('sem_alta')
  })
})

describe('comparação com a última compra', () => {
  const history = buildCostHistory([
    row({ purchase: { id: 'nota-a', nfe_key: 'chave-a', nfe_number: '100', nfe_issued_at: '2026-10-01', nfe_issued_timestamp: null } , acquisition_value: 40 }),
    row({ purchase: { id: 'nota-b', nfe_key: 'chave-b', nfe_number: '101', nfe_issued_at: '2026-10-10' } }),
  ])

  it('subiu: compara com a nota mais recente antes desta', () => {
    const change = compareWithLastPurchase(history.get(TOMATE), novaNota, TOMATE, 6)
    expect(change.kind).toBe('subiu')
    expect(change.previous?.nfeNumber).toBe('101')
    expect(change.ratio).toBeCloseTo(1.2)
  })

  it('mesmo custo não é alta', () => {
    expect(compareWithLastPurchase(history.get(TOMATE), novaNota, TOMATE, 5).kind).toBe('sem_alta')
  })

  it('primeira compra do cadastro não tem com o que comparar', () => {
    const change = compareWithLastPurchase(history.get(MANJERICAO), novaNota, MANJERICAO, 10)
    expect(change).toMatchObject({ kind: 'primeira', previous: null, ratio: null })
  })

  it('nota mais antiga que a última não troca o custo e não acusa alta', () => {
    const change = compareWithLastPurchase(history.get(TOMATE), { ...novaNota, issueDate: '2026-10-05', issuedAt: null }, TOMATE, 9)
    expect(change.kind).toBe('nota_antiga')
    expect(change.newer?.nfeNumber).toBe('101')
    expect(change.previous?.nfeNumber).toBe('100')
  })

  it('a própria nota não conta como compra anterior', () => {
    const change = compareWithLastPurchase(history.get(TOMATE), { ...novaNota, nfeKey: 'chave-b' }, TOMATE, 6)
    expect(change.previous?.nfeNumber).toBe('100')
  })

  it('custo zero de um lado só é diferença grande, não alta silenciosa', () => {
    const zero = buildCostHistory([row({ acquisition_value: 0 })])
    expect(compareWithLastPurchase(zero.get(TOMATE), novaNota, TOMATE, 5).kind).toBe('muito_diferente')
    expect(compareWithLastPurchase(history.get(TOMATE), novaNota, TOMATE, 0).kind).toBe('muito_diferente')
  })
})

describe('custo de cada cadastro na nota que está sendo importada', () => {
  it('soma as linhas do mesmo cadastro com o valor pago de cada uma', () => {
    const costs = noteProductCosts(
      draft([item({ lineNumber: 1, usableQuantity: 10 }), item({ lineNumber: 2, usableQuantity: 5 })]),
      new Map([[1, 60], [2, 33]]),
    )
    expect(costs.get(TOMATE)).toEqual({ productId: TOMATE, unitCost: 93 / 15, lineNumbers: [1, 2] })
  })

  it('item pendente, fora do cadastro ou sem quantidade útil não entra', () => {
    const costs = noteProductCosts(draft([
      item({ lineNumber: 1, mappingStatus: 'pendente', baseProductId: null }),
      item({ lineNumber: 2, mappingStatus: 'nao_aplicavel', baseProductId: null }),
      item({ lineNumber: 3, usableQuantity: 0 }),
    ]), new Map([[1, 10], [2, 10], [3, 10]]))
    expect(costs.size).toBe(0)
  })

  it('embalagem ainda não conferida segura a comparação', () => {
    const costs = noteProductCosts(draft([item({ purchaseUnit: 'CX', baseUnit: 'kg', factorConfirmed: false })]), new Map([[1, 60]]))
    expect(costs.get(TOMATE)?.unitCost).toBeNull()
  })

  it('nota que não fecha não tem custo para comparar', () => {
    expect(noteProductCosts(draft([item()]), null).size).toBe(0)
  })
})

describe('quadro das altas recentes', () => {
  it('lista só as notas do período que trocaram o custo e mudaram, cada uma contra a compra anterior a ela', () => {
    const history = buildCostHistory([
      row({ purchase: { id: 'a', nfe_issued_at: '2026-09-01', nfe_issued_timestamp: null }, acquisition_value: 40 }),
      row({ purchase: { id: 'b', nfe_issued_at: '2026-10-10', nfe_issued_timestamp: null }, acquisition_value: 50 }),
      row({ purchase: { id: 'c', nfe_issued_at: '2026-10-12', nfe_issued_timestamp: null }, acquisition_value: 51 }),
      row({ purchase: { id: 'd', nfe_issued_at: '2026-10-11', nfe_issued_timestamp: null }, acquisition_value: 90, cost_applied: false }),
      row({ product_id: MANJERICAO, purchase: { id: 'e', nfe_issued_at: '2026-10-15', nfe_issued_timestamp: null }, acquisition_value: 10 }),
      row({ product_id: MANJERICAO, purchase: { id: 'f', nfe_issued_at: '2026-10-16', nfe_issued_timestamp: null }, acquisition_value: 30 }),
    ])
    const changes = recentCostChanges(history, '2026-10-05')
    // b subiu sobre a, mesmo com notas depois dela; d entrou atrasada, não
    // trocou o custo e não serve de compra anterior: c fica contra b (+2%, sem
    // alta); a é anterior ao período; e é a primeira do manjericão.
    expect(changes.map(change => [change.point.purchaseId, change.kind, change.previous?.purchaseId])).toEqual([
      ['f', 'muito_diferente', 'e'],
      ['b', 'subiu', 'a'],
    ])
  })

  it('nota atrasada que entra depois não apaga a alta já mostrada', () => {
    const antes = [
      row({ purchase: { id: 'a', nfe_issued_at: '2026-10-01', nfe_issued_timestamp: null, created_at: '2026-10-01T12:00:00Z' }, acquisition_value: 50 }),
      row({ purchase: { id: 'c', nfe_issued_at: '2026-10-03', nfe_issued_timestamp: null, created_at: '2026-10-03T12:00:00Z' }, acquisition_value: 60 }),
    ]
    const atrasada = row({ purchase: { id: 'b', nfe_issued_at: '2026-10-02', nfe_issued_timestamp: null, created_at: '2026-10-05T12:00:00Z' }, acquisition_value: 59, cost_applied: false })
    const semAtrasada = recentCostChanges(buildCostHistory(antes), '2026-09-01').find(change => change.point.purchaseId === 'c')
    const comAtrasada = recentCostChanges(buildCostHistory([...antes, atrasada]), '2026-09-01').find(change => change.point.purchaseId === 'c')
    expect(semAtrasada?.ratio).toBeCloseTo(1.2)
    expect(comAtrasada?.ratio).toBeCloseTo(1.2)
    expect(comAtrasada?.previous?.purchaseId).toBe('a')
  })

  it('duas notas com a mesma hora: a lançada depois compara com a outra, na importação e no quadro', () => {
    const mesmaHora = { nfe_issued_at: '2026-10-10', nfe_issued_timestamp: '2026-10-10T10:00:00-03:00' }
    const history = buildCostHistory([
      row({ purchase: { id: 'a', ...mesmaHora, created_at: '2026-10-10T14:00:00Z' }, acquisition_value: 50 }),
      row({ purchase: { id: 'b', ...mesmaHora, created_at: '2026-10-10T15:00:00Z' }, acquisition_value: 60 }),
    ])
    const quadro = recentCostChanges(history, '2026-10-01')
    expect(quadro.map(change => [change.point.purchaseId, change.kind, change.previous?.purchaseId])).toEqual([['b', 'subiu', 'a']])

    const soA = buildCostHistory([row({ purchase: { id: 'a', ...mesmaHora, created_at: '2026-10-10T14:00:00Z' }, acquisition_value: 50 })])
    const importacao = compareWithLastPurchase(soA.get(TOMATE), { issueDate: '2026-10-10', issuedAt: '2026-10-10T10:00:00-03:00', createdAt: null, nfeKey: 'chave-b' }, TOMATE, 6)
    expect([importacao.kind, importacao.previous?.purchaseId]).toEqual(['subiu', 'a'])
  })

  it('compra anterior à fase 3A, sem a informação de custo aplicado, ainda serve de comparação', () => {
    const history = buildCostHistory([
      row({ purchase: { id: 'antiga', nfe_issued_at: '2026-08-20', nfe_issued_timestamp: null }, acquisition_value: 50, cost_applied: null }),
      row({ purchase: { id: 'nova', nfe_issued_at: '2026-10-20', nfe_issued_timestamp: null }, acquisition_value: 60 }),
    ])
    expect(history.get(TOMATE)?.find(point => point.purchaseId === 'antiga')?.costApplied).toBeNull()
    expect(recentCostChanges(history, '2026-10-01').map(change => change.previous?.purchaseId)).toEqual(['antiga'])
  })
})

describe('ordem sem ciclo quando o dia mistura notas com e sem hora', () => {
  it('o dia inteiro vai pela ordem de lançamento, e a última compra não depende da ordem de leitura', () => {
    // Pelo par a par do banco: A depois de C (hora), C depois de B (lançamento),
    // B depois de A (lançamento). Olhando o dia, vale o lançamento: A é a última.
    const dia = '2026-09-10'
    const notas = [
      row({ purchase: { id: 'c', nfe_issued_at: dia, nfe_issued_timestamp: '2026-09-10T10:00:00-03:00', created_at: '2026-09-10T11:00:00Z' }, acquisition_value: 50 }),
      row({ purchase: { id: 'b', nfe_issued_at: dia, nfe_issued_timestamp: null, created_at: '2026-09-10T12:00:00Z' }, acquisition_value: 50 }),
      row({ purchase: { id: 'a', nfe_issued_at: dia, nfe_issued_timestamp: '2026-09-10T09:00:00-03:00', created_at: '2026-09-10T13:00:00Z' }, acquisition_value: 50 }),
    ]
    const escolhas = [notas, [...notas].reverse(), [notas[1], notas[2], notas[0]]].map(ordem =>
      compareWithLastPurchase(buildCostHistory(ordem).get(TOMATE), novaNota, TOMATE, 5).previous?.purchaseId)
    expect(escolhas).toEqual(['a', 'a', 'a'])
  })
})

describe('centavos, como o cadastro guarda o custo', () => {
  it('meio centavo arredonda para cima, como o banco, mesmo quando o ponto flutuante erra', () => {
    // A armadilha: 10,075 × 100 sai 1007,4999... e o arredondamento direto dá R$ 10,07.
    expect(Math.round((100.75 / 10 + Number.EPSILON) * 100) / 100).toBe(10.07)
    expect(toCents(100.75 / 10)).toBe(10.08)
    expect(toCents(10.074999)).toBe(10.07)
    expect(buildCostHistory([row({ acquisition_value: 100.75, usable_quantity: 10 })]).get(TOMATE)?.[0].unitCost).toBe(10.08)
  })

  it('custo miúdo compara o que o cadastro vai mostrar, não a conta bruta', () => {
    const de0096 = buildCostHistory([row({ acquisition_value: 0.96, usable_quantity: 10 })])
    expect(de0096.get(TOMATE)?.[0].unitCost).toBe(0.1)
    // R$ 0,096 e R$ 0,104 viram R$ 0,10 no cadastro: não houve alta.
    expect(compareWithLastPurchase(de0096.get(TOMATE), novaNota, TOMATE, 0.1).kind).toBe('sem_alta')

    const de0104 = buildCostHistory([row({ acquisition_value: 1.04, usable_quantity: 10 })])
    // R$ 0,104 para R$ 0,108: no cadastro, de R$ 0,10 para R$ 0,11, alta de 10%.
    const costs = noteProductCosts(draft([item({ usableQuantity: 10 })]), new Map([[1, 1.08]]))
    const change = compareWithLastPurchase(de0104.get(TOMATE), novaNota, TOMATE, costs.get(TOMATE)?.unitCost ?? 0)
    expect(change.kind).toBe('subiu')
    expect(change.ratio).toBeCloseTo(1.1)
  })
})

describe('texto para a tela', () => {
  it('custo por unidade em centavos', () => {
    // O real vem com espaço inseparável depois do R$, como em formatBRL.
    expect(formatUnitCost(5.82, 'kg').replace(/\s/g, ' ')).toBe('R$ 5,82 por kg')
    expect(formatUnitCost(0.1, 'un').replace(/\s/g, ' ')).toBe('R$ 0,10 por un')
  })

  it('variação com sinal, arredondada', () => {
    expect(formatVariation(1.2)).toBe('+20%')
    expect(formatVariation(0.92)).toBe('−8%')
    expect(formatVariation(1.001)).toBe('0%')
  })

  it('embalagem diz quanto cada unidade da nota vale no cadastro', () => {
    expect(packagingLabel([{ sourceUnit: 'UN', factor: 8.08 }], 'kg')).toBe('UN com 8,08 kg')
    expect(packagingLabel([{ sourceUnit: 'KG', factor: 1 }], 'kg')).toBe('KG')
  })

  it('janela de dias sem passar por fuso', () => {
    expect(daysBefore('2026-11-04', 30)).toBe('2026-10-05')
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
  })
})

// Cada pedido ao banco vira uma lista de chamadas; a página devolvida sai de `pages`.
function fakeQuery(pages: Array<{ data: unknown[]; count: number }>) {
  const calls: Array<[string, ...unknown[]]> = []
  let served = 0
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'in', 'gt', 'eq', 'neq', 'not', 'gte', 'order']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  }
  builder.range = (...args: unknown[]) => {
    calls.push(['range', ...args])
    const page = pages[Math.min(served, pages.length - 1)]
    served += 1
    return Promise.resolve({ data: page.data, error: null, count: page.count })
  }
  return { builder, calls }
}

describe('leitura do histórico no banco', () => {
  beforeEach(() => supabaseMocks.from.mockReset())

  it('usa os mesmos filtros do custo: NF-e, conta não cancelada e quantidade útil', async () => {
    const query = fakeQuery([{ data: [{ id: 'i1', ...row() }], count: 1 }])
    supabaseMocks.from.mockReturnValue(query.builder)
    const history = await loadCostHistory([TOMATE, TOMATE])

    expect(supabaseMocks.from).toHaveBeenCalledWith('payable_purchase_items')
    expect(query.calls).toContainEqual(['in', 'product_id', [TOMATE]])
    expect(query.calls).toContainEqual(['gt', 'usable_quantity', 0])
    expect(query.calls).toContainEqual(['eq', 'purchase.origin', 'xml'])
    expect(query.calls).toContainEqual(['neq', 'purchase.status', 'cancelada'])
    expect(String(query.calls.find(call => call[0] === 'select')?.[1])).toContain('purchase:payable_purchases!inner(')
    expect(history.get(TOMATE)?.[0].unitCost).toBe(5)
  })

  it('divide muitos cadastros em pedidos de até 50', async () => {
    const query = fakeQuery([{ data: [], count: 0 }])
    supabaseMocks.from.mockReturnValue(query.builder)
    await loadCostHistory(Array.from({ length: 120 }, (_, index) => `produto-${String(index).padStart(3, '0')}`))
    const lists = query.calls.filter(call => call[0] === 'in').map(call => (call[2] as string[]).length)
    expect(lists).toEqual([50, 50, 20])
  })

  it('leitura cortada pela paginação falha em vez de comparar com uma última compra errada', async () => {
    const query = fakeQuery([{ data: [{ id: 'i1', ...row() }], count: 2 }, { data: [], count: 2 }])
    supabaseMocks.from.mockReturnValue(query.builder)
    await expect(loadCostHistory([TOMATE])).rejects.toThrow()
  })

  it('o quadro procura só notas do período que trocaram o custo', async () => {
    const recent = fakeQuery([{ data: [], count: 0 }])
    supabaseMocks.from.mockReturnValue(recent.builder)
    await expect(loadRecentCostChanges('2026-10-05')).resolves.toEqual([])
    expect(recent.calls).toContainEqual(['eq', 'cost_applied', true])
    expect(recent.calls).toContainEqual(['gte', 'purchase.nfe_issued_at', '2026-10-05'])
    expect(recent.calls).toContainEqual(['neq', 'purchase.status', 'cancelada'])
  })
})
