import { describe, expect, it } from 'vitest'
import {
  describeMissingProductionDays,
  describeProductionName,
  describeUnitMismatch,
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

  it('avisa antes de salvar o que o banco recusaria pela ligação', () => {
    const pao = { is_fabricacao_propria: true, kind: 'final' as const, production_process: 'forno' as const, legacy_bread_id: 'pao-1' }
    expect(storePlanningBlockReason(pao, { is_pj: true })).toMatch(/item PJ antigo/)
    expect(storePlanningBlockReason(pao, null)).toMatch(/não existe mais/)
    expect(storePlanningBlockReason(pao, { is_pj: false })).toBeNull()
  })

  it('sem a lista de pães informada, não presume ligação quebrada', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', legacy_bread_id: 'pao-1' })).toBeNull()
  })

  it('produto ainda sem pão ligado não depende da lista de pães', () => {
    expect(storePlanningBlockReason({ is_fabricacao_propria: true, kind: 'final', legacy_bread_id: null }, null)).toBeNull()
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

describe('describeUnitMismatch', () => {
  it('avisa quando produto e pão contam em unidades diferentes', () => {
    expect(describeUnitMismatch('kg', 'un')).toMatch(/contado em unidade/)
    expect(describeUnitMismatch('un', 'kg')).toMatch(/contado em quilo/)
  })

  it('aceita as grafias de produção como a mesma unidade', () => {
    expect(describeUnitMismatch('KG', 'kg')).toBeNull()
    expect(describeUnitMismatch('', 'un')).toBeNull()
    expect(describeUnitMismatch('Un', 'un')).toBeNull()
  })

  it('fica quieto quando ainda não há pão ligado', () => {
    expect(describeUnitMismatch('kg', undefined)).toBeNull()
  })
})

describe('describeMissingProductionDays', () => {
  it('avisa quem vai para as lojas sem dia marcado', () => {
    expect(describeMissingProductionDays([])).toMatch(/só na busca do Romaneio/)
    expect(describeMissingProductionDays(null)).toMatch(/só na busca do Romaneio/)
  })

  it('fica quieto com pelo menos um dia', () => {
    expect(describeMissingProductionDays([6])).toBeNull()
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
