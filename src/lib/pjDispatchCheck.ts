/**
 * Conferência da quantidade realmente enviada em Pedidos PJ (fase 1).
 *
 * Três estados por linha, e a diferença entre eles é o ponto da fase:
 *   - `null`  — ainda não conferido;
 *   - `0`     — conferido e NÃO enviado, sempre com motivo;
 *   - `> 0`   — enviado, nessa quantidade.
 *
 * Zero e ausência não podem se confundir: a fase 2 vai cobrar por
 * `enviado ?? estimado`, então "não enviei este item" gravado como ausência
 * cobraria do cliente justamente o item que não saiu.
 *
 * As duas travas abaixo espelham `private.veredito_quantidade_enviada` no
 * banco. O banco é quem decide de verdade — isto aqui existe para a pessoa
 * saber antes de salvar, nunca para substituir a validação de lá.
 */

export type PricingUnit = 'un' | 'kg'

/** Acima disso a pessoa confirma por escrito. */
export const LIMITE_CONFIRMACAO = 0.2
/** Acima disso ninguém passa, nem confirmando. */
export const FATOR_MAXIMO = 3

export type CheckVerdict = 'ok' | 'exige_motivo' | 'recusado'

export interface CheckLineInput {
  /** A estimativa lançada no pedido, na unidade em que ele foi digitado. */
  estimated: number
  /** O que a expedição digitou. `null` = ainda não conferiu. */
  sent: number | null
  pricingUnit: string | null
}

/**
 * O veredito de uma linha. Mesma ordem de decisão do banco, de propósito:
 * unidade, depois zero, depois proporção.
 */
export function verdictForLine({ estimated, sent, pricingUnit }: CheckLineInput): CheckVerdict {
  if (sent === null) return 'ok'
  if (!Number.isFinite(sent) || sent < 0) return 'recusado'

  // Não existe 1,5 pão. Item por quilo aceita as três casas do banco.
  if ((pricingUnit || 'un') === 'un' && !Number.isInteger(sent)) return 'recusado'

  // Zero é decisão declarada, não desvio de quantidade: a proporção não se
  // aplica, mas o motivo é obrigatório.
  if (sent === 0) return 'exige_motivo'

  // Sem estimativa nao ha proporcao a comparar, e sem proporcao o teto duro
  // deixa de existir: uma linha estimada em zero aceitaria qualquer numero com
  // um texto qualquer. Enviar o que nao foi pedido e recusa.
  if (!Number.isFinite(estimated) || estimated <= 0) return 'recusado'

  const fator = sent / estimated
  if (fator > FATOR_MAXIMO || fator < 1 / FATOR_MAXIMO) return 'recusado'
  if (fator > 1 + LIMITE_CONFIRMACAO || fator < 1 - LIMITE_CONFIRMACAO) return 'exige_motivo'
  return 'ok'
}

export interface CheckLineState extends CheckLineInput {
  orderId: string
  productLabel: string
  reason: string
}

export interface CheckLineProblem {
  orderId: string
  productLabel: string
  verdict: Exclude<CheckVerdict, 'ok'>
  /** Texto pronto para a tela, sempre dizendo o que fazer. */
  message: string
}

function formatQuantity(value: number, pricingUnit: string | null): string {
  const unidade = (pricingUnit || 'un') === 'kg' ? 'kg' : 'un'
  const texto = unidade === 'kg'
    ? value.toFixed(3).replace(/\.?0+$/, '').replace('.', ',')
    : String(value)
  return `${texto} ${unidade}`
}

/**
 * Tudo que impede o salvamento agora, com o motivo escrito. A tela mostra
 * estas mensagens ao lado do campo — controle desabilitado sem motivo visível
 * é lido como defeito (lição `botao-desabilitado-sem-motivo-na-tela`).
 */
export function problemsBeforeSaving(lines: CheckLineState[]): CheckLineProblem[] {
  const problemas: CheckLineProblem[] = []

  lines.forEach(line => {
    const verdict = verdictForLine(line)
    if (verdict === 'ok') return

    if (verdict === 'recusado') {
      const porUnidade = (line.pricingUnit || 'un') === 'un'
      const naoInteiro = porUnidade && line.sent !== null && !Number.isInteger(line.sent)
      problemas.push({
        orderId: line.orderId,
        productLabel: line.productLabel,
        verdict,
        message: naoInteiro
          ? `${line.productLabel} é vendido por unidade e não aceita fração. Digite um número inteiro.`
          : `${line.productLabel}: o pedido é de ${formatQuantity(line.estimated, line.pricingUnit)} e você digitou um número muito distante disso. Confira a unidade antes de salvar.`,
      })
      return
    }

    if (!line.reason.trim()) {
      const naoEnviado = line.sent === 0
      problemas.push({
        orderId: line.orderId,
        productLabel: line.productLabel,
        verdict,
        message: naoEnviado
          ? `${line.productLabel}: escreva por que este item não foi enviado.`
          : `${line.productLabel}: a quantidade difere bastante do pedido. Escreva o motivo para salvar.`,
      })
    }
  })

  return problemas
}

export interface DispatchReadiness {
  ready: boolean
  pending: number
  /** Vazio quando pode enviar. Caso contrário, o motivo escrito para a tela. */
  reason: string
}

/**
 * "Marcar como enviado" só libera com tudo conferido. O texto do bloqueio vai
 * ao lado do botão, nunca em tooltip: no celular tooltip não existe.
 */
export function dispatchReadiness(lines: Array<{ sent: number | null }>): DispatchReadiness {
  if (lines.length === 0) {
    return { ready: false, pending: 0, reason: 'Este pedido não tem itens para enviar.' }
  }

  const pending = lines.filter(line => line.sent === null).length
  if (pending === 0) return { ready: true, pending: 0, reason: '' }

  return {
    ready: false,
    pending,
    reason: pending === 1
      ? 'Falta conferir 1 item antes de marcar como enviado.'
      : `Faltam conferir ${pending} itens antes de marcar como enviado.`,
  }
}

/**
 * A "versão" que a tela abriu: o carimbo de conferência mais recente do
 * pedido. Volta ao banco no salvamento, e se alguém gravou no meio a gravação
 * é recusada — senão vence quem salvar por último, não quem está certo.
 */
export function versionOf(lines: Array<{ checkedAt: string | null }>): string | null {
  const carimbos = lines
    .map(line => line.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  return carimbos.length > 0 ? carimbos[carimbos.length - 1] : null
}
