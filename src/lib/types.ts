// Tipos compartilhados do domínio. Use para shapes que aparecem
// idênticos em mais de um módulo. Variações específicas (campos
// extras ou ausentes) ficam locais por design — não force tipo único.
//
/** Subset de breads usado em telas que listam pães ativos com unit. */
export interface BreadOption {
  id: string
  name: string
  unit: string | null
  is_pj: boolean
  active: boolean
}
