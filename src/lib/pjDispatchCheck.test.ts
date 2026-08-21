import { describe, expect, it } from 'vitest'
import {
  dispatchReadiness,
  problemsBeforeSaving,
  verdictForLine,
  versionOf,
  type CheckLineState,
} from './pjDispatchCheck'

function linha(over: Partial<CheckLineState> = {}): CheckLineState {
  return {
    orderId: 'linha-1',
    productLabel: 'Mini-croissant',
    estimated: 3,
    sent: 3,
    pricingUnit: 'kg',
    reason: '',
    ...over,
  }
}

describe('veredito da quantidade enviada', () => {
  it('aceita a diferença real do dia a dia sem pedir nada', () => {
    // Rodrigo, sobre o tamanho da diferença: "se o pedido é 3000 g, deve sair
    // 3067 g ou 2995 g".
    expect(verdictForLine({ estimated: 3, sent: 3.067, pricingUnit: 'kg' })).toBe('ok')
    expect(verdictForLine({ estimated: 3, sent: 2.995, pricingUnit: 'kg' })).toBe('ok')
  })

  it('trata linha ainda não conferida como pendente, não como erro', () => {
    expect(verdictForLine({ estimated: 3, sent: null, pricingUnit: 'kg' })).toBe('ok')
  })

  it('pergunta acima de 20% em item por unidade, para cima e para baixo', () => {
    expect(verdictForLine({ estimated: 100, sent: 121, pricingUnit: 'un' })).toBe('exige_motivo')
    expect(verdictForLine({ estimated: 100, sent: 79, pricingUnit: 'un' })).toBe('exige_motivo')
    expect(verdictForLine({ estimated: 100, sent: 120, pricingUnit: 'un' })).toBe('ok')
    expect(verdictForLine({ estimated: 100, sent: 80, pricingUnit: 'un' })).toBe('ok')
  })

  it('pergunta mais cedo no quilo, que erra por tara e balanca', () => {
    expect(verdictForLine({ estimated: 3, sent: 3.31, pricingUnit: 'kg' })).toBe('exige_motivo')
    expect(verdictForLine({ estimated: 3, sent: 2.69, pricingUnit: 'kg' })).toBe('exige_motivo')
    expect(verdictForLine({ estimated: 3, sent: 3.3, pricingUnit: 'kg' })).toBe('ok')
  })

  it('pergunta, e nao barra, o engano que realmente acontece', () => {
    // 80 no lugar de 42 e o erro comum, e nenhuma barreira por tamanho o pega:
    // quem protege e a pergunta com os dois numeros lado a lado.
    expect(verdictForLine({ estimated: 42, sent: 80, pricingUnit: 'un' })).toBe('exige_motivo')
    // 420 no lugar de 42 tambem passa a ser pergunta, por decisao do Rodrigo
    // em 2026-08-21: 420 e um numero que a padaria realmente manda.
    expect(verdictForLine({ estimated: 42, sent: 420, pricingUnit: 'un' })).toBe('exige_motivo')
    // E ate o erro de grama por quilo vira pergunta. O risco de alguem
    // confirmar sem ler e aceito na fase 1, onde nada vira dinheiro; a trava
    // de saida da fase 2 e que o fecha.
    expect(verdictForLine({ estimated: 3, sent: 3000, pricingUnit: 'kg' })).toBe('exige_motivo')
  })

  it('recusa fração em item vendido por unidade', () => {
    expect(verdictForLine({ estimated: 50, sent: 55.5, pricingUnit: 'un' })).toBe('recusado')
    expect(verdictForLine({ estimated: 50, sent: 55, pricingUnit: 'un' })).toBe('ok')
  })

  it('trata zero como decisão declarada, que exige motivo mas não é recusa', () => {
    // O piso de um terço zeraria qualquer coisa; zero precisa escapar dele,
    // senão "não enviei este item" viraria impossível.
    expect(verdictForLine({ estimated: 50, sent: 0, pricingUnit: 'un' })).toBe('exige_motivo')
  })

  it('pergunta quando não há estimativa com que comparar', () => {
    expect(verdictForLine({ estimated: 0, sent: 5, pricingUnit: 'un' })).toBe('exige_motivo')
    expect(verdictForLine({ estimated: -3, sent: 5, pricingUnit: 'kg' })).toBe('exige_motivo')
  })

  it('recusa somente o que não é questão de quantidade', () => {
    expect(verdictForLine({ estimated: 42, sent: -1, pricingUnit: 'un' })).toBe('recusado')
    expect(verdictForLine({ estimated: 42, sent: 55.5, pricingUnit: 'un' })).toBe('recusado')
  })

  it('ainda deixa declarar que nada saiu de uma linha sem estimativa', () => {
    expect(verdictForLine({ estimated: 0, sent: 0, pricingUnit: 'un' })).toBe('exige_motivo')
  })
})

