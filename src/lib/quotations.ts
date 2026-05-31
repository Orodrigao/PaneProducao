// Helpers de cotação. Isolam a geração de mensagem e o envio — hoje via
// link wa.me, amanhã poderiam virar chamadas pra WhatsApp Business API
// sem mexer no consumidor (mesma assinatura).

export interface QuotationItemDetail {
  name: string
  quantity: number
  unit: string | null
}

export interface SupplierContact {
  name: string
  whatsapp_e164: string | null
}

/**
 * Monta o texto pronto pra enviar pro fornecedor: saudação, lista de
 * itens, pedido de preço unitário + disponibilidade em formato simples
 * pra facilitar o parse na F5 (Gemini Flash).
 */
export function buildQuotationMessage(
  supplier: SupplierContact,
  weekRef: string, // ISO date YYYY-MM-DD
  items: QuotationItemDetail[],
): string {
  const lines = items.map(it => {
    const q = Number.isInteger(it.quantity) ? String(it.quantity) : String(it.quantity).replace('.', ',')
    return `• ${it.name} — ${q}${it.unit ? ` ${it.unit}` : ''}`
  }).join('\n')

  // YYYY-MM-DD → DD/MM
  const [y, m, d] = weekRef.split('-')
  const semana = (d && m) ? `${d}/${m}` : weekRef

  return [
    `Olá, ${supplier.name}!`,
    '',
    `Lista de cotação — semana de ${semana}:`,
    lines,
    '',
    'Por favor, responda com *preço unitário* e *disponibilidade* de cada item, no formato:',
    '',
    'Produto X: R$ 1,23/un | sim',
    'Produto Y: indisponível',
    '',
    'Obrigado!',
  ].join('\n')
}

/**
 * Constrói o deeplink wa.me a partir do whatsapp_e164 do fornecedor.
 * Retorna null se o fornecedor não tem WhatsApp cadastrado em E.164 válido.
 */
export function buildWhatsAppLink(supplier: SupplierContact, message: string): string | null {
  if (!supplier.whatsapp_e164) return null
  const phone = supplier.whatsapp_e164.replace(/[^\d]/g, '')
  if (!phone) return null
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}
