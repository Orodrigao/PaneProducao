import { describe, expect, it } from 'vitest'
import {
  applyLeftoverDraft,
  buildLeftoverDraft,
  clearLeftoverDraft,
  draftAppliesTo,
  LEFTOVER_DRAFT_KEY,
  parseLeftoverDraft,
  readLeftoverDraft,
  writeLeftoverDraft,
} from './breadLeftoverDraft'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

describe('rascunho do fechamento de sobras', () => {
  it('guarda somente quantidades de pão válidas', () => {
    const draft = buildLeftoverDraft(
      'jc',
      '2026-07-22',
      { bread_integral: 4, bread_ciabatta: 0, croissant_avulso: 3, bread_quebrado: Number.NaN },
      '2026-07-22T20:15:00.000Z',
    )

    expect(draft.quantities).toEqual({ bread_integral: 4, bread_ciabatta: 0 })
  })

  it('recupera o rascunho gravado', () => {
    const storage = fakeStorage()
    const draft = buildLeftoverDraft('ja', '2026-07-22', { bread_italiano: 2 }, '2026-07-22T20:15:00.000Z')

    writeLeftoverDraft(storage, draft)
    expect(readLeftoverDraft(storage)).toEqual(draft)

    clearLeftoverDraft(storage)
    expect(readLeftoverDraft(storage)).toBeNull()
  })

  it('descarta rascunho corrompido, incompleto ou de loja inválida', () => {
    expect(parseLeftoverDraft(null)).toBeNull()
    expect(parseLeftoverDraft('{ não é json')).toBeNull()
    expect(parseLeftoverDraft('"texto"')).toBeNull()
    expect(parseLeftoverDraft(JSON.stringify({
      store: 'ex', recordDate: '2026-07-22', savedAt: 'x', quantities: {},
    }))).toBeNull()
    expect(parseLeftoverDraft(JSON.stringify({
      store: 'jc', recordDate: '22/07/2026', savedAt: 'x', quantities: {},
    }))).toBeNull()
    expect(parseLeftoverDraft(JSON.stringify({
      store: 'jc', recordDate: '2026-07-22', savedAt: 'x', quantities: { bread_integral: -1 },
    }))).toBeNull()
    expect(parseLeftoverDraft(JSON.stringify({
      store: 'jc', recordDate: '2026-07-22', savedAt: 'x', quantities: { integral: 2 },
    }))).toBeNull()
  })

  it('não devolve rascunho de outra loja nem de outro dia', () => {
    const draft = buildLeftoverDraft('jc', '2026-07-22', { bread_integral: 4 }, 'x')

    expect(draftAppliesTo(draft, 'jc', '2026-07-22')).toBe(true)
    expect(draftAppliesTo(draft, 'ja', '2026-07-22')).toBe(false)
    expect(draftAppliesTo(draft, 'jc', '2026-07-21')).toBe(false)
    expect(draftAppliesTo(null, 'jc', '2026-07-22')).toBe(false)
  })

  it('a contagem digitada vence a que veio do banco, inclusive o zero', () => {
    const saved = { bread_integral: 9, bread_croissant: 2 }
    const draft = buildLeftoverDraft('jc', '2026-07-22', { bread_integral: 4, bread_ciabatta: 0 }, 'x')

    const result = applyLeftoverDraft(saved, draft, 'jc', '2026-07-22')

    expect(result.applied).toBe(true)
    expect(result.quantities).toEqual({ bread_integral: 4, bread_croissant: 2, bread_ciabatta: 0 })
    expect(saved).toEqual({ bread_integral: 9, bread_croissant: 2 })
  })

  it('mantém o que veio do banco quando não há rascunho aplicável', () => {
    const saved = { bread_integral: 9 }
    const outraData = buildLeftoverDraft('jc', '2026-07-21', { bread_integral: 4 }, 'x')
    const vazio = buildLeftoverDraft('jc', '2026-07-22', {}, 'x')

    expect(applyLeftoverDraft(saved, null, 'jc', '2026-07-22')).toEqual({ quantities: saved, applied: false })
    expect(applyLeftoverDraft(saved, outraData, 'jc', '2026-07-22')).toEqual({ quantities: saved, applied: false })
    expect(applyLeftoverDraft(saved, vazio, 'jc', '2026-07-22')).toEqual({ quantities: saved, applied: false })
  })

  it('sobrevive a navegador sem localStorage disponível', () => {
    expect(readLeftoverDraft(undefined)).toBeNull()
    expect(() => writeLeftoverDraft(undefined, buildLeftoverDraft('jc', '2026-07-22', {}, 'x'))).not.toThrow()
    expect(() => clearLeftoverDraft(undefined)).not.toThrow()
  })

  it('usa uma chave própria, sem colidir com outros rascunhos do app', () => {
    const storage = fakeStorage({ 'ps.romaneio.rascunho': '{}' })
    writeLeftoverDraft(storage, buildLeftoverDraft('jc', '2026-07-22', { bread_integral: 1 }, 'x'))

    expect(storage.data.get('ps.romaneio.rascunho')).toBe('{}')
    expect(storage.data.has(LEFTOVER_DRAFT_KEY)).toBe(true)
  })
})
