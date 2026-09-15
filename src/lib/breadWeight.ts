// Peso médio de uma unidade assada (breads.avg_unit_weight_kg). Só existe
// para converter pedido PJ cobrado por peso em quantidade de peças no
// previsto do Forno — não é o peso da receita nem afeta cobrança.
export function parseBreadWeightKg(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return null
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const weight = Number(normalized)
  if (!Number.isFinite(weight) || weight <= 0 || weight > 50) return null
  return weight
}
