import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PRICING_CHANNELS,
  PRICING_SETTING_KEYS,
  baseSlots,
  buildPricingChanges,
  categorySlots,
  channelsOverHundred,
  currentValueMap,
  describeHistoryEntry,
  formatPercent,
  marginExceptionCategories,
  parsePercentInput,
  parsePricingSettingsResponse,
  percentInputText,
  pricingChannelLabel,
  pricingSaveErrorMessage,
  runPricingSave,
  slotId,
  type PricingSettingValue,
} from './pricingSettings'
import type { ProductCategory } from './productCategories'

const MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20260930012316_configuracao_sistema_preco.sql', import.meta.url),
  'utf8',
)

function saved(partial: Partial<PricingSettingValue> & Pick<PricingSettingValue, 'key' | 'value'>): PricingSettingValue {
  return { channel: null, categoryId: null, changedAt: '2026-09-29T12:00:00Z', changedByName: 'Rodrigo', ...partial }
}

describe('parsePercentInput', () => {
  it('vazio é não definido, nunca zero', () => {
    expect(parsePercentInput('')).toEqual({ ok: true, value: null })
    expect(parsePercentInput('   ')).toEqual({ ok: true, value: null })
  })

  it('aceita vírgula, ponto e o sinal de %', () => {
    expect(parsePercentInput('6')).toEqual({ ok: true, value: 6 })
    expect(parsePercentInput('2,5')).toEqual({ ok: true, value: 2.5 })
    expect(parsePercentInput('23.75')).toEqual({ ok: true, value: 23.75 })
    expect(parsePercentInput('6,5%')).toEqual({ ok: true, value: 6.5 })
    expect(parsePercentInput('0')).toEqual({ ok: true, value: 0 })
    expect(parsePercentInput('100')).toEqual({ ok: true, value: 100 })
  })

  it('recusa fora de 0 a 100, texto, negativo e mais de duas casas', () => {
    expect(parsePercentInput('100,01').ok).toBe(false)
    expect(parsePercentInput('150').ok).toBe(false)
    expect(parsePercentInput('-1').ok).toBe(false)
    expect(parsePercentInput('abc').ok).toBe(false)
    expect(parsePercentInput('6,555').ok).toBe(false)
    expect(parsePercentInput('1.000,5').ok).toBe(false)
  })
})

describe('formatação', () => {
  it('mostra não definido para vazio e percentual em pt-BR', () => {
    expect(formatPercent(null)).toBe('não definido')
    expect(formatPercent(6.5)).toBe('6,5%')
    expect(formatPercent(0)).toBe('0%')
    expect(percentInputText(null)).toBe('')
    expect(percentInputText(2.5)).toBe('2,5')
  })

  it('rótulo de canal desconhecido cai na chave crua', () => {
    expect(pricingChannelLabel('balcao')).toBe('Balcão')
    expect(pricingChannelLabel('ifood')).toBe('iFood')
    expect(pricingChannelLabel('outro')).toBe('outro')
    expect(pricingChannelLabel(null)).toBe('Todos os canais')
  })
})

describe('paridade com a migration', () => {
  it('canais e parâmetros da tela são os mesmos dos checks do banco', () => {
    expect(MIGRATION).toContain(`check (channel in (${PRICING_CHANNELS.map(c => `'${c}'`).join(', ')}))`)
    for (const key of PRICING_SETTING_KEYS) expect(MIGRATION).toContain(`'${key}'`)
    expect(MIGRATION).toMatch(/v_catalog_type not in \('produto_fabricado', 'produto_revenda'\)/)
  })
})

