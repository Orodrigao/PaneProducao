import { describe, expect, it } from 'vitest'
import {
  aggregateConfirmedReuse,
  aggregateWholePending,
  clampReuseProposal,
  leftoverAgeDays,
  leftoverRegisterStores,
  subtractActiveReuseProposals,
  subtractConfirmedReuse,
  validateDestinationQuantity,
} from './breadLeftovers'

describe('aggregateWholePending', () => {
  it('soma por loja e pão sem prometer frações como unidades reaproveitáveis', () => {
    const result = aggregateWholePending([
      { store: 'jc', product_id: 'integral', pending_quantity: 4.8 },
      { store: 'jc', product_id: 'integral', pending_quantity: 2.2 },
      { store: 'ja', product_id: 'integral', pending_quantity: 3 },
      { store: 'ex', product_id: 'integral', pending_quantity: 20 },
    ])

    expect(result.get('jc-integral')).toBe(6)
    expect(result.get('ja-integral')).toBe(3)
    expect(result.has('ex-integral')).toBe(false)
  })

  it('desconta propostas ativas para nao oferecer a mesma sobra duas vezes', () => {
    const available = subtractActiveReuseProposals(
      new Map([
        ['jc-integral', 6],
        ['ja-integral', 3],
      ]),
      [
        { store: 'jc', bread_id: 'integral', proposed_quantity: 4, status: 'proposed' },
        { store: 'jc', bread_id: 'integral', proposed_quantity: 1, status: 'cancelled' },
        { store: 'ja', bread_id: 'integral', proposed_quantity: 2, status: 'confirmed' },
      ],
    )

    expect(available.get('jc-integral')).toBe(2)
    expect(available.get('ja-integral')).toBe(3)
  })
})

describe('reaproveitamento confirmado', () => {
  it('reduz somente o previsto do pão correspondente', () => {
    const confirmed = aggregateConfirmedReuse([
      { bread_id: 'integral', confirmed_quantity: 4, status: 'confirmed' },
      { bread_id: 'italiano', confirmed_quantity: 3, status: 'proposed' },
    ])
    const adjusted = subtractConfirmedReuse(
      new Map([['integral', 30], ['italiano', 12]]),
      confirmed,
    )

    expect(adjusted.get('integral')).toBe(26)
    expect(adjusted.get('italiano')).toBe(12)
  })

  it('nunca produz um previsto negativo', () => {
    const result = subtractConfirmedReuse(new Map([['integral', 2]]), new Map([['integral', 4]]))
    expect(result.get('integral')).toBe(0)
  })
})

describe('validações operacionais', () => {
  it('limita a proposta pelo pedido e pelo saldo inteiro disponível', () => {
    expect(clampReuseProposal(8, 30, 6)).toBe(6)
    expect(clampReuseProposal(-2, 30, 6)).toBe(0)
  })

  it('aceita destino parcial e rejeita quantidade acima do saldo', () => {
    expect(validateDestinationQuantity('2,5', 4)).toBe(2.5)
    expect(validateDestinationQuantity('5', 4)).toBeNull()
  })

  it('calcula a idade por data operacional', () => {
    expect(leftoverAgeDays('2026-07-10', '2026-07-11')).toBe(1)
    expect(leftoverAgeDays('2026-07-12', '2026-07-11')).toBe(0)
  })
})

describe('quem pode fechar a contagem de sobras', () => {
  const registerJc = [{ permission_key: 'sobras.registrar', scope: 'jc' }]

  it('libera a loja concedida e só ela', () => {
    expect(leftoverRegisterStores(registerJc, 'expedicao', 'jc')).toEqual(['jc'])
  })

  it('não confunde dar destino com fechar a contagem', () => {
    const onlyDestination = [{ permission_key: 'sobras.dar_destino', scope: 'jc' }]
    expect(leftoverRegisterStores(onlyDestination, 'expedicao', 'jc')).toEqual([])
  })

  it('barra quem não tem permissão nenhuma', () => {
    expect(leftoverRegisterStores([], 'expedicao', 'jc')).toEqual([])
    expect(leftoverRegisterStores([], 'romaneio', 'jc')).toEqual([])
  })

  it('trata escopo geral como as duas lojas', () => {
    const everywhere = [{ permission_key: 'sobras.registrar', scope: '*' }]
    expect(leftoverRegisterStores(everywhere, 'expedicao', 'jc')).toEqual(['jc', 'ja'])
  })

  it('mantém admin e produção com as duas lojas, como o banco', () => {
    expect(leftoverRegisterStores([], 'admin', null)).toEqual(['jc', 'ja'])
    expect(leftoverRegisterStores([], 'producao', null)).toEqual(['jc', 'ja'])
  })

  it('prende a atendente na própria loja mesmo com permissão para a outra', () => {
    // O banco barra `vendas` fora da própria loja depois de autorizar; a tela
    // precisa contar a mesma história, senão oferece um salvar que será negado.
    const registerBoth = [{ permission_key: 'sobras.registrar', scope: '*' }]
    expect(leftoverRegisterStores(registerBoth, 'vendas', 'ja')).toEqual(['ja'])
    expect(leftoverRegisterStores([], 'vendas', 'ex')).toEqual([])
  })
})
