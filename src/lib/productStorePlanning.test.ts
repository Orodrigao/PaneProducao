import { describe, expect, it } from 'vitest'
import {
  describeProductionName,
  leavesStorePlanning,
  resolveIsLojaForSave,
  storePlanningBlockReason,
} from './productStorePlanning'

describe('storePlanningBlockReason', () => {
  it('libera pão de forno de fabricação própria, como o LA Rustico', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', production_process: 'forno' })).toBeNull()
  })

  it('libera pão antigo ainda sem processo revisado, que já está na produção', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', production_process: null })).toBeNull()
  })

  it('trata tipo vazio como final, que é o que a tela mostra', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: null, production_process: 'forno' })).toBeNull()
  })

  it('barra revenda', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: false, kind: 'final', production_process: null }))
      .toMatch(/fabricação própria/)
  })

  it('barra kit e insumo', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'kit' })).toMatch(/Kit e insumo/)
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'insumo' })).toMatch(/Kit e insumo/)
  })

  it('manda montagem e preparo para a Cozinha', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', production_process: 'montagem' }))
      .toMatch(/Cozinha/)
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', production_process: 'preparo' }))
      .toMatch(/Cozinha/)
  })
})

describe('resolveIsLojaForSave', () => {
  it('mantém a marcação de quem pode ir para as lojas', () => {
    expect(resolveIsLojaForSave({ is_loja: true, is_fabricacao_propria: true, kind: 'final', production_process: 'forno' })).toBe(true)
  })

  it('desmarca quem deixou de poder ir, em vez de deixar o banco recusar o salvamento inteiro', () => {
    expect(resolveIsLojaForSave({ is_loja: true, is_fabricacao_propria: false, kind: 'final' })).toBe(false)
    expect(resolveIsLojaForSave({ is_loja: true, is_fabricacao_propria: true, kind: 'final', production_process: 'montagem' })).toBe(false)
  })

  it('não marca sozinho', () => {
    expect(resolveIsLojaForSave({ is_loja: false, is_fabricacao_propria: true, kind: 'final', production_process: 'forno' })).toBe(false)
    expect(resolveIsLojaForSave({ is_fabricacao_propria: true, kind: 'final', production_process: 'forno' })).toBe(false)
  })
})

describe('leavesStorePlanning', () => {
  it('avisa só quando o produto estava nas lojas e vai sair', () => {
    expect(leavesStorePlanning(true, false)).toBe(true)
    expect(leavesStorePlanning(true, true)).toBe(false)
    expect(leavesStorePlanning(false, false)).toBe(false)
    expect(leavesStorePlanning(undefined, true)).toBe(false)
  })
})

describe('describeProductionName', () => {
  it('mostra o nome curto que a produção usa quando difere do catálogo', () => {
    expect(describeProductionName('Baguete Brasil', 'B.Brasil')).toBe(
      'Na produção e no Romaneio aparece como “B.Brasil”. Renomear este produto troca lá também.',
    )
  })

  it('fica quieto quando o nome é o mesmo ou o pão ainda não existe', () => {
    expect(describeProductionName('LA Rustico', 'LA Rustico')).toBeNull()
    expect(describeProductionName(' LA Rustico ', 'LA Rustico')).toBeNull()
    expect(describeProductionName('LA Rustico', null)).toBeNull()
  })
})