describe('buildPricingChanges', () => {
  const slots = baseSlots()

  it('nada digitado não gera mudança', () => {
    expect(buildPricingChanges(slots, {}, new Map())).toEqual({ changes: [], errors: {} })
  })

  it('só o que mudou viaja, com o valor que a tela mostrava', () => {
    const current = currentValueMap([saved({ key: 'imposto_venda', value: 6 })])
    const tax = slotId({ key: 'imposto_venda', channel: null, categoryId: null })
    const ifood = slotId({ key: 'taxa_canal', channel: 'ifood', categoryId: null })
    const draft = { [tax]: '6,5', [ifood]: '23' }
    expect(buildPricingChanges(slots, draft, current).changes).toEqual([
      { setting_key: 'imposto_venda', channel: null, category_id: null, value: 6.5, previous_value: 6 },
      { setting_key: 'taxa_canal', channel: 'ifood', category_id: null, value: 23, previous_value: null },
    ])
  })

  it('digitar o mesmo valor de volta não gera mudança', () => {
    const current = currentValueMap([saved({ key: 'imposto_venda', value: 6 })])
    const tax = slotId({ key: 'imposto_venda', channel: null, categoryId: null })
    expect(buildPricingChanges(slots, { [tax]: '6,0' }, current).changes).toEqual([])
  })

  it('apagar um valor vira limpeza (null), não zero', () => {
    const current = currentValueMap([saved({ key: 'taxa_canal', channel: 'balcao', value: 2.5 })])
    const fee = slotId({ key: 'taxa_canal', channel: 'balcao', categoryId: null })
    expect(buildPricingChanges(slots, { [fee]: '' }, current).changes).toEqual([
      { setting_key: 'taxa_canal', channel: 'balcao', category_id: null, value: null, previous_value: 2.5 },
    ])
  })

  it('campo inválido vira erro e não viaja', () => {
    const tax = slotId({ key: 'imposto_venda', channel: null, categoryId: null })
    const result = buildPricingChanges(slots, { [tax]: '120' }, new Map())
    expect(result.changes).toEqual([])
    expect(result.errors[tax]).toMatch(/entre 0 e 100/)
  })

  it('margem mínima acima da desejada do mesmo canal é apontada no campo da mínima', () => {
    const current = currentValueMap([saved({ key: 'margem_desejada', channel: 'buck', value: 30 })])
    const minimum = slotId({ key: 'margem_minima', channel: 'buck', categoryId: null })
    expect(buildPricingChanges(slots, { [minimum]: '35' }, current).errors[minimum]).toMatch(/maior que a desejada/)
  })

  it('exceção vazia herda o canal: mínima da exceção acima da desejada do canal é recusada', () => {
    const withCategory = [...slots, ...categorySlots('cat-1')]
    const current = currentValueMap([saved({ key: 'margem_desejada', channel: 'balcao', value: 30 })])
    const minimum = slotId({ key: 'margem_minima', channel: 'balcao', categoryId: 'cat-1' })
    const result = buildPricingChanges(withCategory, { [minimum]: '40' }, current)
    expect(result.errors[minimum]).toMatch(/desejada do canal/)
    expect(buildPricingChanges(withCategory, { [minimum]: '25' }, current)).toEqual({
      changes: [{ setting_key: 'margem_minima', channel: 'balcao', category_id: 'cat-1', value: 25, previous_value: null }],
      errors: {},
    })
  })

  it('desejada da exceção abaixo da mínima herdada do canal é recusada', () => {
    const withCategory = [...slots, ...categorySlots('cat-1')]
    const current = currentValueMap([saved({ key: 'margem_minima', channel: 'buck', value: 25 })])
    const desired = slotId({ key: 'margem_desejada', channel: 'buck', categoryId: 'cat-1' })
    expect(buildPricingChanges(withCategory, { [desired]: '20' }, current).errors[desired]).toMatch(/mínima do canal/)
  })

  it('baixar a desejada do canal aponta a exceção cuja mínima passa a ficar acima', () => {
    const withCategory = [...slots, ...categorySlots('cat-1')]
    const current = currentValueMap([
      saved({ key: 'margem_desejada', channel: 'balcao', value: 45 }),
      saved({ key: 'margem_minima', channel: 'balcao', categoryId: 'cat-1', value: 40 }),
    ])
    const channelDesired = slotId({ key: 'margem_desejada', channel: 'balcao', categoryId: null })
    const minimum = slotId({ key: 'margem_minima', channel: 'balcao', categoryId: 'cat-1' })
    expect(buildPricingChanges(withCategory, { [channelDesired]: '35' }, current).errors[minimum]).toBeDefined()
  })

  it('exceção com desejada própria compara com ela, não com a do canal', () => {
    const withCategory = [...slots, ...categorySlots('cat-1')]
    const current = currentValueMap([
      saved({ key: 'margem_desejada', channel: 'balcao', value: 30 }),
      saved({ key: 'margem_desejada', channel: 'balcao', categoryId: 'cat-1', value: 50 }),
    ])
    const minimum = slotId({ key: 'margem_minima', channel: 'balcao', categoryId: 'cat-1' })
    expect(buildPricingChanges(withCategory, { [minimum]: '40' }, current).errors).toEqual({})
  })
})

describe('runPricingSave', () => {
  it('gravou e releu: descarta o rascunho', async () => {
    const outcome = await runPricingSave([], async () => 2, async () => {})
    expect(outcome).toEqual({ kind: 'saved', message: 'Configuração salva: 2 valores mudaram.' })
  })

  it('gravou mas não releu: diz que salvou e não que falhou', async () => {
    const outcome = await runPricingSave([], async () => 1, async () => { throw new Error('rede') })
    expect(outcome.kind).toBe('saved-reload-failed')
    expect(outcome.message).toMatch(/Configuração salva \(1 valor mudou\)/)
    expect(outcome.message).toMatch(/Recarregue a página/)
  })

  it('banco recusou: não relê e explica pelo código', async () => {
    let reloaded = false
    const outcome = await runPricingSave([], async () => { throw { code: 'PT409' } }, async () => { reloaded = true })
    expect(outcome.kind).toBe('error')
    expect(outcome.message).toMatch(/Outro salvamento/)
    expect(reloaded).toBe(false)
  })
})

