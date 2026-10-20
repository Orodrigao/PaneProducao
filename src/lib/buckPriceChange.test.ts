import { describe, expect, it, vi } from 'vitest'

// O módulo cria o cliente Supabase ao ser importado; aqui ele é substituído.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import {
  buckPriceErrorMessage,
  buckPriceEventLabel,
  collectAllPages,
  confirmationKey,
  confirmationNeeded,
  isStaleBuckPreviewError,
  sameBuckProduct,
  effectiveHistorySeqs,
  formatSince,
  needsBigChangeConfirmation,
  parseBuckPriceInput,
  validateBuckPriceDraft,
  type BuckPriceDraft,
  type BuckPriceHistoryEntry,
  type BuckPricePreview,
} from './buckPriceChange'

const preview: BuckPricePreview = {
  hoje: '2026-10-19',
  data_minima: '2026-10-05',
  motivo_data_minima: 'semana_cobrada',
  versao: 41,
  vigente: { unit_price: 4.5, pricing_unit: 'un', valid_from: '2000-01-01' },
}

const draft: BuckPriceDraft = {
  priceText: '5,89',
  unit: 'un',
  validFrom: '2026-10-09',
  reason: 'reajuste_combinado',
  detail: '',
  bigChangeConfirmed: false,
}

function entry(seq: number, item: string, validFrom: string, price: number | null = 1): BuckPriceHistoryEntry {
  return {
    seq, price_tier_item_id: item, unit_price: price, pricing_unit: price === null ? null : 'un',
    valid_from: validFrom, previous_unit_price: null, previous_pricing_unit: null,
    event: 'troca_de_preco', origin: 'troca_com_data', reason: null, created_by_name: null,
    created_at: '2026-10-19T12:00:00Z',
  }
}

describe('parseBuckPriceInput', () => {
  it('le o preco com virgula, com ponto de milhar e com R$', () => {
    expect(parseBuckPriceInput('5,89')).toEqual({ value: 5.89, error: null })
    expect(parseBuckPriceInput('R$ 1.234,50')).toEqual({ value: 1234.5, error: null })
    expect(parseBuckPriceInput('12.32')).toEqual({ value: 12.32, error: null })
  })

  it('recusa casas a mais em vez de arredondar', () => {
    expect(parseBuckPriceInput('5,899').error).toBe('Use no máximo duas casas depois da vírgula.')
    expect(parseBuckPriceInput('5.89900').error).toBe('Use no máximo duas casas depois da vírgula.')
    // Ambíguo (milhar ou três casas): nos dois casos a vírgula resolve.
    expect(parseBuckPriceInput('5.899').error).toBe('Para milhar, use vírgula nos centavos: 1.000,00.')
  })

  it('recusa vazio, zero, negativo, texto e acima do teto', () => {
    expect(parseBuckPriceInput('  ').error).toBe('Informe o preço novo.')
    expect(parseBuckPriceInput('0,00').error).toBe('Informe um preço maior que zero.')
    expect(parseBuckPriceInput('-5').error).toBe('Digite só números, com vírgula nos centavos.')
    expect(parseBuckPriceInput('cinco').error).toBe('Digite só números, com vírgula nos centavos.')
    expect(parseBuckPriceInput('10000,01').error).toBe('Preço acima de R$ 10.000,00. Confira o valor.')
  })
})

describe('needsBigChangeConfirmation', () => {
  it('pede confirmacao acima de 30% de variacao, para cima ou para baixo', () => {
    expect(needsBigChangeConfirmation(4.5, 5.89)).toBe(true)
    expect(needsBigChangeConfirmation(4.5, 5.85)).toBe(false)
    expect(needsBigChangeConfirmation(5.89, 589)).toBe(true)
    expect(needsBigChangeConfirmation(10, 6.9)).toBe(true)
  })

  it('primeiro preco nao tem com o que comparar', () => {
    expect(needsBigChangeConfirmation(null, 50)).toBe(false)
    expect(needsBigChangeConfirmation(0, 50)).toBe(false)
  })
})

