import { describe, expect, it } from 'vitest'
import { validateRomaneioConference, type RomaneioConferenceLine } from './romaneioConference'

// O caso da Marselle, 2026-08-26: o romaneio diz 10 pães e chegaram 11. Ela
// relatou que para menos salva e para mais não. A tela pede dois números, e o
// resultado depende de em QUAL campo ela digita o 11.
function pao(over: Partial<RomaneioConferenceLine> = {}): RomaneioConferenceLine {
  return { productName: '[TESTE] Baguete', received: 10, accepted: 10, ...over }
}

describe('conferência de recebimento do Romaneio', () => {
  describe('o caso relatado pela Marselle: romaneio de 10, chegaram 11', () => {
    it('SALVA quando ela digita 11 nos dois campos', () => {
      // Recebeu 11 e aceita pagar 11: divergência para mais, e é legítima.
      expect(validateRomaneioConference([pao({ received: 11, accepted: 11 })]))
        .toEqual({ ok: true })
    })

    it('SALVA quando ela digita 11 só em Recebido e deixa Aceito em 10', () => {
      // Chegaram 11, a loja paga 10. Salva, e cobra os 10.
      expect(validateRomaneioConference([pao({ received: 11, accepted: 10 })]))
        .toEqual({ ok: true })
    })

    it('NÃO SALVA quando ela digita 11 só em Aceito e Recebido fica em 10', () => {
      // Este é o caminho que reproduz a queixa. A regra está certa (não se
      // cobra mais do que chegou), mas na tela ela só vê "confira recebido e
      // aceito", que não diz qual dos dois está errado.
      expect(validateRomaneioConference([pao({ received: 10, accepted: 11 })]))
        .toEqual({
          ok: false,
          problem: 'aceito-maior-que-recebido',
          productName: '[TESTE] Baguete',
        })
    })

    it('SALVA para menos, que é o que ela disse funcionar', () => {
      expect(validateRomaneioConference([pao({ received: 9, accepted: 9 })]))
        .toEqual({ ok: true })
    })
  })

  describe('as outras recusas continuam valendo', () => {
    it('campo em branco não fecha a conferência', () => {
      expect(validateRomaneioConference([pao({ received: Number.NaN })]))
        .toEqual({ ok: false, problem: 'sem-numero', productName: '[TESTE] Baguete' })
    })

    it('número negativo não fecha a conferência', () => {
      expect(validateRomaneioConference([pao({ received: -1, accepted: -1 })]))
        .toEqual({ ok: false, problem: 'numero-negativo', productName: '[TESTE] Baguete' })
    })

    it('item por peso acima de 10 kg é recusado, para pegar grama digitado como quilo', () => {
      expect(validateRomaneioConference([
        pao({ productName: 'Pão de Forma kg', received: 1450, accepted: 1450, weightControlled: true }),
      ])).toEqual({
        ok: false,
        problem: 'acima-do-limite-de-peso',
        productName: 'Pão de Forma kg',
      })
    })

    it('campo em branco é reportado como campo em branco, não como excesso de peso', () => {
      // A ordem das checagens importa: quem esqueceu de digitar precisa ouvir
      // isso, e não uma mensagem sobre limite de quilo.
      expect(validateRomaneioConference([
        pao({ received: Number.NaN, accepted: 99, weightControlled: true }),
      ]).problem).toBe('sem-numero')
    })

    it('conferência sem item nenhum não fecha', () => {
      expect(validateRomaneioConference([])).toEqual({ ok: false, problem: 'sem-numero' })
    })
  })

  it('o primeiro item com problema é o reportado, mesmo com vários itens', () => {
    expect(validateRomaneioConference([
      pao({ productName: 'Ciabatta' }),
      pao({ productName: 'Integral', received: 10, accepted: 12 }),
      pao({ productName: 'Brioche', received: -5, accepted: -5 }),
    ])).toEqual({
      ok: false,
      problem: 'aceito-maior-que-recebido',
      productName: 'Integral',
    })
  })
})
