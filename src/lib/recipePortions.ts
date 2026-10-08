// Rendimento da ficha por porção: a receita é uma só e cada variante (ou o
// produto sem variante) divide a mesma massa em porções de peso próprio.
//
// - Massa por unidade: o que a padeira divide. É o divisor do rendimento:
//   rende = massa da receita ÷ massa por unidade.
// - Peso assado: opcional. Só serve para a perda de forno e para o peso médio
//   do pão pronto (venda e pedido por quilo). Nunca entra no rendimento.
//
// Grava nas colunas que já existem em product_recipe_yields:
// dough_weight_kg (massa da receita), yield_units (rende) e
// finished_weight_kg (assado da receita inteira). Sem peso assado informado,
// finished_weight_kg = massa, como a ficha sempre gravou.

import { parsePositiveDecimalInput } from './saleOptions'

export type RecipePortionBasis = 'dough' | 'baked' | 'unit'

export interface StoredRecipeYield {
  basis: RecipePortionBasis
  dough_weight_kg: number | string | null
  finished_weight_kg: number | string | null
  yield_units: number | string | null
  average_unit_weight_kg: number | string | null
}

export interface PortionDraft {
  portionG: string
  bakedG: string
}

export interface PortionYieldValues {
  dough_weight_kg: number | null
  finished_weight_kg: number
  yield_units: number
}

export type PortionYieldResult =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | {
      status: 'ok'
      values: PortionYieldValues
      averageUnitWeightKg: number
      bakeLossPct: number | null
    }

// Diferença abaixo de meio grama na receita inteira é arredondamento, não
// perda de forno: a ficha antiga grava assado = massa.
const BAKE_LOSS_TOLERANCE_KG = 0.0005

function positiveNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

export function formatGrams(kg: number): string {
  const grams = Math.round(kg * 1000 * 10) / 10
  return grams.toLocaleString('pt-BR', { maximumFractionDigits: 1, useGrouping: false })
}

function parseGrams(raw: string): number | null | 'invalid' {
  if (!raw.trim()) return null
  const grams = parsePositiveDecimalInput(raw)
  return grams === null ? 'invalid' : grams
}

// Lê a ficha gravada como o rascunho da tela. A massa por unidade sai de
// massa ÷ rende quando os dois existem; senão do peso médio, que é o número
// que a tela antiga usava como divisor. O peso assado só aparece quando a
// ficha registra perda de forno de verdade.
export function portionDraftFromYield(stored: StoredRecipeYield | null): PortionDraft {
  if (!stored) return { portionG: '', bakedG: '' }
  const dough = positiveNumber(stored.dough_weight_kg)
  const finished = positiveNumber(stored.finished_weight_kg)
  const units = positiveNumber(stored.yield_units)
  const average = positiveNumber(stored.average_unit_weight_kg)

  const portionKg = dough !== null && units !== null ? dough / units : average
  const hasBakeLoss = stored.basis === 'dough'
    && dough !== null && finished !== null && units !== null
    && dough - finished > BAKE_LOSS_TOLERANCE_KG
  const bakedKg = hasBakeLoss ? finished / units : null

  return {
    portionG: portionKg !== null ? formatGrams(portionKg) : '',
    bakedG: bakedKg !== null ? formatGrams(bakedKg) : '',
  }
}

export function calculatePortionYield(input: {
  basis: RecipePortionBasis
  recipeKg: number | null
  draft: PortionDraft
}): PortionYieldResult {
  const { basis, recipeKg, draft } = input

  if (basis === 'unit') {
    if (recipeKg === null || !(recipeKg > 0)) {
      return { status: 'invalid', message: 'Informe a massa da receita' }
    }
    return {
      status: 'ok',
      values: { dough_weight_kg: recipeKg, finished_weight_kg: recipeKg, yield_units: 1 },
      averageUnitWeightKg: recipeKg,
      bakeLossPct: null,
    }
  }

  const portion = parseGrams(draft.portionG)
  const baked = basis === 'dough' ? parseGrams(draft.bakedG) : null

  if (portion === 'invalid') return { status: 'invalid', message: 'Massa por unidade inválida' }
  if (baked === 'invalid') return { status: 'invalid', message: 'Peso assado inválido' }
  if (portion === null) {
    return baked === null
      ? { status: 'empty' }
      : { status: 'invalid', message: 'Informe a massa por unidade antes do peso assado' }
  }
  if (recipeKg === null || !(recipeKg > 0)) {
    return { status: 'invalid', message: 'Informe a massa da receita para calcular o rendimento' }
  }
  if (baked !== null && baked > portion) {
    return { status: 'invalid', message: 'Peso assado maior que a massa crua: pão não ganha peso no forno' }
  }

  const portionKg = portion / 1000
  const units = recipeKg / portionKg

  if (basis === 'baked') {
    return {
      status: 'ok',
      values: { dough_weight_kg: null, finished_weight_kg: recipeKg, yield_units: units },
      averageUnitWeightKg: portionKg,
      bakeLossPct: null,
    }
  }

  const bakedKg = baked !== null ? baked / 1000 : null
  return {
    status: 'ok',
    values: {
      dough_weight_kg: recipeKg,
      finished_weight_kg: bakedKg !== null ? bakedKg * units : recipeKg,
      yield_units: units,
    },
    averageUnitWeightKg: bakedKg ?? portionKg,
    bakeLossPct: bakedKg !== null ? ((portionKg - bakedKg) / portionKg) * 100 : null,
  }
}

export function portionDraftsEqual(a: PortionDraft, b: PortionDraft): boolean {
  return a.portionG.trim() === b.portionG.trim() && a.bakedG.trim() === b.bakedG.trim()
}
