// Rascunho local da contagem do fechamento de sobras.
//
// Existe por um motivo só: quando o banco recusa o fechamento porque ainda há
// sobra de dia anterior sem destino, a contagem já digitada não pode se perder.
// Recontar pão no fim do expediente é o custo que a operação menos pode pagar,
// e foi exatamente isso que aconteceu em 2026-07-22 na JC.
//
// O rascunho é gravado apenas nesse bloqueio, só preenche campos (nunca salva
// sozinho) e é apagado assim que o fechamento entra.

export interface LeftoverDraft {
  store: string
  recordDate: string
  savedAt: string
  quantities: Record<string, number>
}

export interface DraftApplication {
  quantities: Record<string, number>
  applied: boolean
}

export const LEFTOVER_DRAFT_KEY = 'ps.fechamento-sobras.rascunho'

const DRAFT_STORES = ['jc', 'ja']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const QUANTITY_PREFIX = 'bread_'

function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function buildLeftoverDraft(
  store: string,
  recordDate: string,
  quantities: Record<string, number>,
  savedAt: string,
): LeftoverDraft {
  const clean: Record<string, number> = {}
  for (const [key, value] of Object.entries(quantities)) {
    if (key.startsWith(QUANTITY_PREFIX) && isValidQuantity(value)) clean[key] = value
  }
  return { store, recordDate, savedAt, quantities: clean }
}

// Rascunho corrompido, de versão antiga ou adulterado nunca derruba a tela:
// qualquer desvio vira null e o fechamento segue com o que veio do banco.
export function parseLeftoverDraft(raw: string | null): LeftoverDraft | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  const store = candidate.store
  const recordDate = candidate.recordDate
  const savedAt = candidate.savedAt
  const quantities = candidate.quantities

  if (typeof store !== 'string' || !DRAFT_STORES.includes(store)) return null
  if (typeof recordDate !== 'string' || !DATE_PATTERN.test(recordDate)) return null
  if (typeof savedAt !== 'string' || savedAt === '') return null
  if (typeof quantities !== 'object' || quantities === null) return null

  const clean: Record<string, number> = {}
  for (const [key, value] of Object.entries(quantities as Record<string, unknown>)) {
    if (!key.startsWith(QUANTITY_PREFIX) || !isValidQuantity(value)) return null
    clean[key] = value
  }

  return { store, recordDate, savedAt, quantities: clean }
}

export function draftAppliesTo(
  draft: LeftoverDraft | null,
  store: string,
  recordDate: string,
): draft is LeftoverDraft {
  if (!draft) return false
  return draft.store === store && draft.recordDate === recordDate
}

// O rascunho vence o que está salvo: é a contagem mais recente da pessoa, e
// inclui o zero digitado de propósito ("errei, não tem nenhum").
export function applyLeftoverDraft(
  saved: Record<string, number>,
  draft: LeftoverDraft | null,
  store: string,
  recordDate: string,
): DraftApplication {
  if (!draftAppliesTo(draft, store, recordDate)) return { quantities: saved, applied: false }
  if (Object.keys(draft.quantities).length === 0) return { quantities: saved, applied: false }
  return { quantities: { ...saved, ...draft.quantities }, applied: true }
}

type MaybeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined

export function browserDraftStorage(): MaybeStorage {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readLeftoverDraft(storage: MaybeStorage): LeftoverDraft | null {
  if (!storage) return null
  try {
    return parseLeftoverDraft(storage.getItem(LEFTOVER_DRAFT_KEY))
  } catch {
    return null
  }
}

export function writeLeftoverDraft(storage: MaybeStorage, draft: LeftoverDraft): void {
  if (!storage) return
  try {
    storage.setItem(LEFTOVER_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Navegador sem espaço ou em modo restrito: seguir sem rascunho é melhor
    // que interromper o fechamento.
  }
}

export function clearLeftoverDraft(storage: MaybeStorage): void {
  if (!storage) return
  try {
    storage.removeItem(LEFTOVER_DRAFT_KEY)
  } catch {
    // Mesmo motivo do writeLeftoverDraft.
  }
}