describe('channelsOverHundred', () => {
  it('avisa quando imposto + taxa + margem chegam a 100%', () => {
    const current = currentValueMap([
      saved({ key: 'imposto_venda', value: 6 }),
      saved({ key: 'taxa_canal', channel: 'ifood', value: 23 }),
    ])
    const desired = slotId({ key: 'margem_desejada', channel: 'ifood', categoryId: null })
    expect(channelsOverHundred(baseSlots(), { [desired]: '71' }, current)).toEqual(['ifood'])
    expect(channelsOverHundred(baseSlots(), { [desired]: '70' }, current)).toEqual([])
  })

  it('sem nada definido não avisa', () => {
    expect(channelsOverHundred(baseSlots(), {}, new Map())).toEqual([])
  })
})

describe('marginExceptionCategories', () => {
  const category = (id: string, catalog_type: ProductCategory['catalog_type'], active = true): ProductCategory =>
    ({ id, name: id, normalized_name: id, catalog_type, active, sort_order: 0 })

  it('oferece só produto fabricado e revenda, ativas ou já com valor', () => {
    const list = [
      category('croissant', 'produto_fabricado'),
      category('revenda', 'produto_revenda'),
      category('insumos', 'materia_prima'),
      category('antiga', 'produto_fabricado', false),
      category('antiga-com-valor', 'produto_fabricado', false),
    ]
    const current = [saved({ key: 'margem_desejada', channel: 'buck', categoryId: 'antiga-com-valor', value: 40 })]
    expect(marginExceptionCategories(list, current).map(item => item.id))
      .toEqual(['croissant', 'revenda', 'antiga-com-valor'])
  })
})

describe('parsePricingSettingsResponse', () => {
  it('lê valores vigentes e histórico, mantendo o vazio', () => {
    const data = parsePricingSettingsResponse({
      current: [
        { setting_key: 'imposto_venda', channel: null, category_id: null, value: 6, changed_at: '2026-09-29T15:00:00Z', changed_by_name: 'Rodrigo' },
        { setting_key: 'taxa_canal', channel: 'balcao', category_id: null, value: null, changed_at: '2026-09-29T15:00:00Z', changed_by_name: 'Rodrigo' },
      ],
      history: [
        { id: 2, setting_key: 'taxa_canal', channel: 'balcao', category_id: null, category_name: null,
          previous_value: 2.5, value: null, changed_at: '2026-09-29T15:00:00Z', changed_by_name: 'Rodrigo' },
      ],
    })
    expect(data.current[1].value).toBeNull()
    expect(describeHistoryEntry(data.history[0])).toBe('Taxa do canal · Balcão: 2,5% → não definido')
  })

  it('recusa formato inesperado e canal fora da lista', () => {
    expect(() => parsePricingSettingsResponse(null)).toThrow()
    expect(() => parsePricingSettingsResponse({ current: {} , history: [] })).toThrow()
    expect(() => parsePricingSettingsResponse({
      current: [{ setting_key: 'taxa_canal', channel: 'pj', value: 1 }], history: [],
    })).toThrow()
  })
})

describe('pricingSaveErrorMessage', () => {
  it('explica o conflito e preserva o que foi digitado', () => {
    expect(pricingSaveErrorMessage({ code: 'PT409' })).toMatch(/Anote o que você digitou e recarregue a página/)
    expect(pricingSaveErrorMessage({ code: '42501' })).toMatch(/Só administradores/)
    expect(pricingSaveErrorMessage(new Error('rede'))).toMatch(/Anote o que você digitou/)
    expect(pricingSaveErrorMessage({ code: '40001' })).not.toMatch(/Outro salvamento/)
  })

  it('falha sem resposta não afirma que nada foi gravado', () => {
    const mensagem = pricingSaveErrorMessage(new Error('rede'))
    expect(mensagem).toMatch(/Não foi possível confirmar o salvamento/)
    expect(mensagem).not.toMatch(/Nenhum valor foi alterado/)
  })

  it('não promete manter o digitado ao mandar recarregar a página', () => {
    // Recarregar apaga o rascunho, que só existe na tela.
    for (const erro of [{ code: 'PT409' }, new Error('rede')]) {
      expect(pricingSaveErrorMessage(erro)).not.toMatch(/continua na tela/)
    }
  })
})