describe('o que impede o salvamento', () => {
  it('libera quando tudo está dentro da faixa normal', () => {
    // 3,067 contra 3 kg da 2,2%: e a diferenca real do dia a dia.
    expect(problemsBeforeSaving([linha({ sent: 3.067 })])).toEqual([])
  })

  it('cobra o motivo do item não enviado, com o nome do produto na mensagem', () => {
    const [problema] = problemsBeforeSaving([linha({ sent: 0 })])
    expect(problema.verdict).toBe('exige_motivo')
    expect(problema.message).toContain('Mini-croissant')
    expect(problema.message).toContain('não foi enviado')
  })

  it('aceita o item não enviado assim que existe motivo', () => {
    expect(problemsBeforeSaving([linha({ sent: 0, reason: 'cliente recusou na porta' })])).toEqual([])
  })

  it('não aceita motivo em branco disfarçado de espaço', () => {
    expect(problemsBeforeSaving([linha({ sent: 0, reason: '   ' })])).toHaveLength(1)
  })

  it('explica a recusa por unidade sem pedir motivo, porque motivo não resolve', () => {
    const [problema] = problemsBeforeSaving([
      linha({ productLabel: 'Pão de cachorro-quente', estimated: 50, sent: 55.5, pricingUnit: 'un' }),
    ])
    expect(problema.verdict).toBe('recusado')
    expect(problema.message).toContain('não aceita fração')
  })

  it('acumula um problema por linha, para a tela apontar cada uma', () => {
    const problemas = problemsBeforeSaving([
      linha({ orderId: 'a', sent: 0 }),
      linha({ orderId: 'b', sent: 3.067 }),
      linha({ orderId: 'c', estimated: 3, sent: 3000 }),
    ])
    expect(problemas.map(p => p.orderId)).toEqual(['a', 'c'])
  })

  it('a pergunta mostra o pedido e o digitado lado a lado', () => {
    const [problema] = problemsBeforeSaving([
      linha({ productLabel: 'Brioche', estimated: 42, sent: 80, pricingUnit: 'un' }),
    ])
    // Sem os dois numeros juntos, confirmar vira habito e o erro passa.
    expect(problema.message).toContain('42 un')
    expect(problema.message).toContain('80 un')
    expect(problema.message).toContain('Confirma?')
  })
})

describe('liberação do "marcar como enviado"', () => {
  it('bloqueia enquanto houver item não conferido e diz quantos faltam', () => {
    const estado = dispatchReadiness([{ sent: 3 }, { sent: null }, { sent: null }])
    expect(estado.ready).toBe(false)
    expect(estado.pending).toBe(2)
    expect(estado.reason).toContain('2 itens')
  })

  it('usa o singular quando falta um só', () => {
    expect(dispatchReadiness([{ sent: null }]).reason).toContain('1 item')
  })

  it('libera com tudo conferido, inclusive item não enviado', () => {
    expect(dispatchReadiness([{ sent: 3.067 }, { sent: 0 }]).ready).toBe(true)
  })

  it('não libera pedido sem itens', () => {
    expect(dispatchReadiness([]).ready).toBe(false)
  })
})

describe('versão da tela', () => {
  it('é o carimbo mais recente entre as linhas', () => {
    expect(versionOf([
      { checkedAt: '2026-08-20T10:00:00Z' },
      { checkedAt: '2026-08-20T12:00:00Z' },
      { checkedAt: null },
    ])).toBe('2026-08-20T12:00:00Z')
  })

  it('é nula quando nada foi conferido ainda', () => {
    expect(versionOf([{ checkedAt: null }, { checkedAt: null }])).toBeNull()
  })
})
