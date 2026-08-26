/**
 * A validação da conferência de recebimento do Romaneio, tirada da tela para
 * poder ser exercitada sem navegador.
 *
 * Motivo de existir: em 2026-08-26 a Marselle relatou que, quando o romaneio
 * diz 10 pães e ela recebe 11, não consegue salvar; para menos salva. A tela
 * pede DOIS números por item (Recebido e Aceito/Cobrável) e recusa aceito
 * maior que recebido — regra correta, porque ninguém cobra mais do que
 * recebeu. Só que a recusa some dentro de uma mensagem genérica, então quem
 * digitou 11 no campo de baixo não tem como saber o que a tela quer.
 */

import { ROMANEIO_WEIGHT_LIMIT_KG } from './romaneioDraft'

export interface RomaneioConferenceLine {
  productName: string
  /** Quanto chegou na loja. */
  received: number
  /** Quanto a loja aceita pagar. Nunca pode passar do que chegou. */
  accepted: number
  /** Item vendido por peso: cai no teto de kg. */
  weightControlled?: boolean
}

export type RomaneioConferenceProblem =
  | 'sem-numero'
  | 'numero-negativo'
  | 'aceito-maior-que-recebido'
  | 'acima-do-limite-de-peso'

export interface RomaneioConferenceVerdict {
  ok: boolean
  problem?: RomaneioConferenceProblem
  productName?: string
}

/**
 * Devolve o primeiro problema que impede fechar a conferência, ou `ok`.
 *
 * A ordem importa: peso fora do limite é conferido depois dos números, porque
 * um campo em branco não deve ser reportado como excesso de peso.
 */
export function validateRomaneioConference(
  lines: RomaneioConferenceLine[],
): RomaneioConferenceVerdict {
  if (lines.length === 0) return { ok: false, problem: 'sem-numero' }

  for (const line of lines) {
    if (!Number.isFinite(line.received) || !Number.isFinite(line.accepted)) {
      return { ok: false, problem: 'sem-numero', productName: line.productName }
    }
    if (line.received < 0 || line.accepted < 0) {
      return { ok: false, problem: 'numero-negativo', productName: line.productName }
    }
    if (line.accepted > line.received) {
      return { ok: false, problem: 'aceito-maior-que-recebido', productName: line.productName }
    }
  }

  for (const line of lines) {
    if (!line.weightControlled) continue
    if (line.received > ROMANEIO_WEIGHT_LIMIT_KG || line.accepted > ROMANEIO_WEIGHT_LIMIT_KG) {
      return { ok: false, problem: 'acima-do-limite-de-peso', productName: line.productName }
    }
  }

  return { ok: true }
}
