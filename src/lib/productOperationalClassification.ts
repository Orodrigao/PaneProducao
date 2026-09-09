export type ProductionProcess = 'forno' | 'montagem' | 'preparo'

export interface OperationalClassificationInput {
  is_fabricacao_propria?: boolean
  production_area?: string | null
  production_process?: ProductionProcess | null
  allows_planned_production?: boolean | null
  allows_unplanned_production?: boolean | null
}

export interface OperationalClassificationValue {
  production_process: ProductionProcess | null
  allows_planned_production: boolean | null
  allows_unplanned_production: boolean | null
}

interface NormalizeOptions {
  requireComplete?: boolean
}

type NormalizationResult =
  | { ok: true; value: OperationalClassificationValue }
  | { ok: false; error: string }

export function requiresCompleteOperationalClassification(
  isNew: boolean,
  wasOwnProduction: boolean,
  isOwnProduction: boolean,
): boolean {
  return isOwnProduction && (isNew || !wasOwnProduction)
}

export function normalizeOperationalClassification(
  input: OperationalClassificationInput,
  options: NormalizeOptions = {},
): NormalizationResult {
  const emptyValue: OperationalClassificationValue = {
    production_process: null,
    allows_planned_production: null,
    allows_unplanned_production: null,
  }

  if (!input.is_fabricacao_propria) return { ok: true, value: emptyValue }

  const process = input.production_process ?? null
  if (!process) {
    if (options.requireComplete) {
      return { ok: false, error: 'Informe como esse produto é produzido: forno, montagem ou preparo.' }
    }
    return { ok: true, value: emptyValue }
  }

  if (!input.production_area) {
    return { ok: false, error: 'Informe a área responsável pela produção.' }
  }

  if (input.allows_planned_production === null || input.allows_planned_production === undefined
    || input.allows_unplanned_production === null || input.allows_unplanned_production === undefined) {
    return { ok: false, error: 'Informe como a produção pode ser lançada.' }
  }

  if (!input.allows_planned_production && !input.allows_unplanned_production) {
    return { ok: false, error: 'Escolha ao menos uma forma de produção: planejada ou sem ordem.' }
  }

  return {
    ok: true,
    value: {
      production_process: process,
      allows_planned_production: input.allows_planned_production,
      allows_unplanned_production: input.allows_unplanned_production,
    },
  }
}
