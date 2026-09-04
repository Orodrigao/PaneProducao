/**
 * O valor de uma linha de pedido PJ, espelhando `private.valor_linha_pj`.
 *
 * A mesma conta existia em cinco lugares e por isso a tela podia mostrar um
 * número e a cobrança gerar outro. Agora o banco tem uma função e a tela tem
 * este espelho, com a mesma tabela de casos. Quando um dos dois mudar, o outro
 * muda junto: o teste `cobranca_pelo_real.test.sql` compara os dois números
 * para o mesmo pedido.
 *
 * Regra, na ordem:
 *   1. conferido pela Expedição manda, inclusive quando é zero;
 *   2. sem conferência, mas enviado antes de 21/08, cobra a estimativa (é o
 *      legado, de quando o campo não existia);
 *   3. o resto não tem valor cobrável, e devolve `null` em vez de zero. Zero
 *      somaria em silêncio e faria a fatura sair menor sem ninguém saber.
 */

/** 21/08/2026, 00:00 no fuso da padaria: o dia em que a conferência nasceu. */
export const MARCO_COBRANCA_PELO_REAL = Date.parse('2026-08-21T03:00:00.000Z')

/** Acima disso a cobrança não nasce e o pedido espera o financeiro olhar. */
export const TETO_LINHA_KG = 50
export const TETO_LINHA_UN = 2000
export const FATOR_MAXIMO = 3
export const FATOR_MINIMO = 1 / 3

export type PjLineVerdict = 'ok' | 'fora_da_faixa' | 'acima_do_teto'

export interface PjLineValueInput {
  quantity: number | string | null | undefined
  dispatchedQuantity: number | string | null | undefined
  unitPrice: number | string | null | undefined
  dispatchedAt: string | null | undefined
  pricingUnit?: string | null
}

function asNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function asOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * Arredonda a centavos como o Postgres arredonda `numeric`, e não como o
 * JavaScript arredonda binário.
 *
 * `1,005 × 1,00` vira `100.49999999999999` em ponto flutuante, e `Math.round`
 * puro devolveria R$ 1,00 enquanto o banco devolve R$ 1,01. A tela mostraria um
 * centavo a menos do que a cobrança, que é exatamente a divergência que esta
 * dupla de funções existe para impedir. A correção mínima é empurrar o valor de
 * volta para o meio antes de arredondar.
 */
function centavos(value: number): number {
  const escalado = value * 100
  const ajuste = escalado >= 0 ? 1e-9 : -1e-9
  return Math.round(escalado + ajuste) / 100
}

/** `null` quando não há valor cobrável. Ver a regra no topo do arquivo. */
export function pjLineValue(line: PjLineValueInput): number | null {
  const dispatched = asOptionalNumber(line.dispatchedQuantity)
  const price = asNumber(line.unitPrice)

  if (dispatched !== null) return centavos(dispatched * price)

  if (line.dispatchedAt) {
    const enviadoEm = Date.parse(line.dispatchedAt)
    if (Number.isFinite(enviadoEm) && enviadoEm < MARCO_COBRANCA_PELO_REAL) {
      return centavos(asNumber(line.quantity) * price)
    }
  }

  return null
}

/** O valor que a linha teria pela estimativa, para mostrar o antes e o depois. */
export function pjLineEstimatedValue(line: PjLineValueInput): number {
  return centavos(asNumber(line.quantity) * asNumber(line.unitPrice))
}

/**
 * A trava de saída, por linha. Zero nunca é recusado: é falta declarada, com
 * motivo obrigatório desde a fase 1, e não desvio de quantidade.
 */
export function pjLineVerdict(line: PjLineValueInput): PjLineVerdict {
  const dispatched = asOptionalNumber(line.dispatchedQuantity)
  if (dispatched === null || dispatched === 0) return 'ok'

  const porQuilo = (line.pricingUnit || 'un') === 'kg'
  if (porQuilo ? dispatched > TETO_LINHA_KG : dispatched > TETO_LINHA_UN) {
    return 'acima_do_teto'
  }

  const estimado = asNumber(line.quantity)
  if (estimado <= 0) return 'ok'

  const fator = dispatched / estimado
  if (fator > FATOR_MAXIMO || fator < FATOR_MINIMO) return 'fora_da_faixa'
  return 'ok'
}

export interface PjOrderValueSummary {
  /** O que a cobrança vai usar, ou `null` se alguma linha não tem valor. */
  valor: number | null
  /** O que a cobrança usaria pela estimativa. Serve para o antes e o depois. */
  valorEstimado: number
  linhasSemValor: number
  linhasForaDaTrava: number
  linhasConferidas: number
  /** Verdadeiro quando tudo foi conferido e nada saiu. */
  nadaEnviado: boolean
}

/** O resumo de um pedido inteiro, com cada linha arredondada antes da soma. */
export function summarizePjOrderValue(lines: readonly PjLineValueInput[]): PjOrderValueSummary {
  let valor = 0
  let valorEstimado = 0
  let linhasSemValor = 0
  let linhasForaDaTrava = 0
  let linhasConferidas = 0

  for (const line of lines) {
    const linha = pjLineValue(line)
    if (linha === null) linhasSemValor += 1
    else valor += linha

    valorEstimado += pjLineEstimatedValue(line)
    if (asOptionalNumber(line.dispatchedQuantity) !== null) linhasConferidas += 1
    if (pjLineVerdict(line) !== 'ok') linhasForaDaTrava += 1
  }

  return {
    valor: linhasSemValor > 0 ? null : centavos(valor),
    valorEstimado: centavos(valorEstimado),
    linhasSemValor,
    linhasForaDaTrava,
    linhasConferidas,
    nadaEnviado: lines.length > 0 && linhasConferidas === lines.length && centavos(valor) === 0,
  }
}

/** O valor a mostrar na tela: o cobrável quando existe, a estimativa quando não. */
export function pjOrderDisplayValue(lines: readonly PjLineValueInput[]): number {
  const resumo = summarizePjOrderValue(lines)
  return resumo.valor ?? resumo.valorEstimado
}
