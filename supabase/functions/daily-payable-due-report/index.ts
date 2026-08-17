type ReportKind = 'a_vencer' | 'vencida'

type DueItem = {
  purchase_id: string
  installment_id: string
  supplier_name: string
  document_label: string
  installment_number: number
  due_date: string
  amount: number
  days_overdue?: number
}

type DeliveryClaim = {
  state: 'aguardando_horario' | 'ja_enviado' | 'pronto_para_enviar'
  report_id?: string
  report_date?: string
  report_kind?: ReportKind
  window_end_date?: string | null
  attempt_token?: string
  recipient?: string
  items?: DueItem[]
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const resendApiKey = Deno.env.get('RESEND_API_KEY')
const appUrl = 'https://pane-producao-git-main-orodrigaos-projects.vercel.app'

function requireConfig(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Configuração ausente: ${name}`)
  return value
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character))
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Todos os dias corridos do intervalo, limitado por segurança a 10 datas. */
function dateRange(startKey: string, endKey: string): string[] {
  const dates: string[] = []
  let cursor = startKey
  while (cursor <= endKey && dates.length < 10) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates.length > 0 ? dates : [startKey]
}

function isDueItem(value: unknown): value is DueItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.purchase_id === 'string'
    && typeof item.installment_id === 'string'
    && typeof item.supplier_name === 'string'
    && typeof item.document_label === 'string'
    && typeof item.installment_number === 'number'
    && typeof item.due_date === 'string'
    && typeof item.amount === 'number'
    && (item.days_overdue === undefined || typeof item.days_overdue === 'number')
}

function isDeliveryClaim(value: unknown): value is DeliveryClaim {
  if (!value || typeof value !== 'object') return false
  const claim = value as Record<string, unknown>
  if (claim.state === 'aguardando_horario' || claim.state === 'ja_enviado') return true
  return claim.state === 'pronto_para_enviar'
    && typeof claim.report_id === 'string'
    && typeof claim.report_date === 'string'
    && (claim.report_kind === 'a_vencer' || claim.report_kind === 'vencida')
    && typeof claim.attempt_token === 'string'
    && typeof claim.recipient === 'string'
    && Array.isArray(claim.items)
    && claim.items.every(isDueItem)
}

async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${requireConfig(supabaseUrl, 'SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: requireConfig(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${requireConfig(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`RPC ${name} recusou a chamada (${response.status}).`)
  const responseBody = await response.text()
  return responseBody ? JSON.parse(responseBody) : null
}

function itemLink(item: DueItem): string {
  const link = new URL('/contas-pagar', appUrl)
  link.searchParams.set('purchase', item.purchase_id)
  link.searchParams.set('installment', item.installment_id)
  return link.toString()
}

function itemRow(item: DueItem, detail: string): string {
  return `<tr>
    <td style="padding:9px 6px;border-bottom:1px solid #eee2d2"><a href="${itemLink(item)}" style="color:#7f2b42;font-weight:700">${escapeHtml(item.supplier_name)}</a><br><span style="color:#6b6258;font-size:12px">${escapeHtml(detail)}</span></td>
    <td style="padding:9px 6px;border-bottom:1px solid #eee2d2;text-align:right;white-space:nowrap">${formatMoney(item.amount)}</td>
  </tr>`
}

function emailShell(headline: string, lede: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8f3eb;font-family:Arial,sans-serif;color:#342d28">
    <main style="max-width:620px;margin:0 auto;padding:24px 16px">
      <article style="background:#fffdf9;border:1px solid #eadfce;border-radius:12px;padding:24px">
        <p style="margin:0 0 8px;color:#7f2b42;font-weight:700">Pane&Salute · Financeiro JC</p>
        <h1 style="font-size:23px;margin:0">${headline}</h1>
        <p style="color:#5f574e">${lede}</p>
        ${body}
      </article>
    </main>
  </body></html>`
}

function dueReportHtml(reportDate: string, windowEndDate: string, items: DueItem[]): string {
  const dayKeys = dateRange(reportDate, windowEndDate)
  const groups = new Map(dayKeys.map(date => [date, items.filter(item => item.due_date === date)]))
  const sections = dayKeys.map(date => {
    const dayItems = groups.get(date) ?? []
    const rows = dayItems.length === 0
      ? '<p style="margin:8px 0;color:#5f574e">Nenhuma conta a vencer.</p>'
      : dayItems.map(item => itemRow(item, `${item.document_label} · Parcela ${item.installment_number}`)).join('')
    return `<section style="margin:20px 0">
      <h2 style="font-size:16px;margin:0 0 4px;color:#342d28">${formatDate(date)}</h2>
      ${dayItems.length === 0 ? rows : `<table style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`}
    </section>`
  }).join('')
  const totals = dayKeys.map(date => {
    const total = (groups.get(date) ?? []).reduce((sum, item) => sum + item.amount, 0)
    return `<tr><td style="padding:5px 0">${formatDate(date)}</td><td style="padding:5px 0;text-align:right;font-weight:700">${formatMoney(total)}</td></tr>`
  }).join('')

  return emailShell(
    'Contas a vencer até o 3º dia útil',
    `Relatório de ${formatDate(dayKeys[0])} a ${formatDate(dayKeys[dayKeys.length - 1])}. Toque no fornecedor para abrir a conta direto no sistema.`,
    `${sections}
     <hr style="border:0;border-top:1px solid #eadfce;margin:22px 0">
     <h2 style="font-size:16px;margin:0 0 8px">Soma das contas por dia</h2>
     <table style="width:100%;border-collapse:collapse"><tbody>${totals}</tbody></table>`,
  )
}

function overdueReportHtml(reportDate: string, items: DueItem[]): string {
  const rows = items.map(item => {
    const atraso = typeof item.days_overdue === 'number'
      ? (item.days_overdue === 1 ? 'vencida há 1 dia' : `vencida há ${item.days_overdue} dias`)
      : 'vencida'
    return itemRow(item, `${item.document_label} · Parcela ${item.installment_number} · venceu em ${formatDate(item.due_date)} · ${atraso}`)
  }).join('')
  const total = items.reduce((sum, item) => sum + item.amount, 0)

  return emailShell(
    'Contas vencidas em aberto',
    `Situação em ${formatDate(reportDate)}. Estas contas já passaram do vencimento e seguem em aberto: elas aparecem aqui todo dia até serem pagas ou canceladas.`,
    `<table style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>
     <hr style="border:0;border-top:1px solid #eadfce;margin:22px 0">
     <table style="width:100%;border-collapse:collapse"><tbody>
       <tr><td style="padding:5px 0">Total vencido (${items.length} conta${items.length === 1 ? '' : 's'})</td><td style="padding:5px 0;text-align:right;font-weight:700">${formatMoney(total)}</td></tr>
     </tbody></table>`,
  )
}

function subjectFor(claim: Required<Pick<DeliveryClaim, 'report_date' | 'report_kind' | 'items'>> & DeliveryClaim): string {
  if (claim.report_kind === 'vencida') {
    const total = claim.items.reduce((sum, item) => sum + item.amount, 0)
    const quantidade = claim.items.length === 1 ? '1 conta' : `${claim.items.length} contas`
    return `Contas da JC vencidas: ${quantidade}, ${formatMoney(total)} (${formatDate(claim.report_date)})`
  }
  const windowEnd = claim.window_end_date ?? addDays(claim.report_date, 2)
  return `Contas da JC a vencer: ${formatDate(claim.report_date)} a ${formatDate(windowEnd)}`
}

async function sendClaim(claim: Required<DeliveryClaim>, cronSecret: string): Promise<void> {
  const windowEnd = claim.window_end_date ?? addDays(claim.report_date, 2)
  const html = claim.report_kind === 'vencida'
    ? overdueReportHtml(claim.report_date, claim.items)
    : dueReportHtml(claim.report_date, windowEnd, claim.items)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireConfig(resendApiKey, 'RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `payable-due-report:${claim.report_kind}:${claim.report_date}`,
    },
    body: JSON.stringify({
      from: 'Pane&Salute Financeiro <financeiro@paneesalute.com.br>',
      to: [claim.recipient],
      subject: subjectFor(claim),
      html,
    }),
  })
  if (!response.ok) throw new Error(`Resend recusou o envio (${response.status}).`)
  const providerResult: unknown = await response.json()
  const providerId = providerResult && typeof providerResult === 'object' && typeof (providerResult as Record<string, unknown>).id === 'string'
    ? (providerResult as Record<string, string>).id
    : 'aceito-pelo-resend'
  await callRpc('mark_payable_due_report_sent', {
    p_secret: cronSecret, p_report_id: claim.report_id, p_attempt_token: claim.attempt_token, p_provider_message_id: providerId,
  })
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const cronSecret = request.headers.get('x-payable-report-cron-secret')
  if (!cronSecret) return new Response(null, { status: 401 })

  const delivered: string[] = []

  // Uma chamada do cron despacha os relatórios pendentes do dia (no máximo
  // um de cada tipo); a trava por tentativa continua no banco.
  for (let attempt = 0; attempt < 3; attempt++) {
    let result: unknown
    try {
      result = await callRpc('claim_payable_due_report_for_delivery', { p_secret: cronSecret })
    } catch {
      return new Response(null, { status: 401 })
    }
    if (!isDeliveryClaim(result)) return new Response(null, { status: 500 })
    if (result.state === 'aguardando_horario' || result.state === 'ja_enviado') {
      break
    }

    const claim = result as Required<DeliveryClaim>
    try {
      await sendClaim(claim, cronSecret)
      delivered.push(claim.report_kind)
    } catch (error) {
      try {
        await callRpc('record_payable_due_report_failure', {
          p_secret: cronSecret, p_report_id: claim.report_id, p_attempt_token: claim.attempt_token,
          p_error: error instanceof Error ? error.message : 'Falha desconhecida ao enviar o relatório.',
        })
      } catch {
        // O retorno não revela o erro interno; o cron fará a nova tentativa.
      }
      return delivered.length > 0
        ? Response.json({ status: 'parcial', enviados: delivered })
        : new Response(null, { status: 502 })
    }
  }

  return delivered.length > 0
    ? Response.json({ status: 'enviado', enviados: delivered })
    : new Response(null, { status: 204 })
})