describe('validateBuckPriceDraft', () => {
  it('libera a troca completa e conferida', () => {
    expect(validateBuckPriceDraft({ ...draft, bigChangeConfirmed: true }, preview)).toBeNull()
  })

  it('exige confirmar a variacao grande (4,50 para 5,89 e +31%)', () => {
    expect(validateBuckPriceDraft(draft, preview)).toBe('Confirme a variação grande do preço antes de gravar.')
  })

  it('recusa data futura e data antes da minima, dizendo o porque', () => {
    expect(validateBuckPriceDraft({ ...draft, validFrom: '2026-10-20' }, preview))
      .toBe('O preço novo não pode valer a partir de uma data futura.')
    expect(validateBuckPriceDraft({ ...draft, validFrom: '2026-10-04' }, preview))
      .toBe('Escolha 05/10/2026 ou depois: antes disso este pão já entrou numa cobrança da Buck confirmada.')
  })

  it('exige motivo, e texto quando o motivo e "outro"', () => {
    expect(validateBuckPriceDraft({ ...draft, reason: '' }, preview)).toBe('Escolha o motivo da troca.')
    expect(validateBuckPriceDraft({ ...draft, reason: 'outro', detail: ' a ' }, preview)).toBe('Escreva o motivo da troca.')
    expect(validateBuckPriceDraft({ ...draft, detail: 'x'.repeat(151), bigChangeConfirmed: true }, preview))
      .toBe('Escreva o motivo em até 150 caracteres.')
  })
})

describe('confirmationNeeded e milhar', () => {
  it('troca de unidade pede confirmacao propria, sem comparar porcentagem', () => {
    const vigente = { unit_price: 2, pricing_unit: 'un' as const, valid_from: '2000-01-01' }
    expect(confirmationNeeded(vigente, { price: 30, unit: 'kg' })).toBe('unidade')
    expect(confirmationNeeded(vigente, { price: 2.1, unit: 'un' })).toBeNull()
    expect(confirmationNeeded(vigente, { price: 3, unit: 'un' })).toBe('variacao')
    expect(validateBuckPriceDraft({ ...draft, priceText: '30', unit: 'kg' }, { ...preview, vigente }))
      .toBe('Confirme a troca de unidade antes de gravar.')
  })

  it('"1.000" sem centavos pede a virgula em vez de virar 1 real', () => {
    expect(parseBuckPriceInput('1.000').error).toBe('Para milhar, use vírgula nos centavos: 1.000,00.')
    expect(parseBuckPriceInput('1.000,00')).toEqual({ value: 1000, error: null })
  })
})

describe('sameBuckProduct', () => {
  const legacy = new Map([['prod-brioche', 'pao-brioche']])
  it('mesma linha de catalogo ou a ponte pao legado e produto', () => {
    expect(sameBuckProduct({ product_source: 'product', product_id: 'prod-brioche' }, { product_source: 'product', product_id: 'prod-brioche' }, legacy)).toBe(true)
    expect(sameBuckProduct({ product_source: 'bread', product_id: 'pao-brioche' }, { product_source: 'product', product_id: 'prod-brioche' }, legacy)).toBe(true)
    expect(sameBuckProduct({ product_source: 'bread', product_id: 'outro' }, { product_source: 'product', product_id: 'prod-brioche' }, legacy)).toBe(false)
  })
})

describe('buckPriceErrorMessage', () => {
  it('queda de rede vira texto em portugues', () => {
    expect(buckPriceErrorMessage(new TypeError('Failed to fetch'), 'x'))
      .toBe('Sem conexão com o servidor. Confira a internet e tente de novo.')
  })

  it('funcao que ainda nao chegou ao banco vira aviso de atualizacao', () => {
    expect(buckPriceErrorMessage({ code: 'PGRST202', message: 'Could not find the function' }, 'x'))
      .toBe('O sistema está sendo atualizado. Tente de novo em alguns minutos.')
  })

  it('recusa do banco chega com a mensagem dele', () => {
    expect(buckPriceErrorMessage({ code: '22023', message: 'Informe um preço maior que zero.' }, 'x'))
      .toBe('Informe um preço maior que zero.')
    expect(buckPriceErrorMessage(null, 'Não foi possível trocar o preço.')).toBe('Não foi possível trocar o preço.')
  })
})

