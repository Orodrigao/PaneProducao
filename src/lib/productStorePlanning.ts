import type { ProductionProcess } from './productOperationalClassification'

// "Lojas" no cadastro do catálogo: o produto vai para o Planejamento da
// produção, o pedido das lojas, a parte das lojas no Forno e o Romaneio.
// Essas telas leem a lista antiga de pães; quem cria e mantém o pão ligado é o
// banco (private.sincronizar_pao_das_lojas), a partir desta marcação. Antes
// dela, o pão cadastrado só no catálogo nunca chegava à produção (LA Rustico,
// outubro de 2026). As regras abaixo espelham a trava
// products_is_loja_requer_pao_de_forno, para a tela explicar antes de o banco
// recusar.

export interface StorePlanningInput {
  is_fabricacao_propria?: boolean | null
  kind?: 'kit' | 'insumo' | 'final' | null
  production_process?: ProductionProcess | null
}

/**
 * Por que o produto não pode ir para as lojas, em uma frase, ou nulo quando
 * pode. Tipo vazio conta como final, que é o que a tela mostra nesse caso.
 */
export function storePlanningBlockReason(input: StorePlanningInput): string | null {
  if (!input.is_fabricacao_propria) {
    return 'Só produto de fabricação própria vai para o Planejamento das lojas.'
  }
  const kind = input.kind ?? 'final'
  if (kind !== 'final') {
    return 'Kit e insumo não entram no Planejamento das lojas; só produto final.'
  }
  if (input.production_process && input.production_process !== 'forno') {
    return 'Produto de montagem ou preparo é feito pela Cozinha, não entra no Planejamento das lojas.'
  }
  return null
}

/** Marcação que vai ao banco: desmarcada sempre que o produto não pode ir. */
export function resolveIsLojaForSave(input: StorePlanningInput & { is_loja?: boolean | null }): boolean {
  return Boolean(input.is_loja) && storePlanningBlockReason(input) === null
}

/**
 * Salvar assim tira das lojas um produto que estava lá? A tela pede
 * confirmação, porque ele some do Planejamento, do pedido das lojas e do
 * Romaneio no mesmo instante.
 */
export function leavesStorePlanning(wasLoja: boolean | null | undefined, willBeLoja: boolean): boolean {
  return Boolean(wasLoja) && !willBeLoja
}

/**
 * Frase sobre o nome que a produção usa, quando difere do catálogo. O pão
 * antigo mantém o nome curto que a equipe conhece ("B.Brasil") até alguém
 * renomear o produto; sem esta frase, quem procura "Baguete Brasil" no
 * Planejamento não acha.
 */
export function describeProductionName(
  productName: string | null | undefined,
  breadName: string | null | undefined,
): string | null {
  const product = (productName ?? '').trim()
  const bread = (breadName ?? '').trim()
  if (!bread || bread === product) return null
  return `Na produção e no Romaneio aparece como “${bread}”. Renomear este produto troca lá também.`
}