describe('historico', () => {
  it('registro coberto por outro gravado depois, com data igual ou anterior, nao vale mais', () => {
    const entries = [
      entry(1, 'a', '2000-01-01'),
      entry(2, 'a', '2026-09-25'),
      entry(3, 'a', '2026-09-22'),
      entry(4, 'b', '2026-09-30'),
    ]
    expect([...effectiveHistorySeqs(entries)].sort()).toEqual([1, 3, 4])
  })

  it('rotulos de evento com saida para chave nova', () => {
    expect(buckPriceEventLabel('troca_de_preco')).toBe('Troca de preço')
    expect(buckPriceEventLabel('evento_novo')).toBe('evento_novo')
    expect(formatSince('2000-01-01')).toBe('desde o início da tabela')
    expect(formatSince('2026-10-09')).toBe('desde 09/10/2026')
  })
})

describe('confirmacao amarrada a versao da previa', () => {
  // Revisao de outra familia (20/10/2026): a tela abriu com 5,00; outra pessoa
  // trocou para 10,00; quem digitou 5,50 comparava com os 5,00 antigos (+10%,
  // sem confirmacao) e gravava uma queda de 45%.
  it('a variacao e conferida contra o preco em vigor da previa mais nova', () => {
    const aberta = { ...preview, versao: 7, vigente: { unit_price: 5, pricing_unit: 'un' as const, valid_from: '2026-10-01' } }
    const depoisDaOutraTroca = { ...preview, versao: 8, vigente: { unit_price: 10, pricing_unit: 'un' as const, valid_from: '2026-10-19' } }
    const proximo = { price: 5.5, unit: 'un' as const }
    expect(confirmationKey(aberta, proximo)).toBeNull()
    expect(confirmationKey(depoisDaOutraTroca, proximo)).toBe('8|variacao|5.5|un')
    expect(validateBuckPriceDraft({ ...draft, priceText: '5,50' }, depoisDaOutraTroca))
      .toBe('Confirme a variação grande do preço antes de gravar.')
  })

  it('a confirmacao dada numa versao nao vale para a seguinte', () => {
    const proximo = { price: 5.89, unit: 'un' as const }
    const dada = confirmationKey(preview, proximo)
    expect(dada).toBe('41|variacao|5.89|un')
    expect(confirmationKey({ ...preview, versao: 42 }, proximo)).not.toBe(dada)
    expect(confirmationKey(null, proximo)).toBeNull()
  })

  it('reconhece a recusa do banco por previa velha', () => {
    expect(isStaleBuckPreviewError({ code: 'PZ002', message: 'O preço deste pão foi trocado...' })).toBe(true)
    expect(isStaleBuckPreviewError({ code: '22023', message: 'Nada muda' })).toBe(false)
    expect(isStaleBuckPreviewError(null)).toBe(false)
  })
})

describe('collectAllPages', () => {
  function fonte(total: number) {
    const pedidos: Array<[number, number]> = []
    const linhas = Array.from({ length: total }, (_, i) => i)
    const ler = async (from: number, to: number) => {
      pedidos.push([from, to])
      return linhas.slice(from, to + 1)
    }
    return { pedidos, ler }
  }

  it('lista vazia: uma leitura so', async () => {
    const { pedidos, ler } = fonte(0)
    expect(await collectAllPages(ler, 3)).toEqual([])
    expect(pedidos).toEqual([[0, 2]])
  })

  it('pagina exatamente cheia tem continuacao, mesmo que venha vazia', async () => {
    const { pedidos, ler } = fonte(3)
    expect(await collectAllPages(ler, 3)).toEqual([0, 1, 2])
    expect(pedidos).toEqual([[0, 2], [3, 5]])
  })

  it('le todas as paginas ate a incompleta, sem perder nem repetir linha', async () => {
    const { pedidos, ler } = fonte(7)
    expect(await collectAllPages(ler, 3)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(pedidos).toEqual([[0, 2], [3, 5], [6, 8]])
  })
})
